import {
  REDACTED,
  redactAdminRepresentation,
} from './admin-event-redaction.js';
import { SECRET_PLACEHOLDER } from '../realms/secret-placeholder.js';

describe('redactAdminRepresentation', () => {
  it('redacts every sensitive field, at any depth', () => {
    expect(
      redactAdminRepresentation({
        name: 'corp-ldap',
        bindCredential: 'ldap-pass',
        httpHeaders: { Authorization: 'Bearer t' },
        smtpPassword: 'smtp',
        recaptchaSecretKey: 'r',
        emailProviderConfig: { resend: { apiKey: 're_x' } },
        smsProviderConfig: { twilioAuthToken: 'tw' },
        secret: 'whsec',
        privateKeyPem: '-----BEGIN PRIVATE KEY-----',
        scimUser: { userName: 'u', password: 'scim-pass' },
        nested: [{ clientSecret: 'c' }],
      }),
    ).toEqual({
      name: 'corp-ldap',
      bindCredential: REDACTED,
      httpHeaders: REDACTED,
      smtpPassword: REDACTED,
      recaptchaSecretKey: REDACTED,
      emailProviderConfig: REDACTED,
      smsProviderConfig: REDACTED,
      secret: REDACTED,
      privateKeyPem: REDACTED,
      scimUser: { userName: 'u', password: REDACTED },
      nested: [{ clientSecret: REDACTED }],
    });
  });

  it('masks the secret-named keys of a config and keeps the rest', () => {
    expect(
      redactAdminRepresentation({
        type: 'oidc',
        config: { issuer: 'https://x', clientId: 'a', clientSecret: 's' },
      }),
    ).toEqual({
      type: 'oidc',
      config: {
        issuer: 'https://x',
        clientId: 'a',
        clientSecret: SECRET_PLACEHOLDER,
      },
    });
  });

  it('redacts the value of a SCIM PATCH operation on the password', () => {
    expect(
      redactAdminRepresentation({
        operations: [
          { op: 'replace', path: 'password', value: 'new-pass' },
          { op: 'replace', path: 'displayName', value: 'Ann' },
          { op: 'replace', value: { password: 'p2', active: true } },
        ],
      }),
    ).toEqual({
      operations: [
        { op: 'replace', path: 'password', value: REDACTED },
        { op: 'replace', path: 'displayName', value: 'Ann' },
        { op: 'replace', value: { password: REDACTED, active: true } },
      ],
    });
  });

  it('is idempotent and leaves harmless values alone', () => {
    const once = redactAdminRepresentation({
      password: 'x',
      config: { clientSecret: 's' },
      enabled: true,
      count: 3,
      empty: null,
      clientSecret: null,
    });
    expect(redactAdminRepresentation(once)).toEqual(once);
    expect(once).toMatchObject({ enabled: true, count: 3, empty: null });
    expect((once as Record<string, unknown>)['clientSecret']).toBeNull();
    for (const value of [null, 'text', 42, [1, 'a']]) {
      expect(redactAdminRepresentation(value)).toEqual(value);
    }
  });

  it('cuts off a representation nested deeper than it walks', () => {
    let deep: Record<string, unknown> = { password: 'x' };
    for (let i = 0; i < 40; i++) deep = { child: deep };
    expect(JSON.stringify(redactAdminRepresentation(deep))).not.toContain(
      '"x"',
    );
  });
});
