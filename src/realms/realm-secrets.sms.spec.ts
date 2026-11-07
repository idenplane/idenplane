import { CryptoService } from '../crypto/crypto.service.js';
import {
  decryptSmsProviderConfig,
  encryptSmsProviderConfig,
  redactSmsProviderConfig,
  SECRET_PLACEHOLDER,
} from './realm-secrets.util.js';

describe('SMS provider config secrets', () => {
  const crypto = new CryptoService();

  describe('encryptSmsProviderConfig', () => {
    it('encrypts the credential fields and leaves identifiers readable', () => {
      const out = encryptSmsProviderConfig(
        crypto,
        {
          twilioAccountSid: 'AC123',
          twilioAuthToken: 'tw-secret',
          vonageApiSecret: 'vo-secret',
          awsSecretAccessKey: 'aws-secret',
          awsRegion: 'eu-west-1',
          webhookHeaders: '{"Authorization":"Bearer x"}',
        },
        undefined,
      )!;

      expect(out['twilioAccountSid']).toBe('AC123');
      expect(out['awsRegion']).toBe('eu-west-1');
      for (const [field, plain] of [
        ['twilioAuthToken', 'tw-secret'],
        ['vonageApiSecret', 'vo-secret'],
        ['awsSecretAccessKey', 'aws-secret'],
        ['webhookHeaders', '{"Authorization":"Bearer x"}'],
      ]) {
        expect(out[field]).not.toBe(plain);
        expect(crypto.decrypt(out[field] as string)).toBe(plain);
      }
    });

    it('keeps the stored ciphertext when the client sends the placeholder back', () => {
      const stored = { twilioAuthToken: crypto.encrypt('kept') };

      const out = encryptSmsProviderConfig(
        crypto,
        { twilioAccountSid: 'AC123', twilioAuthToken: SECRET_PLACEHOLDER },
        stored,
      )!;

      expect(out['twilioAuthToken']).toBe(stored.twilioAuthToken);
    });

    it('encrypts a kept secret that was stored in plaintext before', () => {
      const out = encryptSmsProviderConfig(
        crypto,
        { vonageApiSecret: SECRET_PLACEHOLDER },
        { vonageApiSecret: 'legacy-plain' },
      )!;

      expect(out['vonageApiSecret']).not.toBe('legacy-plain');
      expect(crypto.decrypt(out['vonageApiSecret'] as string)).toBe(
        'legacy-plain',
      );
    });

    it.each(['{}', '[]', '  {} ', ''])(
      'does not store empty webhook headers %p as a secret',
      (webhookHeaders) => {
        const out = encryptSmsProviderConfig(
          crypto,
          { webhookUrl: 'https://sms.example.com', webhookHeaders },
          undefined,
        )!;

        expect(out).not.toHaveProperty('webhookHeaders');
      },
    );

    it('drops a placeholder that has nothing stored behind it', () => {
      const out = encryptSmsProviderConfig(
        crypto,
        { twilioAuthToken: SECRET_PLACEHOLDER },
        {},
      )!;

      expect(out).not.toHaveProperty('twilioAuthToken');
    });

    it('replaces the stored config wholesale, so a removed secret is cleared', () => {
      const out = encryptSmsProviderConfig(
        crypto,
        { twilioAccountSid: 'AC123' },
        { twilioAuthToken: crypto.encrypt('old') },
      )!;

      expect(out).not.toHaveProperty('twilioAuthToken');
    });

    it('does not double-encrypt a value that is already ciphertext', () => {
      const cipher = crypto.encrypt('tw-secret');

      const out = encryptSmsProviderConfig(
        crypto,
        { twilioAuthToken: cipher },
        undefined,
      )!;

      expect(out['twilioAuthToken']).toBe(cipher);
    });

    it('returns undefined when no config was sent, so the column is left alone', () => {
      expect(encryptSmsProviderConfig(crypto, undefined, {})).toBeUndefined();
    });
  });

  it('redactSmsProviderConfig hides every stored secret behind the placeholder', () => {
    const redacted = redactSmsProviderConfig({
      twilioAccountSid: 'AC123',
      twilioAuthToken: crypto.encrypt('tw-secret'),
      webhookHeaders: crypto.encrypt('{}'),
      vonageApiSecret: '',
    }) as Record<string, unknown>;

    expect(redacted).toEqual({
      twilioAccountSid: 'AC123',
      twilioAuthToken: SECRET_PLACEHOLDER,
      webhookHeaders: SECRET_PLACEHOLDER,
      vonageApiSecret: '',
    });
  });

  it('decryptSmsProviderConfig round-trips, and passes legacy plaintext through', () => {
    const stored = encryptSmsProviderConfig(
      crypto,
      { twilioAccountSid: 'AC123', twilioAuthToken: 'tw-secret' },
      undefined,
    );

    expect(decryptSmsProviderConfig(crypto, stored)).toEqual({
      twilioAccountSid: 'AC123',
      twilioAuthToken: 'tw-secret',
    });
    expect(
      decryptSmsProviderConfig(crypto, {
        vonageApiSecret: 'plain-from-before',
      }),
    ).toEqual({ vonageApiSecret: 'plain-from-before' });
    expect(decryptSmsProviderConfig(crypto, null)).toEqual({});
  });
});
