import { Logger } from '@nestjs/common';
import { EmailProvider } from './email-provider.interface.js';

export interface PostmarkConfig {
  serverToken: string;
  from: string;
}

export class PostmarkEmailProvider implements EmailProvider {
  readonly name = 'postmark';
  private readonly logger = new Logger(PostmarkEmailProvider.name);

  constructor(private readonly config: PostmarkConfig) {}

  isConfigured(): boolean {
    return !!this.config.serverToken && !!this.config.from;
  }

  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    const response = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'X-Postmark-Server-Token': this.config.serverToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        From: this.config.from,
        To: to,
        Subject: subject,
        HtmlBody: html,
        MessageStream: 'outbound',
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Postmark API error ${response.status}: ${body}`);
    }

    this.logger.log(`Postmark email sent to ${to}`);
  }
}
