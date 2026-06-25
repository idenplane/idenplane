import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { EmailProvider } from './email-provider.interface.js';

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  password?: string;
  from: string;
  secure: boolean;
}

export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  private readonly logger = new Logger(SmtpEmailProvider.name);

  constructor(private readonly config: SmtpConfig) {}

  isConfigured(): boolean {
    return !!this.config.host;
  }

  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    const transporter = nodemailer.createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: this.config.user
        ? { user: this.config.user, pass: this.config.password ?? '' }
        : undefined,
    });

    await transporter.sendMail({
      from: this.config.from || `noreply@${this.config.host}`,
      to,
      subject,
      html,
    });

    this.logger.log(`SMTP email sent to ${to}`);
  }
}
