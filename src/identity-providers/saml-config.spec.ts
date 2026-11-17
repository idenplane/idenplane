import { generateKeyPairSync } from 'node:crypto';
import { spCertificatePem } from '../broker/saml/saml-sp-credentials.js';
import { makeFakeIdp } from '../broker/saml/__mocks__/fake-saml-idp.js';
import {
  NAMEID_FORMATS,
  certificateToPem,
  validateSamlConfig,
} from './saml-config.js';

let cert: string;
let smallCert: string;

beforeAll(async () => {
  cert = (await makeFakeIdp()).certificatePem;
  const small = generateKeyPairSync('rsa', {
    modulusLength: 1024,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  smallCert = await spCertificatePem(
    {
      kid: 'small',
      algorithm: 'RS256',
      publicKey: small.publicKey,
      privateKey: small.privateKey,
      createdAt: new Date(),
    },
    'small',
  );
});

const base = () => ({
  entityId: 'https://sts.windows.net/tenant/',
  ssoUrl: 'https://login.microsoftonline.com/tenant/saml2',
  signingCertificates: [cert],
});

const errorsOf = (input: unknown) => {
  const r = validateSamlConfig(input);
  return r.ok ? [] : r.errors;
};

describe('validateSamlConfig', () => {
  it('accepts a minimal config and fills the defaults', () => {
    const r = validateSamlConfig(base());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config).toMatchObject({
      ssoBinding: 'redirect',
      nameIdFormat: NAMEID_FORMATS.persistent,
      signAuthnRequests: false,
      wantAssertionsSigned: true,
      wantResponseSigned: false,
      allowSha1: false,
      clockSkewSeconds: 60,
      usernameSource: 'email',
      subjectAttribute: null,
      sloUrl: null,
      attributes: {},
    });
  });

  it('accepts a bare base64 certificate (as in metadata) and stores PEM', () => {
    const body = cert.replace(/-----[A-Z ]+-----|\s/g, '');
    const r = validateSamlConfig({ ...base(), signingCertificates: [body] });
    expect(r.ok && r.config.signingCertificates[0]).toBe(
      certificateToPem(cert),
    );
  });

  it('requires the IdP entity ID, SSO URL and a certificate', () => {
    const errors = errorsOf({});
    expect(errors.join('\n')).toMatch(/entityId .* is required/);
    expect(errors.join('\n')).toMatch(/ssoUrl .* is required/);
    expect(errors.join('\n')).toMatch(/at least one IdP signing certificate/);
  });

  it('refuses a plain-http SSO URL (loopback aside)', () => {
    expect(
      errorsOf({ ...base(), ssoUrl: 'http://idp.example.com/sso' }),
    ).toEqual(['samlConfig.ssoUrl must be an https URL']);
    expect(
      errorsOf({ ...base(), ssoUrl: 'http://localhost:8080/sso' }),
    ).toEqual([]);
  });

  it('refuses a key smaller than 2048 bits', () => {
    expect(
      errorsOf({ ...base(), signingCertificates: [smallCert] }).join(),
    ).toMatch(/1024-bit RSA key/);
  });

  it('refuses something that is not a certificate', () => {
    expect(
      errorsOf({ ...base(), signingCertificates: ['not a cert'] }).join(),
    ).toMatch(/signingCertificates\[0\]/);
  });

  it('refuses more than five certificates', () => {
    expect(
      errorsOf({ ...base(), signingCertificates: Array(6).fill(cert) }).join(),
    ).toMatch(/at most 5/);
  });

  it('refuses unknown settings instead of dropping them', () => {
    expect(errorsOf({ ...base(), wantEncrypted: true })).toEqual([
      'samlConfig.wantEncrypted is not a known setting',
    ]);
  });

  it('bounds the clock skew', () => {
    expect(errorsOf({ ...base(), clockSkewSeconds: 3600 }).join()).toMatch(
      /clockSkewSeconds/,
    );
    expect(errorsOf({ ...base(), clockSkewSeconds: -1 }).join()).toMatch(
      /clockSkewSeconds/,
    );
  });

  it('refuses a transient NameID as the link key', () => {
    expect(
      errorsOf({ ...base(), nameIdFormat: NAMEID_FORMATS.transient }).join(),
    ).toMatch(/transient NameID cannot identify the user/);
    expect(
      errorsOf({
        ...base(),
        nameIdFormat: NAMEID_FORMATS.transient,
        subjectAttribute: 'objectId',
      }),
    ).toEqual([]);
  });

  it('refuses an unknown NameID format and a wrong binding', () => {
    expect(errorsOf({ ...base(), nameIdFormat: 'x' }).join()).toMatch(
      /nameIdFormat/,
    );
    expect(errorsOf({ ...base(), ssoBinding: 'artifact' }).join()).toMatch(
      /ssoBinding/,
    );
  });

  it('needs a username attribute when the username comes from one', () => {
    expect(errorsOf({ ...base(), usernameSource: 'attribute' }).join()).toMatch(
      /attributes.username is required/,
    );
    expect(
      errorsOf({
        ...base(),
        usernameSource: 'attribute',
        attributes: { username: 'uid' },
      }),
    ).toEqual([]);
  });

  it('refuses non-boolean flags', () => {
    expect(errorsOf({ ...base(), allowSha1: 'yes' })).toEqual([
      'samlConfig.allowSha1 must be a boolean',
    ]);
  });
});
