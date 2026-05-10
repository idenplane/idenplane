import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly prisma: PrismaService) {}

  async isConfigured(realmName: string): Promise<boolean> {
    const realm = await this.prisma.realm.findUnique({
      where: { name: realmName },
      select: { smtpHost: true },
    });
    return !!realm?.smtpHost;
  }

  async sendTestEmail(realmName: string): Promise<{ success: boolean; error?: string }> {
    const realm = await this.prisma.realm.findUnique({
      where: { name: realmName },
      select: {
        smtpHost: true,
        smtpPort: true,
        smtpUser: true,
        smtpPassword: true,
        smtpFrom: true,
        smtpSecure: true,
      },
    });

    if (!realm?.smtpHost) {
      return { success: false, error: 'SMTP not configured' };
    }

    try {
      const transporter = nodemailer.createTransport({
        host: realm.smtpHost,
        port: realm.smtpPort ?? 587,
        secure: realm.smtpSecure,
        auth: realm.smtpUser
          ? { user: realm.smtpUser, pass: realm.smtpPassword ?? '' }
          : undefined,
      });

      await transporter.sendMail({
        from: realm.smtpFrom ?? `noreply@${realm.smtpHost}`,
        to: realm.smtpFrom ?? `test@${realm.smtpHost}`,
        subject: 'Authme SMTP Test',
        html: '<p>This is a test email from Authme setup wizard.</p>',
      });

      this.logger.log(`Test email sent successfully for realm "${realmName}"`);
      return { success: true };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Failed to send test email for realm "${realmName}": ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  async sendEmail(
    realmName: string,
    to: string,
    subject: string,
    html: string,
  ): Promise<void> {
    const realm = await this.prisma.realm.findUnique({
      where: { name: realmName },
      select: {
        smtpHost: true,
        smtpPort: true,
        smtpUser: true,
        smtpPassword: true,
        smtpFrom: true,
        smtpSecure: true,
      },
    });

    if (!realm?.smtpHost) {
      this.logger.warn(`SMTP not configured for realm "${realmName}", skipping email to ${to}`);
      return;
    }

    const transporter = nodemailer.createTransport({
      host: realm.smtpHost,
      port: realm.smtpPort ?? 587,
      secure: realm.smtpSecure,
      auth: realm.smtpUser
        ? { user: realm.smtpUser, pass: realm.smtpPassword ?? '' }
        : undefined,
    });

    await transporter.sendMail({
      from: realm.smtpFrom ?? `noreply@${realm.smtpHost}`,
      to,
      subject,
      html,
    });

    this.logger.log(`Email sent to ${to} (realm: ${realmName}, subject: ${subject})`);
  }
}
