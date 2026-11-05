import { SmsService } from './sms.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../prisma/prisma.mock.js';
import { TwilioSmsProvider } from './providers/twilio.provider.js';
import { VonageSmsProvider } from './providers/vonage.provider.js';
import { AwsSnsProvider } from './providers/aws-sns.provider.js';
import { WebhookSmsProvider } from './providers/webhook.provider.js';

describe('SmsService', () => {
  let service: SmsService;
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new SmsService(prisma as any, new CryptoService());
  });

  describe('isConfigured', () => {
    it('should return true when a provider is set', async () => {
      prisma.realm.findUnique.mockResolvedValue({ smsProvider: 'twilio' });
      expect(await service.isConfigured('my-realm')).toBe(true);
    });

    it('should return false when smsProvider is "none"', async () => {
      prisma.realm.findUnique.mockResolvedValue({ smsProvider: 'none' });
      expect(await service.isConfigured('my-realm')).toBe(false);
    });

    it('should return false when the realm has no smsProvider', async () => {
      prisma.realm.findUnique.mockResolvedValue({ smsProvider: null });
      expect(await service.isConfigured('my-realm')).toBe(false);
    });
  });

  describe('getProvider', () => {
    it('should return null and log a warning when smsProvider is "none"', async () => {
      prisma.realm.findUnique.mockResolvedValue({ smsProvider: 'none' });
      expect(await service.getProvider('my-realm')).toBeNull();
    });

    it('should return null when the realm is not found', async () => {
      prisma.realm.findUnique.mockResolvedValue(null);
      expect(await service.getProvider('missing')).toBeNull();
    });

    it('should lazily construct a TwilioSmsProvider via dynamic import', async () => {
      prisma.realm.findUnique.mockResolvedValue({ smsProvider: 'twilio' });
      const provider = await service.getProvider('my-realm');
      expect(provider).toBeInstanceOf(TwilioSmsProvider);
    });

    it('should construct a VonageSmsProvider', async () => {
      prisma.realm.findUnique.mockResolvedValue({ smsProvider: 'vonage' });
      const provider = await service.getProvider('my-realm');
      expect(provider).toBeInstanceOf(VonageSmsProvider);
    });

    it('should construct an AwsSnsProvider', async () => {
      prisma.realm.findUnique.mockResolvedValue({ smsProvider: 'aws-sns' });
      const provider = await service.getProvider('my-realm');
      expect(provider).toBeInstanceOf(AwsSnsProvider);
    });

    it('should construct a WebhookSmsProvider', async () => {
      prisma.realm.findUnique.mockResolvedValue({ smsProvider: 'webhook' });
      const provider = await service.getProvider('my-realm');
      expect(provider).toBeInstanceOf(WebhookSmsProvider);
    });

    it('should return null for an unrecognized provider type', async () => {
      prisma.realm.findUnique.mockResolvedValue({ smsProvider: 'bogus' });
      expect(await service.getProvider('my-realm')).toBeNull();
    });
  });

  describe('sendSms', () => {
    it('should skip sending when smsProvider is "none"', async () => {
      prisma.realm.findUnique.mockResolvedValue({ smsProvider: 'none' });
      await expect(
        service.sendSms('my-realm', '+15550100', 'hello'),
      ).resolves.toBeUndefined();
    });

    it('should skip sending when the realm is not found', async () => {
      prisma.realm.findUnique.mockResolvedValue(null);
      await expect(
        service.sendSms('missing', '+15550100', 'hello'),
      ).resolves.toBeUndefined();
    });

    it('should throw when the provider cannot be instantiated', async () => {
      prisma.realm.findUnique.mockResolvedValue({ smsProvider: 'bogus' });
      await expect(
        service.sendSms('my-realm', '+15550100', 'hello'),
      ).rejects.toThrow('could not be instantiated');
    });

    it('should send via the Twilio provider resolved through the dynamic import', async () => {
      prisma.realm.findUnique.mockResolvedValue({
        smsProvider: 'twilio',
        smsProviderConfig: null,
        smsFrom: null,
      });
      const sendSmsSpy = jest
        .spyOn(TwilioSmsProvider.prototype, 'sendSms')
        .mockResolvedValue(undefined);

      await service.sendSms('my-realm', '+15550100', 'hello');

      expect(sendSmsSpy).toHaveBeenCalledWith('+15550100', 'hello');
      sendSmsSpy.mockRestore();
    });
  });

  describe('per-realm provider settings', () => {
    const crypto = new CryptoService();
    const ENV_KEYS = [
      'VONAGE_API_KEY',
      'VONAGE_API_SECRET',
      'VONAGE_PHONE_NUMBER',
      'SMS_WEBHOOK_URL',
      'SMS_WEBHOOK_HEADERS',
    ];
    const saved: Record<string, string | undefined> = {};

    beforeEach(() => {
      for (const k of ENV_KEYS) {
        saved[k] = process.env[k];
        delete process.env[k];
      }
    });
    afterEach(() => {
      for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });

    it('builds the provider from the realm settings, decrypting the secrets', async () => {
      prisma.realm.findUnique.mockResolvedValue({
        smsProvider: 'vonage',
        smsFrom: '+15550001111',
        smsProviderConfig: {
          vonageApiKey: 'realm-key',
          vonageApiSecret: crypto.encrypt('realm-secret'),
        },
      });
      const fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response(JSON.stringify({ messages: [{ status: '0' }] })),
        );

      const provider = await service.getProvider('my-realm');
      expect(provider?.isConfigured()).toBe(true);

      await service.sendSms('my-realm', '+15550100', 'hello');
      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body).toMatchObject({
        api_key: 'realm-key',
        api_secret: 'realm-secret',
        from: '+15550001111',
      });
      fetchSpy.mockRestore();
    });

    it('falls back to the env variables for anything the realm leaves empty', async () => {
      process.env['VONAGE_API_KEY'] = 'env-key';
      process.env['VONAGE_API_SECRET'] = 'env-secret';
      process.env['VONAGE_PHONE_NUMBER'] = '+15559999999';
      prisma.realm.findUnique.mockResolvedValue({
        smsProvider: 'vonage',
        smsFrom: null,
        smsProviderConfig: {},
      });

      const provider = await service.getProvider('my-realm');

      expect(provider?.isConfigured()).toBe(true);
    });

    it('is not configured when neither the realm nor the env provide credentials', async () => {
      prisma.realm.findUnique.mockResolvedValue({
        smsProvider: 'webhook',
        smsFrom: null,
        smsProviderConfig: {},
      });

      const provider = await service.getProvider('my-realm');

      expect(provider?.isConfigured()).toBe(false);
    });

    it('accepts webhook headers as the object the admin UI sends', async () => {
      prisma.realm.findUnique.mockResolvedValue({
        smsProvider: 'webhook',
        smsFrom: null,
        smsProviderConfig: {
          webhookUrl: 'https://sms.example.com/send',
          webhookHeaders: crypto.encrypt('{"Authorization":"Bearer t"}'),
        },
      });

      const provider = (await service.getProvider('my-realm')) as any;

      expect(provider.isConfigured()).toBe(true);
      expect(provider.headers).toEqual([
        { name: 'Authorization', value: 'Bearer t' },
      ]);
    });
  });
});
