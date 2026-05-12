import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { EmailService } from '../email/email.service.js';
import { MagicLinkRequest, MagicLinkStatus, User, Realm } from '@prisma/client';

@Injectable()
export class MagicLinkService {
  private readonly logger = new Logger(MagicLinkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Request a magic link to be sent to the specified email.
   * Generates a token, stores it hashed, and sends the email.
   */
  async requestMagicLink(
    realmId: string,
    email: string,
    ipAddress?: string,
    userAgent?: string,
    magicLinkUrl?: string,
  ): Promise<{ success: boolean; message: string }> {
    // 1. Validate realm has magic link enabled
    const realm = await this.prisma.realm.findUnique({
      where: { id: realmId },
      select: {
        id: true,
        name: true,
        magicLinkEnabled: true,
        magicLinkExpirySeconds: true,
        magicLinkRateLimitPerEmail: true,
        magicLinkRateLimitWindowSeconds: true,
        magicLinkEmailSubject: true,
        magicLinkEmailTemplate: true,
        theme: true,
      },
    });

    if (!realm) {
      throw new NotFoundException(`Realm not found`);
    }

    if (!realm.magicLinkEnabled) {
      throw new BadRequestException(
        'Magic link authentication is not enabled for this realm',
      );
    }

    // 2. Find user by email in this realm
    const user = await this.prisma.user.findFirst({
      where: { realmId, email: email.toLowerCase(), enabled: true },
      select: { id: true, email: true, username: true },
    });

    if (!user) {
      // Don't reveal whether the email exists - still return success to prevent email enumeration
      this.logger.log(
        `Magic link requested for unknown email ${email} in realm ${realm.name}`,
      );
      return {
        success: true,
        message: 'If the email is registered, a magic link will be sent',
      };
    }

    // 3. Check rate limit per email
    const rateLimitOk = await this.checkRateLimit(
      realmId,
      email,
      ipAddress,
      realm.magicLinkRateLimitPerEmail,
      realm.magicLinkRateLimitWindowSeconds,
    );
    if (!rateLimitOk) {
      throw new BadRequestException(
        'Too many magic link requests. Please try again later.',
      );
    }

    // 4. Cancel any existing pending magic link requests for this user
    await this.cancelPendingRequests(user.id);

    // 5. Generate token and hash
    const rawToken = this.crypto.generateSecret(32);
    const tokenHash = this.crypto.sha256(rawToken);

    // 6. Calculate expiry
    const expiresAt = new Date(
      Date.now() + (realm.magicLinkExpirySeconds ?? 300) * 1000,
    );

    // 7. Store the magic link request
    await this.prisma.magicLinkRequest.create({
      data: {
        realmId,
        userId: user.id,
        email: user.email!,
        tokenHash,
        status: MagicLinkStatus.PENDING,
        expiresAt,
        ipAddress,
        userAgent,
      },
    });

    // 8. Build the magic link URL
    const baseUrl = magicLinkUrl ?? `https://${realm.name}/auth/magic-link`;
    const magicLinkFullUrl = `${baseUrl}?token=${rawToken}`;

    // 9. Get email subject from realm config or use default
    const emailSubject = realm.magicLinkEmailSubject ?? 'Sign in to AuthMe';

    // 10. Send the email using Handlebars template
    await this.emailService.sendEmail(
      realm.name,
      user.email!,
      emailSubject,
      this.buildMagicLinkEmailHtml(
        realm,
        magicLinkFullUrl,
        realm.magicLinkEmailTemplate,
      ),
    );

    this.logger.log(`Magic link sent to ${user.email} for realm ${realm.name}`);

    return {
      success: true,
      message: 'If the email is registered, a magic link will be sent',
    };
  }

  /**
   * Validate a magic link token and mark it as completed.
   * Returns the userId if valid.
   */
  async validateMagicLink(
    rawToken: string,
  ): Promise<{ userId: string; email: string }> {
    const tokenHash = this.crypto.sha256(rawToken);

    const request = await this.prisma.magicLinkRequest.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: { id: true, email: true, realmId: true, enabled: true },
        },
      },
    });

    if (!request) {
      throw new BadRequestException('Invalid or expired magic link');
    }

    if (request.status !== MagicLinkStatus.PENDING) {
      throw new BadRequestException(
        `Magic link has already been ${request.status.toLowerCase()}`,
      );
    }

    if (request.expiresAt < new Date()) {
      // Mark as expired
      await this.prisma.magicLinkRequest.update({
        where: { id: request.id },
        data: { status: MagicLinkStatus.EXPIRED },
      });
      throw new BadRequestException('Magic link has expired');
    }

    if (!request.user.enabled) {
      throw new BadRequestException('User account is disabled');
    }

    // Mark as completed (one-time use)
    await this.prisma.magicLinkRequest.update({
      where: { id: request.id },
      data: { status: MagicLinkStatus.COMPLETED, completedAt: new Date() },
    });

    this.logger.log(`Magic link validated for user ${request.userId}`);

    return { userId: request.userId, email: request.email };
  }

  /**
   * Cancel all pending magic link requests for a user.
   */
  async cancelPendingRequests(userId: string): Promise<number> {
    const result = await this.prisma.magicLinkRequest.updateMany({
      where: { userId, status: MagicLinkStatus.PENDING },
      data: { status: MagicLinkStatus.CANCELLED },
    });
    return result.count;
  }

  /**
   * Delete expired magic link requests.
   * Should be run periodically via a scheduler.
   */
  async cleanupExpiredRequests(): Promise<number> {
    const result = await this.prisma.magicLinkRequest.deleteMany({
      where: {
        status: MagicLinkStatus.EXPIRED,
        expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Only delete expired > 24h ago
      },
    });
    return result.count;
  }

  // ── Private helpers ─────────────────────────────────────

  private async checkRateLimit(
    realmId: string,
    email: string,
    ipAddress: string | undefined,
    limitPerEmail: number,
    windowSeconds: number,
  ): Promise<boolean> {
    const windowStart = new Date(Date.now() - (windowSeconds ?? 900) * 1000);

    // Check email-based rate limit
    const emailCount = await this.prisma.magicLinkRequest.count({
      where: {
        realmId,
        email: email.toLowerCase(),
        createdAt: { gte: windowStart },
      },
    });

    if (emailCount >= (limitPerEmail ?? 5)) {
      this.logger.warn(
        `Rate limit exceeded for email ${email} in realm ${realmId}`,
      );
      return false;
    }

    // Check IP-based rate limit (if IP is available)
    if (ipAddress) {
      const ipCount = await this.prisma.magicLinkRequest.count({
        where: {
          realmId,
          ipAddress,
          createdAt: { gte: windowStart },
        },
      });

      // IP limit is 10x the email limit
      if (ipCount >= (limitPerEmail ?? 5) * 10) {
        this.logger.warn(
          `Rate limit exceeded for IP ${ipAddress} in realm ${realmId}`,
        );
        return false;
      }
    }

    return true;
  }

  private buildMagicLinkEmailHtml(
    realm: { theme?: unknown },
    magicLinkUrl: string,
    templateName?: string | null,
  ): string {
    const primaryColor = this.extractPrimaryColor(realm.theme);
    const template = templateName ?? 'magic-link';

    // Inline HTML template - simple and self-contained
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111;">
  <h2 style="color:${primaryColor};margin-bottom:16px;">Sign in to AuthMe</h2>
  <p style="margin-bottom:24px;">Click the link below to sign in to your account. This link expires in 5 minutes.</p>
  <p style="margin-bottom:32px;">
    <a href="${magicLinkUrl}" style="display:inline-block;padding:12px 24px;background:${primaryColor};color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">Sign In</a>
  </p>
  <p style="color:#6b7280;font-size:14px;">If you didn't request this, you can safely ignore this email.</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
  <p style="color:#9ca3af;font-size:12px;">AuthMe Security</p>
</body>
</html>
`;
  }

  private extractPrimaryColor(theme: unknown): string {
    if (!theme || typeof theme !== 'object') return '#3b82f6'; // default blue
    const t = theme as Record<string, unknown>;
    return (t['primaryColor'] as string | undefined) ?? '#3b82f6';
  }
}
