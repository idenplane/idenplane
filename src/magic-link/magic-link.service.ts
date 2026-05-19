import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { EmailService } from '../email/email.service.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import type { RateLimitResult } from '../rate-limit/rate-limit.dto.js';
import { MagicLinkStatus } from '@prisma/client';

export interface MagicLinkRequestResult {
  success: boolean;
  message: string;
  rateLimit?: RateLimitResult;
}

export interface MagicLinkValidateResult {
  valid: boolean;
  error?: string;
  userId?: string;
  email?: string;
  realmId?: string;
}

@Injectable()
export class MagicLinkService {
  private readonly logger = new Logger(MagicLinkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly rateLimit: RateLimitService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Request a magic link to be sent to the specified email.
   * Generates a token, stores it hashed, and sends the email.
   * Never throws — returns a result object to prevent information leakage.
   */
  async requestMagicLink(
    email: string,
    realmId: string,
    ipAddress?: string,
    userAgent?: string,
    magicLinkUrl?: string,
  ): Promise<MagicLinkRequestResult> {
    // 1. Validate realm has magic link enabled
    const realm = await this.prisma.realm.findUnique({
      where: { id: realmId },
      select: {
        id: true,
        name: true,
        magicLinkEnabled: true,
        magicLinkExpirySeconds: true,
        magicLinkRateLimitPerEmail: true,
        magicLinkEmailSubject: true,
        magicLinkEmailTemplate: true,
        theme: true,
      },
    });

    if (!realm) {
      return { success: false, message: 'Realm not found' };
    }

    if (!realm.magicLinkEnabled) {
      return {
        success: false,
        message: 'Magic link authentication is not enabled for this realm',
      };
    }

    // 2. Check IP rate limit first (if IP is available)
    if (ipAddress) {
      const ipRateLimit = await this.rateLimit.checkIpLimit(ipAddress, realmId);
      if (!ipRateLimit.allowed) {
        return {
          success: false,
          message: 'Too many requests. Please try again later.',
          rateLimit: ipRateLimit,
        };
      }
    }

    // 3. Find user by email in this realm (includes disabled users for explicit error)
    const normalizedEmail = email.toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { realmId, email: normalizedEmail },
      select: { id: true, email: true, enabled: true },
    });

    if (!user) {
      // Don't reveal whether the email exists - anti-email-enumeration
      this.logger.log(
        `Magic link requested for unknown email ${email} in realm ${realm.name}`,
      );
      return {
        success: true,
        message:
          'If an account exists with this email, a magic link has been sent',
      };
    }

    if (!user.enabled) {
      return { success: false, message: 'User account is disabled' };
    }

    // 4. Check email-based rate limit
    const recentCount = await this.prisma.magicLinkRequest.count({
      where: {
        realmId,
        email: normalizedEmail,
        createdAt: { gte: new Date(Date.now() - 900 * 1000) },
      },
    });

    const emailLimit = realm.magicLinkRateLimitPerEmail ?? 5;
    if (recentCount >= emailLimit) {
      this.logger.warn(
        `Rate limit exceeded for email ${email} in realm ${realmId}`,
      );
      return {
        success: false,
        message: 'Too many requests. Please try again later.',
      };
    }

    // 5. Cancel any existing pending magic link requests for this user in this realm
    await this.cancelPendingRequests(user.id, realmId);

    // 6. Generate token and hash
    const rawToken = this.crypto.generateSecret(32);
    const tokenHash = this.crypto.sha256(rawToken);

    // 7. Calculate expiry (default 600 seconds / 10 minutes)
    const expiresAt = new Date(
      Date.now() + (realm.magicLinkExpirySeconds ?? 600) * 1000,
    );

    // 8. Store the magic link request
    await this.prisma.magicLinkRequest.create({
      data: {
        realmId,
        userId: user.id,
        email: normalizedEmail,
        tokenHash,
        expiresAt,
        ipAddress,
        userAgent,
      },
    });

    // 9. Build the magic link URL
    const baseUrl = magicLinkUrl ?? `https://${realm.name}/auth/magic-link`;
    const magicLinkFullUrl = `${baseUrl}?token=${rawToken}`;

    // 10. Get email subject from realm config or use default
    const emailSubject = realm.magicLinkEmailSubject ?? 'Sign in to AuthMe';

    // 11. Send the email
    await this.emailService.sendEmail(
      realm.name,
      normalizedEmail,
      emailSubject,
      this.buildMagicLinkEmailHtml(realm, magicLinkFullUrl),
    );

    this.logger.log(`Magic link sent to ${user.email} for realm ${realm.name}`);

    return {
      success: true,
      message: 'Magic link sent successfully',
    };
  }

  /**
   * Validate a magic link token and mark it as completed.
   * Never throws — returns a result object.
   */
  async validateMagicLink(
    rawToken: string,
    realmName?: string,
  ): Promise<MagicLinkValidateResult> {
    const tokenHash = this.crypto.sha256(rawToken);

    const request = await this.prisma.magicLinkRequest.findUnique({
      where: { tokenHash },
      include: {
        realm: { select: { id: true, name: true, magicLinkEnabled: true } },
        user: { select: { id: true, email: true, enabled: true } },
      },
    });

    if (!request) {
      return { valid: false, error: 'Invalid or expired token' };
    }

    if (!request.realm.magicLinkEnabled) {
      return {
        valid: false,
        error: 'Magic link authentication is not enabled',
      };
    }

    if (realmName && request.realm.name !== realmName) {
      return { valid: false, error: 'Invalid realm' };
    }

    if (!request.user.enabled) {
      return { valid: false, error: 'User account is disabled' };
    }

    if (request.status === MagicLinkStatus.COMPLETED) {
      return { valid: false, error: 'This link has already been used' };
    }

    if (request.status === MagicLinkStatus.CANCELLED) {
      return { valid: false, error: 'This link has been cancelled' };
    }

    if (request.expiresAt < new Date()) {
      if (request.status === MagicLinkStatus.PENDING) {
        await this.prisma.magicLinkRequest.update({
          where: { id: request.id },
          data: { status: MagicLinkStatus.EXPIRED },
        });
      }
      return { valid: false, error: 'This link has expired' };
    }

    if (request.status !== MagicLinkStatus.PENDING) {
      return { valid: false, error: 'Invalid or expired token' };
    }

    // Mark as completed (one-time use)
    await this.prisma.magicLinkRequest.update({
      where: { id: request.id },
      data: { status: MagicLinkStatus.COMPLETED, completedAt: new Date() },
    });

    this.logger.log(`Magic link validated for user ${request.userId}`);

    return {
      valid: true,
      userId: request.user.id,
      email: request.user.email ?? undefined,
      realmId: request.realm.id,
    };
  }

  /**
   * Cancel all pending magic link requests for a user in a realm.
   */
  async cancelPendingRequests(
    userId: string,
    realmId: string,
  ): Promise<number> {
    const result = await this.prisma.magicLinkRequest.updateMany({
      where: { userId, realmId, status: MagicLinkStatus.PENDING },
      data: { status: MagicLinkStatus.CANCELLED },
    });
    return result?.count ?? 0;
  }

  /**
   * Mark expired pending magic link requests as EXPIRED.
   * Should be run periodically via a scheduler.
   */
  async cleanupExpiredRequests(): Promise<number> {
    const result = await this.prisma.magicLinkRequest.updateMany({
      where: {
        status: MagicLinkStatus.PENDING,
        expiresAt: { lt: new Date() },
      },
      data: {
        status: MagicLinkStatus.EXPIRED,
      },
    });
    return result.count;
  }

  // ── Private helpers ─────────────────────────────────────

  private extractPrimaryColor(theme: unknown): string {
    if (theme && typeof theme === 'object') {
      const t = theme as Record<string, unknown>;
      if (typeof t['primaryColor'] === 'string') {
        return t['primaryColor'];
      }
    }
    return '#3b82f6';
  }

  private buildMagicLinkEmailHtml(
    realm: { name: string; theme?: unknown },
    magicLinkUrl: string,
  ): string {
    const primaryColor = this.extractPrimaryColor(realm.theme);

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111;">
  <h2 style="color:${primaryColor};margin-bottom:16px;">Sign in to AuthMe</h2>
  <p style="margin-bottom:24px;">Click the link below to sign in to your account. This link expires in 10 minutes.</p>
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
}
