import { Injectable, Logger } from '@nestjs/common';
import * as twilio from 'twilio';
import type { Client } from 'twilio';
import { SmsProvider } from './sms-provider.interface.js';

@Injectable()
export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio';
  private readonly logger = new Logger(TwilioSmsProvider.name);
  private client: Client | null = null;
  private fromNumber: string | null = null;

  constructor() {
    this.initializeClient();
  }

  private initializeClient(): void {
    const accountSid = process.env['TWILIO_ACCOUNT_SID'];
    const authToken = process.env['TWILIO_AUTH_TOKEN'];
    this.fromNumber = process.env['TWILIO_PHONE_NUMBER'] ?? null;

    if (accountSid && authToken) {
      this.client = twilio(accountSid, authToken);
      this.logger.log('Twilio SMS provider initialized');
    } else {
      this.logger.warn('Twilio credentials not configured - set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN');
    }
  }

  async sendSms(to: string, message: string): Promise<void> {
    if (!this.client) {
      throw new Error('Twilio client not initialized');
    }

    if (!this.fromNumber) {
      throw new Error('Twilio phone number not configured - set TWILIO_PHONE_NUMBER');
    }

    try {
      await this.client.messages.create({
        body: message,
        from: this.fromNumber,
        to,
      });

      this.logger.log(`SMS sent to ${to}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to send SMS to ${to}: ${errorMessage}`);
      throw new Error(`Twilio SMS failed: ${errorMessage}`);
    }
  }

  isConfigured(): boolean {
    return this.client !== null && this.fromNumber !== null;
  }
}