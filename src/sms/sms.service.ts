import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { decryptSmsProviderConfig } from '../realms/realm-secrets.util.js';
import { SmsProvider } from './providers/sms-provider.interface.js';
import { VonageSmsProvider } from './providers/vonage.provider.js';
import { AwsSnsProvider } from './providers/aws-sns.provider.js';
import { WebhookSmsProvider } from './providers/webhook.provider.js';
import { SmsProviderType } from './dto/sms-config.dto.js';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async isConfigured(realmName: string): Promise<boolean> {
    const realm = await this.prisma.realm.findUnique({
      where: { name: realmName },
      select: { smsProvider: true },
    });
    return !!realm?.smsProvider && realm.smsProvider !== 'none';
  }

  async getProvider(realmName: string): Promise<SmsProvider | null> {
    const realm = await this.prisma.realm.findUnique({
      where: { name: realmName },
      select: {
        smsProvider: true,
        smsProviderConfig: true,
        smsFrom: true,
      },
    });

    if (!realm?.smsProvider || realm.smsProvider === 'none') {
      this.logger.warn(`SMS provider not configured for realm "${realmName}"`);
      return null;
    }

    const provider = await this.createProvider(realm);
    this.logger.debug(
      `SMS provider "${realm.smsProvider}" requested for realm "${realmName}"`,
    );
    return provider;
  }

  /**
   * The `twilio` SDK is a large (~40MB) dependency that only realms actually
   * using Twilio need. SmsModule is registered globally, so a static import
   * would load it into every server process at startup regardless of
   * config — imported dynamically here so it's only pulled in when a realm
   * is actually configured for Twilio.
   */
  /**
   * Build the realm's provider from its own settings (decrypted here, the only
   * place they are). Each provider falls back to its server-wide env variable
   * for any setting the realm leaves empty.
   */
  private async createProvider(realm: {
    smsProvider: string;
    smsProviderConfig: unknown;
    smsFrom: string | null;
  }): Promise<SmsProvider | null> {
    const cfg = decryptSmsProviderConfig(this.crypto, realm.smsProviderConfig);
    const str = (key: string) => {
      const value = cfg[key];
      return typeof value === 'string' ? value : null;
    };
    const from = realm.smsFrom;

    switch (realm.smsProvider as SmsProviderType) {
      case SmsProviderType.TWILIO: {
        const { TwilioSmsProvider } =
          await import('./providers/twilio.provider.js');
        return new TwilioSmsProvider({
          accountSid: str('twilioAccountSid'),
          authToken: str('twilioAuthToken'),
          from,
        });
      }
      case SmsProviderType.VONAGE:
        return new VonageSmsProvider({
          apiKey: str('vonageApiKey'),
          apiSecret: str('vonageApiSecret'),
          from,
        });
      case SmsProviderType.AWS_SNS:
        return new AwsSnsProvider({
          accessKeyId: str('awsAccessKeyId'),
          secretAccessKey: str('awsSecretAccessKey'),
          region: str('awsRegion'),
          from,
        });
      case SmsProviderType.WEBHOOK:
        return new WebhookSmsProvider({
          url: str('webhookUrl'),
          headers: str('webhookHeaders'),
          timeoutMs:
            typeof cfg['webhookTimeout'] === 'number'
              ? cfg['webhookTimeout']
              : null,
        });
      default:
        this.logger.warn(`Unknown SMS provider type: ${realm.smsProvider}`);
        return null;
    }
  }

  async sendSms(realmName: string, to: string, message: string): Promise<void> {
    const realm = await this.prisma.realm.findUnique({
      where: { name: realmName },
      select: {
        smsProvider: true,
        smsProviderConfig: true,
        smsFrom: true,
      },
    });

    if (!realm?.smsProvider || realm.smsProvider === 'none') {
      this.logger.warn(
        `SMS not configured for realm "${realmName}", skipping SMS to ${to}`,
      );
      return;
    }

    const provider = await this.createProvider(realm);
    if (!provider) {
      this.logger.error(
        `Failed to create SMS provider for realm "${realmName}"`,
      );
      throw new Error(
        `SMS provider "${realm.smsProvider}" could not be instantiated`,
      );
    }

    try {
      await provider.sendSms(to, message);
      this.logger.log(
        `SMS sent to ${to} (realm: ${realmName}, provider: ${realm.smsProvider})`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to send SMS to ${to} (realm: ${realmName}): ${errorMessage}`,
      );
      throw error;
    }
  }
}
