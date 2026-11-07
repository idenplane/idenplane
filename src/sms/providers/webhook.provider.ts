import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider } from './sms-provider.interface.js';
import { safePost } from '../../common/security/safe-http-client.js';

interface WebhookHeader {
  name: string;
  value: string;
}

/** Per-realm settings; any field left empty falls back to the SMS_WEBHOOK_* env. */
export interface WebhookSmsOptions {
  url?: string | null;
  /** JSON: `{"Header": "value"}` or `[{"name": "Header", "value": "value"}]`. */
  headers?: string | null;
  timeoutMs?: number | null;
}

/**
 * Parse a headers setting. The env variable has always used a list of
 * `{name, value}`; the admin UI sends a plain object, which is what people
 * write by hand. Accept both. Returns null when the JSON is unusable.
 */
function parseHeaders(raw: string): WebhookHeader[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (Array.isArray(parsed)) {
    return (parsed as unknown[]).filter((h): h is WebhookHeader => {
      const header = h as Partial<WebhookHeader> | null;
      return (
        typeof header?.name === 'string' && typeof header?.value === 'string'
      );
    });
  }
  if (typeof parsed === 'object' && parsed !== null) {
    return Object.entries(parsed)
      .filter(([, value]) => typeof value === 'string')
      .map(([name, value]) => ({ name, value: value as string }));
  }
  return null;
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

  constructor(options: WebhookSmsOptions = {}) {
    this.initializeClient(options);
  }

  private initializeClient(options: WebhookSmsOptions): void {
    this.webhookUrl = options.url || process.env['SMS_WEBHOOK_URL'] || null;

    const headersConfig = options.headers || process.env['SMS_WEBHOOK_HEADERS'];
    if (headersConfig) {
      const parsed = parseHeaders(headersConfig);
      if (parsed) {
        this.headers = parsed;
      } else {
        this.logger.warn('Invalid webhook headers JSON - using defaults only');
        this.headers = [];
      }
    }

    if (options.timeoutMs && options.timeoutMs > 0) {
      this.timeoutMs = options.timeoutMs;
    } else {
      const timeoutEnv = process.env['SMS_WEBHOOK_TIMEOUT_MS'];
      if (timeoutEnv) {
        const parsed = parseInt(timeoutEnv, 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
          this.timeoutMs = parsed;
        }
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

    try {
      // Delivered through the SSRF-safe client (same guard as the event
      // webhooks): SMS_WEBHOOK_URL is operator-supplied configuration, so
      // without this the provider would happily POST to a loopback or
      // cloud-metadata address.
      const response = await safePost(
        this.webhookUrl,
        JSON.stringify(requestBody),
        requestHeaders,
        { timeoutMs: this.timeoutMs },
      );

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(
          `Webhook API error: ${response.statusCode} ${response.body}`,
        );
      }

      this.logger.log(`SMS sent via webhook to ${to}`);
    } catch (error) {
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
