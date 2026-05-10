import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SmsProvider } from './providers/sms-provider.interface.js';

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

    // Provider instantiation will be handled when additional providers are implemented
    this.logger.debug(`SMS provider "${realm.smsProvider}" requested for realm "${realmName}"`);
    return null;
  }

  async sendSms(
    realmName: string,
    to: string,
    message: string,
  ): Promise<void> {
    const realm = await this.prisma.realm.findUnique({
      where: { name: realmName },
      select: {
        smsProvider: true,
        smsProviderConfig: true,
        smsFrom: true,
      },
    });

    if (!realm?.smsProvider || realm.smsProvider === 'none') {
      this.logger.warn(`SMS not configured for realm "${realmName}", skipping SMS to ${to}`);
      return;
    }

    this.logger.log(`SMS would be sent to ${to} (realm: ${realmName}, provider: ${realm.smsProvider})`);
  }
}
