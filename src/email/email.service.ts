import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import sanitizeHtml from 'sanitize-html';
import { EmailProvider } from './providers/email-provider.interface.js';
import { SmtpEmailProvider } from './providers/smtp.provider.js';
import { ResendEmailProvider } from './providers/resend.provider.js';
import { SendGridEmailProvider } from './providers/sendgrid.provider.js';
import { MailgunEmailProvider } from './providers/mailgun.provider.js';
import { PostmarkEmailProvider } from './providers/postmark.provider.js';
import { EmailProviderType } from './dto/email-config.dto.js';

// Allow the markup our email templates actually use (headings, basic text,
// links, simple tables) while stripping scripts, event handlers, and dangerous
// URL schemes. Applied to every outgoing body so no caller can inject markup
// from user-controlled values (CodeQL js/xss).
const EMAIL_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...sanitizeHtml.defaults.allowedTags, 'h1', 'h2'],
  allowedAttributes: { '*': ['href', 'style', 'class', 'align', 'target'] },
  allowedSchemes: ['http', 'https', 'mailto'],
};

type RealmEmailData = {
  emailProvider: string | null;
  emailProviderConfig: unknown;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpPassword: string | null;
  smtpFrom: string | null;
  smtpSecure: boolean;
};

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly prisma: PrismaService) {}

  async isConfigured(realmName: string): Promise<boolean> {
    const realm = await this.prisma.realm.findUnique({
      where: { name: realmName },
      select: { emailProvider: true, smtpHost: true },
    });

    if (!realm) return false;

    const provider = realm.emailProvider ?? EmailProviderType.SMTP;
    if (provider === EmailProviderType.NONE) return false;
    if (provider === EmailProviderType.SMTP) return !!realm.smtpHost;
    return true;
  }

  async sendTestEmail(
    realmName: string,
  ): Promise<{ success: boolean; error?: string }> {
    const realm = await this.prisma.realm.findUnique({
      where: { name: realmName },
      select: {
        emailProvider: true,
        emailProviderConfig: true,
        smtpHost: true,
        smtpPort: true,
        smtpUser: true,
        smtpPassword: true,
        smtpFrom: true,
        smtpSecure: true,
      },
    });

    const provider = this.createProvider(realm as RealmEmailData | null);

    if (!provider || !provider.isConfigured()) {
      return {
        success: false,
        error: 'Email provider not configured for this realm',
      };
    }

    try {
      const from = this.getFromAddress(realm as RealmEmailData);
      await provider.sendEmail(
        from,
        'Idenplane Email Test',
        '<p>This is a test email from Idenplane setup wizard.</p>',
      );

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
        emailProvider: true,
        emailProviderConfig: true,
        smtpHost: true,
        smtpPort: true,
        smtpUser: true,
        smtpPassword: true,
        smtpFrom: true,
        smtpSecure: true,
      },
    });

    const provider = this.createProvider(realm as RealmEmailData | null);

    if (!provider || !provider.isConfigured()) {
      this.logger.warn(
        `Email not configured for realm "${realmName}" — skipping email to ${to}. ` +
          `Configure via PATCH /admin/realms/${realmName} with emailProvider and emailProviderConfig ` +
          `(or legacy smtpHost/smtpPort/smtpUser/smtpPassword/smtpFrom/smtpSecure for SMTP).`,
      );
      return;
    }

    await provider.sendEmail(
      to,
      subject,
      // Sanitize the whole body at the sink so any user-controlled value from
      // any caller is neutralized before delivery (CodeQL js/xss).
      sanitizeHtml(html, EMAIL_SANITIZE_OPTIONS),
    );

    this.logger.log(
      `Email sent to ${to} (realm: ${realmName}, provider: ${provider.name}, subject: ${subject})`,
    );
  }

  private createProvider(realm: RealmEmailData | null): EmailProvider | null {
    if (!realm) return null;

    const providerType = (realm.emailProvider ??
      EmailProviderType.SMTP) as EmailProviderType;
    const config =
      (realm.emailProviderConfig as Record<string, unknown> | null) ?? {};

    switch (providerType) {
      case EmailProviderType.NONE:
        return null;

      case EmailProviderType.SMTP:
        return new SmtpEmailProvider({
          host: realm.smtpHost ?? '',
          port: realm.smtpPort ?? 587,
          user: realm.smtpUser ?? undefined,
          password: realm.smtpPassword ?? undefined,
          from: realm.smtpFrom ?? '',
          secure: realm.smtpSecure ?? false,
        });

      case EmailProviderType.RESEND: {
        const rc = (config['resend'] as Record<string, unknown> | undefined) ?? config;
        return new ResendEmailProvider({
          apiKey: (rc['apiKey'] as string) ?? '',
          from: (rc['from'] as string) ?? '',
        });
      }

      case EmailProviderType.SENDGRID: {
        const sc = (config['sendgrid'] as Record<string, unknown> | undefined) ?? config;
        return new SendGridEmailProvider({
          apiKey: (sc['apiKey'] as string) ?? '',
          from: (sc['from'] as string) ?? '',
        });
      }

      case EmailProviderType.MAILGUN: {
        const mc = (config['mailgun'] as Record<string, unknown> | undefined) ?? config;
        return new MailgunEmailProvider({
          apiKey: (mc['apiKey'] as string) ?? '',
          domain: (mc['domain'] as string) ?? '',
          from: (mc['from'] as string) ?? '',
          region: (mc['region'] as string) ?? 'us',
        });
      }

      case EmailProviderType.POSTMARK: {
        const pc = (config['postmark'] as Record<string, unknown> | undefined) ?? config;
        return new PostmarkEmailProvider({
          serverToken: (pc['serverToken'] as string) ?? '',
          from: (pc['from'] as string) ?? '',
        });
      }

      default:
        this.logger.warn(`Unknown email provider type: ${providerType}`);
        return null;
    }
  }

  private getFromAddress(realm: RealmEmailData | null): string {
    if (!realm) return '';
    const providerType = (realm.emailProvider ??
      EmailProviderType.SMTP) as EmailProviderType;

    if (providerType === EmailProviderType.SMTP) {
      return realm.smtpFrom ?? `noreply@${realm.smtpHost ?? 'localhost'}`;
    }

    const config =
      (realm.emailProviderConfig as Record<string, unknown> | null) ?? {};
    const nested =
      (config[providerType] as Record<string, unknown> | undefined) ?? config;
    return (nested['from'] as string) ?? '';
  }
}
