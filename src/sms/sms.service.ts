import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SmsProvider } from './providers/sms-provider.interface.js';
import { TwilioSmsProvider } from './providers/twilio.provider.js';
import { VonageSmsProvider } from './providers/vonage.provider.js';
import { AwsSnsProvider } from './providers/aws-sns.provider.js';
import { WebhookSmsProvider } from './providers/webhook.provider.js';
import { SmsProviderType } from './dto/sms-config.dto.js';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly prisma: PrismaService) {}

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
      },
    });

    if (!realm?.smsProvider || realm.smsProvider === 'none') {
      this.logger.warn(`SMS provider not configured for realm "${realmName}"`);
      return null;
    }

    const provider = this.createProvider(realm.smsProvider as SmsProviderType);
    this.logger.debug(
      `SMS provider "${realm.smsProvider}" requested for realm "${realmName}"`,
    );
    return provider;
  }

  private createProvider(providerType: SmsProviderType): SmsProvider | null {
    switch (providerType) {
      case SmsProviderType.TWILIO:
        return new TwilioSmsProvider();
      case SmsProviderType.VONAGE:
        return new VonageSmsProvider();
      case SmsProviderType.AWS_SNS:
        return new AwsSnsProvider();
      case SmsProviderType.WEBHOOK:
        return new WebhookSmsProvider();
      default:
        this.logger.warn(`Unknown SMS provider type: ${providerType}`);
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

    const provider = this.createProvider(realm.smsProvider as SmsProviderType);
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
