import { Logger } from '@nestjs/common';
import { EmailProvider } from './email-provider.interface.js';

export interface SendGridConfig {
  apiKey: string;
  from: string;
}

export class SendGridEmailProvider implements EmailProvider {
  readonly name = 'sendgrid';
  private readonly logger = new Logger(SendGridEmailProvider.name);

  constructor(private readonly config: SendGridConfig) {}

  isConfigured(): boolean {
    return !!this.config.apiKey && !!this.config.from;
  }

  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: this.config.from },
        subject,
        content: [{ type: 'text/html', value: html }],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`SendGrid API error ${response.status}: ${body}`);
    }

    this.logger.log(`SendGrid email sent to ${to}`);
  }
}
