import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider } from './sms-provider.interface.js';

@Injectable()
export class VonageSmsProvider implements SmsProvider {
  readonly name = 'vonage';
  private readonly logger = new Logger(VonageSmsProvider.name);
  private apiKey: string | null = null;
  private apiSecret: string | null = null;
  private fromNumber: string | null = null;

  constructor() {
    this.initializeClient();
  }

  private initializeClient(): void {
    this.apiKey = process.env['VONAGE_API_KEY'] ?? null;
    this.apiSecret = process.env['VONAGE_API_SECRET'] ?? null;
    this.fromNumber = process.env['VONAGE_PHONE_NUMBER'] ?? null;

    if (this.apiKey && this.apiSecret) {
      this.logger.log('Vonage SMS provider initialized');
    } else {
      this.logger.warn(
        'Vonage credentials not configured - set VONAGE_API_KEY and VONAGE_API_SECRET',
      );
    }
  }

  async sendSms(to: string, message: string): Promise<void> {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error('Vonage client not initialized');
    }

    if (!this.fromNumber) {
      throw new Error(
        'Vonage phone number not configured - set VONAGE_PHONE_NUMBER',
      );
    }

    try {
      const response = await fetch('https://rest.nexmo.com/sms/json', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: this.apiKey,
          api_secret: this.apiSecret,
          from: this.fromNumber,
          to: to,
          text: message,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Vonage API error: ${response.status} ${errorBody}`);
      }

      const result = (await response.json()) as {
        messages: Array<{ status: string; 'error-text'?: string }>;
      };

      const failedMessage = result.messages.find((msg) => msg.status !== '0');
      if (failedMessage) {
        throw new Error(
          `Vonage SMS failed: ${failedMessage['error-text'] ?? 'Unknown error'}`,
        );
      }

      this.logger.log(`SMS sent to ${to}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Vonage')) {
        throw error;
      }
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to send SMS to ${to}: ${errorMessage}`);
      throw new Error(`Vonage SMS failed: ${errorMessage}`, { cause: error });
    }
  }

  isConfigured(): boolean {
    return (
      this.apiKey !== null &&
      this.apiSecret !== null &&
      this.fromNumber !== null
    );
  }
}
