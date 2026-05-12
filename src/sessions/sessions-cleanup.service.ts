import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class SessionsCleanupService {
  private readonly logger = new Logger(SessionsCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Interval(3_600_000) // every hour
  async cleanupExpiredSessions(): Promise<void> {
    const now = new Date();

    // Delete expired OAuth sessions.  RefreshTokens are deleted automatically
    // via the onDelete: Cascade relation defined in the Prisma schema.
    const oauthResult = await this.prisma.session.deleteMany({
      where: { expiresAt: { lt: now } },
    });

    // Delete expired SSO / browser login sessions.
    const ssoResult = await this.prisma.loginSession.deleteMany({
      where: { expiresAt: { lt: now } },
    });

    // Delete any refresh tokens that have individually expired but whose
    // parent session is still alive (e.g. offline tokens with a shorter TTL).
    const refreshResult = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: now } },
    });

    // Delete expired authorization codes that were never exchanged.
    const authCodeResult = await this.prisma.authorizationCode.deleteMany({
      where: { expiresAt: { lt: now } },
    });

    // Delete expired impersonation sessions.
    const impersonationResult =
      await this.prisma.impersonationSession.deleteMany({
        where: { expiresAt: { lt: now } },
      });

    const total =
      oauthResult.count +
      ssoResult.count +
      refreshResult.count +
      authCodeResult.count +
      impersonationResult.count;

    if (total > 0) {
      this.logger.debug(
        `Session cleanup removed ${oauthResult.count} OAuth session(s), ` +
          `${ssoResult.count} SSO session(s), ` +
          `${refreshResult.count} refresh token(s), ` +
          `${authCodeResult.count} authorization code(s), ` +
          `${impersonationResult.count} impersonation session(s)`,
      );
    }
  }
}
