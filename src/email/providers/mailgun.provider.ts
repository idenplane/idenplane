import { Logger } from '@nestjs/common';
import { EmailProvider } from './email-provider.interface.js';

export interface MailgunConfig {
  apiKey: string;
  domain: string;
  from: string;
  region?: string;
}

export class MailgunEmailProvider implements EmailProvider {
  readonly name = 'mailgun';
  private readonly logger = new Logger(MailgunEmailProvider.name);

  constructor(private readonly config: MailgunConfig) {}

  isConfigured(): boolean {
    return !!this.config.apiKey && !!this.config.domain && !!this.config.from;
  }

  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    const baseUrl =
      this.config.region === 'eu'
        ? 'https://api.eu.mailgun.net'
        : 'https://api.mailgun.net';

    const url = `${baseUrl}/v3/${this.config.domain}/messages`;
    const credentials = Buffer.from(`api:${this.config.apiKey}`).toString(
      'base64',
    );

    const body = new URLSearchParams({
      from: this.config.from,
      to,
      subject,
      html,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Mailgun API error ${response.status}: ${text}`);
    }

    this.logger.log(`Mailgun email sent to ${to}`);
  }
}
