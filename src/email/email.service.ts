import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import * as nodemailer from 'nodemailer';
import sanitizeHtml from 'sanitize-html';

// Allow the markup our email templates actually use (headings, basic text,
// links, simple tables) while stripping scripts, event handlers, and dangerous
// URL schemes. Applied to every outgoing body so no caller can inject markup
// from user-controlled values (CodeQL js/xss).
const EMAIL_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...sanitizeHtml.defaults.allowedTags, 'h1', 'h2'],
  allowedAttributes: { '*': ['href', 'style', 'class', 'align', 'target'] },
  allowedSchemes: ['http', 'https', 'mailto'],
};

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

  async sendTestEmail(
    realmName: string,
  ): Promise<{ success: boolean; error?: string }> {
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
        subject: 'Idenplane SMTP Test',
        html: '<p>This is a test email from Idenplane setup wizard.</p>',
      });

      this.logger.log(`Test email sent successfully for realm "${realmName}"`);
      return { success: true };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(
        `Failed to send test email for realm "${realmName}": ${errorMessage}`,
      );
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
      this.logger.warn(
        `SMTP is not configured for realm "${realmName}" — skipping email to ${to}. ` +
          `Email is configured per realm: PATCH /admin/realms/${realmName} with ` +
          `smtpHost/smtpPort/smtpUser/smtpPassword/smtpFrom/smtpSecure. Until then, ` +
          `password-reset / verification emails are silently dropped.`,
      );
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
      // Sanitize the whole body at the sink so any user-controlled value from
      // any caller is neutralized before delivery (CodeQL js/xss).
      html: sanitizeHtml(html, EMAIL_SANITIZE_OPTIONS),
    });

    this.logger.log(
      `Email sent to ${to} (realm: ${realmName}, subject: ${subject})`,
    );
  }
}
