import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider } from './sms-provider.interface.js';

interface WebhookHeader {
  name: string;
  value: string;
}

@Injectable()
export class WebhookSmsProvider implements SmsProvider {
  readonly name = 'webhook';
  private readonly logger = new Logger(WebhookSmsProvider.name);
  private webhookUrl: string | null = null;
  private headers: WebhookHeader[] = [];
  private timeoutMs: number = 30000;
  private readonly defaultHeaders: WebhookHeader[] = [
    { name: 'Content-Type', value: 'application/json' },
  ];

  constructor() {
    this.initializeClient();
  }

  private initializeClient(): void {
    this.webhookUrl = process.env['SMS_WEBHOOK_URL'] ?? null;

    const headersConfig = process.env['SMS_WEBHOOK_HEADERS'];
    if (headersConfig) {
      try {
        this.headers = JSON.parse(headersConfig) as WebhookHeader[];
      } catch {
        this.logger.warn(
          'Invalid SMS_WEBHOOK_HEADERS JSON - using defaults only',
        );
        this.headers = [];
      }
    }

    const timeoutEnv = process.env['SMS_WEBHOOK_TIMEOUT_MS'];
    if (timeoutEnv) {
      const parsed = parseInt(timeoutEnv, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        this.timeoutMs = parsed;
      }
    }

    if (this.webhookUrl) {
      this.logger.log(
        `Webhook SMS provider initialized with URL: ${this.webhookUrl}`,
      );
    } else {
      this.logger.warn('Webhook URL not configured - set SMS_WEBHOOK_URL');
    }
  }

  async sendSms(to: string, message: string): Promise<void> {
    if (!this.webhookUrl) {
      throw new Error(
        'Webhook SMS provider not configured - SMS_WEBHOOK_URL is required',
      );
    }

    const requestHeaders: Record<string, string> = {};
    for (const header of this.defaultHeaders) {
      requestHeaders[header.name] = header.value;
    }
    for (const header of this.headers) {
      requestHeaders[header.name] = header.value;
    }

    const requestBody = {
      to,
      message,
      timestamp: new Date().toISOString(),
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Webhook API error: ${response.status} ${errorBody}`);
      }

      this.logger.log(`SMS sent via webhook to ${to}`);
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error(
            `Webhook SMS failed: Request timeout after ${this.timeoutMs}ms`,
            { cause: error },
          );
        }
        if (error.message.startsWith('Webhook')) {
          throw error;
        }
        throw new Error(`Webhook SMS failed: ${error.message}`, {
          cause: error,
        });
      }
      throw new Error('Webhook SMS failed: Unknown error', { cause: error });
    }
  }

  isConfigured(): boolean {
    return this.webhookUrl !== null && this.webhookUrl.length > 0;
  }
}
