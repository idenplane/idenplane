import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { EmailService } from '../email/email.service.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { ThemeEmailService } from '../theme/theme-email.service.js';
import { matchesRedirectUri } from '../common/redirect-uri.utils.js';
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
    private readonly themeEmail: ThemeEmailService,
  ) {}

  /**
   * Request a magic link to be sent to the specified email.
   * Generates a token, stores it hashed, and sends the email.
   * Never throws — returns a result object to prevent information leakage.
   */
  async requestMagicLink(
    email: string,
    realmId: string,
    clientId: string,
    ipAddress?: string,
    userAgent?: string,
    magicLinkUrl?: string,
  ): Promise<MagicLinkRequestResult> {
    const realm = await this.prisma.realm.findUnique({
      where: { id: realmId },
      select: {
        id: true,
        name: true,
        magicLinkEnabled: true,
        magicLinkExpirySeconds: true,
        magicLinkRateLimitPerEmail: true,
        magicLinkEmailSubject: true,
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

    // Validate the callback URL against the client's registered redirect URIs.
    // Without this, the @Public() endpoint would let any caller mail a victim
    // a real Idenplane-themed magic-link pointing at an attacker host and
    // exfiltrate the live token — the same risk OAuth solves for redirect_uri.
    const client = await this.prisma.client.findFirst({
      where: { realmId, clientId },
      select: { id: true, redirectUris: true },
    });

    if (!client) {
      return { success: false, message: 'Invalid client' };
    }

    let resolvedCallback: string;
    if (magicLinkUrl) {
      if (!matchesRedirectUri(magicLinkUrl, client.redirectUris)) {
        this.logger.warn(
          `magicLinkUrl "${magicLinkUrl}" not allowlisted for client "${clientId}" in realm "${realm.name}"`,
        );
        return { success: false, message: 'Invalid magic link URL' };
      }
      resolvedCallback = magicLinkUrl;
    } else {
      const fallback = client.redirectUris.find((u) => !u.endsWith('/*'));
      if (!fallback) {
        return {
          success: false,
          message:
            'Client has no usable redirect URI for the magic link callback',
        };
      }
      resolvedCallback = fallback;
    }

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

    const normalizedEmail = email.toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { realmId, email: normalizedEmail },
      select: { id: true, email: true, enabled: true },
    });

    if (!user) {
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

    await this.cancelPendingRequests(user.id, realmId);

    const rawToken = this.crypto.generateSecret(32);
    const tokenHash = this.crypto.sha256(rawToken);

    const expiresAt = new Date(
      Date.now() + (realm.magicLinkExpirySeconds ?? 600) * 1000,
    );

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

    const magicLinkFullUrl = this.appendToken(resolvedCallback, rawToken);

    const fullRealm = await this.prisma.realm.findUnique({
      where: { id: realmId },
    });
    if (!fullRealm) {
      return { success: false, message: 'Realm not found' };
    }

    const emailSubject = this.themeEmail.getSubject(
      fullRealm,
      'magicLinkSubject',
    );
    const html = this.themeEmail.renderEmail(fullRealm, 'magic-link', {
      magicLinkUrl: magicLinkFullUrl,
    });

    await this.emailService.sendEmail(
      realm.name,
      normalizedEmail,
      emailSubject,
      html,
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

  private appendToken(callback: string, rawToken: string): string {
    const separator = callback.includes('?') ? '&' : '?';
    return `${callback}${separator}token=${rawToken}`;
  }
}
