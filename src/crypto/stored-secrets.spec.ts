import { CryptoService } from './crypto.service.js';
import { UnreadableSecretError } from './key-ring.js';
import {
  MAX_SECRET_JSON_DEPTH,
  PlaceholderTypedOverError,
  SecretJsonTooDeepError,
  openSecret,
  openSecretJson,
  redactSecret,
  redactSecretJson,
  sealSecret,
  sealSecretJson,
  sealSecretUpdate,
  secretJsonHasPlaceholder,
} from './stored-secrets.js';
import { SECRET_PLACEHOLDER } from '../realms/secret-placeholder.js';
import { signingKeySecrets } from './signing-key-secrets.js';
import { idpSecrets } from '../identity-providers/idp-secrets.js';
import { federationSecrets } from '../user-federation/federation-secrets.js';
import { totpSecret } from '../mfa/totp-secret.js';
import { wizardSecrets } from '../setup-wizard/wizard-secrets.js';

describe('stored secrets', () => {
  const crypto = new CryptoService();

  describe('string columns', () => {
    it('encrypts on write and decrypts on use', () => {
      const sealed = sealSecret(crypto, 'hunter2');
      expect(sealed).not.toBe('hunter2');
      expect(openSecret(crypto, sealed)).toBe('hunter2');
    });

    it('encrypts each write with a fresh IV', () => {
      expect(sealSecret(crypto, 'same')).not.toBe(sealSecret(crypto, 'same'));
    });

    it('keeps empty and nullish values', () => {
      expect(sealSecret(crypto, '')).toBe('');
      expect(sealSecret(crypto, null)).toBeNull();
      expect(sealSecret(crypto, undefined)).toBeUndefined();
    });

    it('reads a legacy plaintext value as is', () => {
      expect(openSecret(crypto, 'legacy-plain')).toBe('legacy-plain');
    });

    it('does not take a short plaintext for ciphertext (full GCM tag)', () => {
      // Valid base64 that decodes to fewer than 12 + 16 bytes: before the
      // tag length was pinned, GCM would try it with a truncated tag.
      for (const value of ['abcd', 'abcdefgh', 'QUJDREVGR0hJSktMTU5PUA==']) {
        expect(crypto.encryptSecret(value)).not.toBe(value);
        expect(openSecret(crypto, value)).toBe(value);
      }
    });

    it('treats a value encrypted with another key as not encrypted', () => {
      const prevKey = process.env['WEBHOOK_SECRET_KEY'];
      process.env['WEBHOOK_SECRET_KEY'] = 'another-key-entirely';
      const other = new CryptoService();
      if (prevKey === undefined) delete process.env['WEBHOOK_SECRET_KEY'];
      else process.env['WEBHOOK_SECRET_KEY'] = prevKey;

      // An envelope names its key: one this instance lacks is never used
      // as the secret, nor encrypted a second time.
      const foreign = other.encryptSecret('x');
      expect(() => crypto.decryptSecret(foreign)).toThrow(
        UnreadableSecretError,
      );
      expect(crypto.encryptSecret(foreign)).toBe(foreign);

      // Legacy ciphertext (no key id) cannot be told from plaintext. This is
      // why SecretsAtRestService checks the key before any sweep.
      const legacy = foreign.slice(foreign.lastIndexOf('.') + 1);
      expect(crypto.decryptSecret(legacy)).toBe(legacy);
    });

    it('rejects the placeholder as a new value', () => {
      expect(() => sealSecret(crypto, SECRET_PLACEHOLDER)).toThrow(
        PlaceholderTypedOverError,
      );
    });

    it('on update: placeholder or missing keeps the column', () => {
      expect(sealSecretUpdate(crypto, SECRET_PLACEHOLDER)).toBeUndefined();
      expect(sealSecretUpdate(crypto, undefined)).toBeUndefined();
      expect(openSecret(crypto, sealSecretUpdate(crypto, 'new')!)).toBe('new');
    });

    it('on update: refuses text typed after the placeholder', () => {
      expect(() =>
        sealSecretUpdate(crypto, `${SECRET_PLACEHOLDER}typed`),
      ).toThrow(PlaceholderTypedOverError);
    });

    it('redacts to the placeholder, keeps empty', () => {
      expect(redactSecret('anything')).toBe(SECRET_PLACEHOLDER);
      expect(redactSecret('')).toBe('');
      expect(redactSecret(null)).toBeNull();
    });
  });

  describe('JSON', () => {
    const shape = { isSecretKey: (k: string) => k === 'secret' };

    it('encrypts only secret strings, and everything under a secret key', () => {
      const sealed = sealSecretJson(
        crypto,
        {
          issuer: 'https://idp',
          secret: 's1',
          nested: { secret: ['a', 'b'], keep: 1 },
        },
        shape,
      ) as Record<string, any>;
      expect(sealed['issuer']).toBe('https://idp');
      expect(sealed['nested']['keep']).toBe(1);
      expect(sealed['secret']).not.toBe('s1');
      expect(openSecretJson(crypto, sealed, shape)).toEqual({
        issuer: 'https://idp',
        secret: 's1',
        nested: { secret: ['a', 'b'], keep: 1 },
      });
    });

    it('keeps the stored value at the same path for the placeholder', () => {
      const stored = sealSecretJson(crypto, { secret: 'old' }, shape) as {
        secret: string;
      };
      const next = sealSecretJson(
        crypto,
        { secret: SECRET_PLACEHOLDER, other: 'x' },
        shape,
        stored,
      ) as { secret: string };
      expect(next.secret).toBe(stored.secret);
    });

    it('encrypts a legacy plaintext value that the placeholder keeps', () => {
      const next = sealSecretJson(
        crypto,
        { secret: SECRET_PLACEHOLDER },
        shape,
        { secret: 'legacy' },
      ) as { secret: string };
      expect(next.secret).not.toBe('legacy');
      expect(crypto.decrypt(next.secret)).toBe('legacy');
    });

    it('drops a placeholder with nothing stored behind it', () => {
      expect(
        sealSecretJson(crypto, { secret: SECRET_PLACEHOLDER }, shape, {}),
      ).toEqual({});
    });

    it('refuses text typed after the placeholder', () => {
      expect(() =>
        sealSecretJson(crypto, { secret: `${SECRET_PLACEHOLDER}x` }, shape),
      ).toThrow(PlaceholderTypedOverError);
    });

    it('redacts secrets and keeps the shape', () => {
      expect(
        redactSecretJson({ secret: 'c', issuer: 'i', empty: '' }, shape),
      ).toEqual({ secret: SECRET_PLACEHOLDER, issuer: 'i', empty: '' });
      expect(redactSecretJson({ a: 'x', b: '' }, { allSecret: true })).toEqual({
        a: SECRET_PLACEHOLDER,
        b: '',
      });
    });

    it('finds placeholders', () => {
      expect(
        secretJsonHasPlaceholder({ secret: SECRET_PLACEHOLDER }, shape),
      ).toBe(true);
      expect(
        secretJsonHasPlaceholder({ issuer: SECRET_PLACEHOLDER }, shape),
      ).toBe(false);
    });

    it('refuses JSON nested deeper than the limit', () => {
      let deep: unknown = 'leaf';
      for (let i = 0; i <= MAX_SECRET_JSON_DEPTH; i++) deep = { secret: deep };
      expect(() => sealSecretJson(crypto, deep, shape)).toThrow(
        SecretJsonTooDeepError,
      );
    });
  });

  describe('per-model helpers', () => {
    it('identity provider: seal, redact, open', () => {
      const stored = idpSecrets.forCreate(crypto, 'cs');
      expect(idpSecrets.redact({ alias: 'g', clientSecret: stored })).toEqual({
        alias: 'g',
        clientSecret: SECRET_PLACEHOLDER,
      });
      expect(idpSecrets.clientSecret(crypto, { clientSecret: stored })).toBe(
        'cs',
      );
      expect(idpSecrets.forUpdate(crypto, SECRET_PLACEHOLDER)).toBeUndefined();
      // The list view selects no secret: nothing to redact.
      expect(idpSecrets.redact({ alias: 'g' })).toEqual({ alias: 'g' });
    });

    it('LDAP federation: seal, redact, open', () => {
      const stored = federationSecrets.forCreate(crypto, 'bindpw');
      expect(federationSecrets.redact({ bindCredential: stored })).toEqual({
        bindCredential: SECRET_PLACEHOLDER,
      });
      expect(
        federationSecrets.bindCredential(crypto, { bindCredential: stored }),
      ).toBe('bindpw');
      expect(
        federationSecrets.bindCredential(crypto, { bindCredential: 'legacy' }),
      ).toBe('legacy');
    });

    it('signing key: the private key is stored encrypted', () => {
      const data = signingKeySecrets.createData(crypto, {
        kid: 'k',
        publicKeyPem: 'PUB',
        privateKeyPem: 'PRIV',
      });
      expect(data).toMatchObject({
        kid: 'k',
        algorithm: 'RS256',
        publicKey: 'PUB',
      });
      expect(data.privateKey).not.toBe('PRIV');
      expect(signingKeySecrets.privateKeyPem(crypto, data)).toBe('PRIV');
    });

    it('TOTP seed: stored encrypted, legacy read as is', () => {
      const stored = totpSecret.forCreate(crypto, 'JBSWY3DPEHPK3PXP');
      expect(stored).not.toBe('JBSWY3DPEHPK3PXP');
      expect(totpSecret.base32(crypto, { secretKey: stored })).toBe(
        'JBSWY3DPEHPK3PXP',
      );
      expect(totpSecret.base32(crypto, { secretKey: 'JBSWY3DPEHPK3PXP' })).toBe(
        'JBSWY3DPEHPK3PXP',
      );
    });

    it('setup wizard SMTP password: sealed, kept for the placeholder, redacted', () => {
      const stored = wizardSecrets.smtpPassword(crypto, 'smtp-pw', null)!;
      expect(crypto.decrypt(stored)).toBe('smtp-pw');
      expect(
        wizardSecrets.smtpPassword(crypto, SECRET_PLACEHOLDER, {
          password: stored,
        }),
      ).toBe(stored);
      expect(
        wizardSecrets.redact({ smtpConfig: { host: 'h', password: stored } }),
      ).toEqual({ smtpConfig: { host: 'h', password: SECRET_PLACEHOLDER } });
    });

    it('never returns the admin password hash', () => {
      const redacted = wizardSecrets.redact({
        adminUsername: 'admin',
        adminPasswordHash: '$argon2id$v=19$m=65536,t=3,p=4$abc$def',
        smtpConfig: null,
      });
      expect(redacted).toEqual({ adminUsername: 'admin', smtpConfig: null });
      expect(redacted).not.toHaveProperty('adminPasswordHash');
    });
  });
});
