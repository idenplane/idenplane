import { SmsService } from './sms.service.js';
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
    service = new SmsService(prisma as any);
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
});
