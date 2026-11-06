import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CryptoService } from '../crypto/crypto.service.js';
import {
  encryptEmailProviderConfig,
  redactEmailProviderConfig,
  SECRET_PLACEHOLDER,
} from './realm-secrets.util.js';
import { UpdateRealmDto } from './dto/update-realm.dto.js';

/**
 * Email provider credentials are encrypted at rest and must never come back
 * from the API — not even as ciphertext — so the admin UI shows the hidden
 * marker and sends it back to mean "keep the stored key".
 */
describe('email provider config secrets', () => {
  const crypto = new CryptoService();

  /** Mirrors buildProviderConfig in admin-ui EmailProviderForm.tsx. */
  const formConfig = (keys: {
    resend?: string;
    sendgrid?: string;
    mailgun?: string;
    postmark?: string;
  }) => ({
    resend: { apiKey: keys.resend ?? '', from: 'a@x.test' },
    sendgrid: { apiKey: keys.sendgrid ?? '', from: 'b@x.test' },
    mailgun: {
      apiKey: keys.mailgun ?? '',
      domain: 'mg.x.test',
      from: 'c@x.test',
      region: 'eu',
    },
    postmark: { serverToken: keys.postmark ?? '', from: 'd@x.test' },
  });

  describe('encryptEmailProviderConfig', () => {
    it('encrypts each provider secret and leaves the rest readable', () => {
      const out = encryptEmailProviderConfig(
        crypto,
        {
          ...formConfig({
            resend: 're_1',
            sendgrid: 'SG.2',
            mailgun: 'mg-3',
            postmark: 'pm-4',
          }),
          smtp: { host: 'smtp.x.test', password: 'smtp-5' },
        },
        undefined,
      )!;

      const section = (name: string) => out[name] as Record<string, unknown>;
      expect(section('mailgun')['domain']).toBe('mg.x.test');
      expect(section('resend')['from']).toBe('a@x.test');
      for (const [name, field, plain] of [
        ['resend', 'apiKey', 're_1'],
        ['sendgrid', 'apiKey', 'SG.2'],
        ['mailgun', 'apiKey', 'mg-3'],
        ['postmark', 'serverToken', 'pm-4'],
        // The nested SMTP password used to be stored in plaintext.
        ['smtp', 'password', 'smtp-5'],
      ]) {
        expect(section(name)[field]).not.toBe(plain);
        expect(crypto.decrypt(section(name)[field] as string)).toBe(plain);
      }
    });

    it('keeps the stored key when the placeholder is sent back', () => {
      const stored = encryptEmailProviderConfig(
        crypto,
        formConfig({ sendgrid: 'SG.original' }),
      );

      const out = encryptEmailProviderConfig(
        crypto,
        formConfig({ sendgrid: SECRET_PLACEHOLDER }),
        stored,
      )!;

      const key = (out['sendgrid'] as Record<string, string>)['apiKey'];
      expect(crypto.decrypt(key)).toBe('SG.original');
    });

    it('replaces the key when a new one is entered, and drops an emptied one', () => {
      const stored = encryptEmailProviderConfig(
        crypto,
        formConfig({ resend: 're_old', postmark: 'pm-old' }),
      );

      const out = encryptEmailProviderConfig(
        crypto,
        formConfig({ resend: 're_new', postmark: '' }),
        stored,
      )!;

      const resend = out['resend'] as Record<string, string>;
      expect(crypto.decrypt(resend['apiKey'])).toBe('re_new');
      expect(out['postmark']).not.toHaveProperty('serverToken');
    });

    it('does not invent a key from the placeholder when none was stored', () => {
      const out = encryptEmailProviderConfig(
        crypto,
        formConfig({ mailgun: SECRET_PLACEHOLDER }),
        {},
      )!;

      expect(out['mailgun']).not.toHaveProperty('apiKey');
    });
  });

  describe('redactEmailProviderConfig', () => {
    it('hides every stored secret behind the placeholder', () => {
      const stored = encryptEmailProviderConfig(
        crypto,
        formConfig({ resend: 're_1', postmark: 'pm-4' }),
      );

      const out = redactEmailProviderConfig(stored) as Record<
        string,
        Record<string, unknown>
      >;

      expect(out['resend']['apiKey']).toBe(SECRET_PLACEHOLDER);
      expect(out['postmark']['serverToken']).toBe(SECRET_PLACEHOLDER);
      expect(out['resend']['from']).toBe('a@x.test');
      // Unset keys stay unset rather than looking configured.
      expect(out['sendgrid']).not.toHaveProperty('apiKey');
    });

    it('passes non-objects through', () => {
      expect(redactEmailProviderConfig(null)).toBeNull();
    });
  });

  describe('request validation', () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    const validate = (emailProviderConfig: unknown) =>
      pipe.transform(
        { emailProvider: 'sendgrid', emailProviderConfig },
        { type: 'body', metatype: UpdateRealmDto },
      );

    it('accepts the placeholder as "keep the stored key"', async () => {
      await expect(
        validate(formConfig({ sendgrid: SECRET_PLACEHOLDER })),
      ).resolves.toBeDefined();
    });

    it('rejects a key typed after the placeholder instead of replacing it', async () => {
      await expect(
        validate(formConfig({ sendgrid: `${SECRET_PLACEHOLDER}SG.new` })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
