import { CryptoService } from '../crypto/crypto.service.js';
import { SECRET_PLACEHOLDER } from '../realms/secret-placeholder.js';
import {
  isSsoSecretKey,
  ssoConnectionSecrets,
} from './sso-connection-secrets.js';
import { auditStreamSecrets } from '../events/audit-stream-secrets.js';

describe('organization SSO connection secrets', () => {
  const crypto = new CryptoService();

  it.each([
    'clientSecret',
    'client_secret',
    'CLIENT-SECRET',
    'bindPassword',
    'privateKey',
    'spPrivateKeyPem',
    'signingKey',
    'apiKey',
    'accessToken',
    'bindCredential',
  ])('%s is a secret', (key) => {
    expect(isSsoSecretKey(key)).toBe(true);
  });

  it.each([
    'clientId',
    'issuer',
    'tokenUrl',
    'tokenEndpoint',
    'publicKey',
    'idpCertificate',
    'entityId',
  ])('%s is not a secret', (key) => {
    expect(isSsoSecretKey(key)).toBe(false);
  });

  it('round-trips a config: secrets encrypted, the rest readable', () => {
    const config = {
      issuer: 'https://login.example.com',
      clientId: 'abc',
      clientSecret: 'shh',
      saml: { spPrivateKeyPem: 'PEM', entityId: 'urn:x' },
    };
    const stored = ssoConnectionSecrets.forWrite(crypto, config) as any;
    expect(stored.issuer).toBe(config.issuer);
    expect(stored.clientId).toBe('abc');
    expect(stored.saml.entityId).toBe('urn:x');
    expect(stored.clientSecret).not.toBe('shh');
    expect(stored.saml.spPrivateKeyPem).not.toBe('PEM');

    expect(ssoConnectionSecrets.redact({ id: '1', config: stored })).toEqual({
      id: '1',
      config: {
        issuer: config.issuer,
        clientId: 'abc',
        clientSecret: SECRET_PLACEHOLDER,
        saml: { spPrivateKeyPem: SECRET_PLACEHOLDER, entityId: 'urn:x' },
      },
    });
    expect(ssoConnectionSecrets.config(crypto, { config: stored })).toEqual(
      config,
    );
  });

  it('a form re-sending the redacted config keeps every stored secret', () => {
    const stored = ssoConnectionSecrets.forWrite(crypto, {
      clientId: 'abc',
      clientSecret: 'shh',
    });
    const shown = ssoConnectionSecrets.redact({ config: stored })
      .config as Record<string, unknown>;
    const resent = ssoConnectionSecrets.forWrite(
      crypto,
      { ...shown, clientId: 'changed' },
      stored,
    );
    expect(resent['clientSecret']).toBe(stored['clientSecret']);
    expect(resent['clientId']).toBe('changed');
  });
});

describe('audit stream header secrets', () => {
  const crypto = new CryptoService();

  it('encrypts every header value and keeps the names', () => {
    const stored = auditStreamSecrets.forWrite(crypto, {
      Authorization: 'Bearer t',
      'X-Tenant': 'acme',
    })!;
    expect(Object.keys(stored)).toEqual(['Authorization', 'X-Tenant']);
    expect(stored['Authorization']).not.toBe('Bearer t');
    expect(auditStreamSecrets.headers(crypto, { httpHeaders: stored })).toEqual(
      {
        Authorization: 'Bearer t',
        'X-Tenant': 'acme',
      },
    );
    expect(auditStreamSecrets.redact({ httpHeaders: stored })).toEqual({
      httpHeaders: {
        Authorization: SECRET_PLACEHOLDER,
        'X-Tenant': SECRET_PLACEHOLDER,
      },
    });
  });

  it('merges by header name: placeholder keeps, a missing header is removed', () => {
    const stored = auditStreamSecrets.forWrite(crypto, {
      Authorization: 'Bearer t',
      'X-Old': 'o',
    })!;
    const next = auditStreamSecrets.forWrite(
      crypto,
      { Authorization: SECRET_PLACEHOLDER, 'X-New': 'n' },
      stored,
    )!;
    expect(next['Authorization']).toBe(stored['Authorization']);
    expect(next['X-Old']).toBeUndefined();
    expect(crypto.decrypt(next['X-New'])).toBe('n');
  });

  it('leaves the column alone when no headers are sent', () => {
    expect(auditStreamSecrets.forWrite(crypto, undefined)).toBeUndefined();
  });

  it('refuses a header value that is not a string', () => {
    expect(() =>
      auditStreamSecrets.forWrite(crypto, { 'X-N': 1 as unknown as string }),
    ).toThrow(/must be a string/);
  });

  it('reads legacy plaintext headers as is, and ignores a non-object', () => {
    expect(
      auditStreamSecrets.headers(crypto, {
        httpHeaders: { Authorization: 'Bearer legacy' },
      }),
    ).toEqual({ Authorization: 'Bearer legacy' });
    expect(auditStreamSecrets.headers(crypto, { httpHeaders: null })).toEqual(
      {},
    );
  });
});
