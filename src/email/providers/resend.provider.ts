import { Logger } from '@nestjs/common';
import { EmailProvider } from './email-provider.interface.js';

export interface ResendConfig {
  apiKey: string;
  from: string;
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  private readonly logger = new Logger(ResendEmailProvider.name);

  constructor(private readonly config: ResendConfig) {}

  isConfigured(): boolean {
    return !!this.config.apiKey && !!this.config.from;
  }

  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.config.from,
        to,
        subject,
        html,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Resend API error ${response.status}: ${body}`);
    }

    this.logger.log(`Resend email sent to ${to}`);
  }
}
