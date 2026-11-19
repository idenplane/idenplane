import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { monthOf } from './usage-period.js';

/**
 * How many (month, user) pairs one process remembers as already written.
 * Past it the oldest are forgotten, which only costs a repeated (no-op)
 * insert for a user seen again later in the month.
 */
export const RECORDED_CACHE_LIMIT = 100_000;

/**
 * Records that a user authenticated, for the monthly active users of
 * GET /admin/system/usage. Called at the three places a user is let in:
 *
 * - SessionIssuer.issue: every interactive sign-in that ends in an SSO
 *   session (password, passkey, magic link, a brokered OIDC / SAML / social
 *   sign-in, a custom flow).
 * - AuthService.issueTokens with a session: every OAuth grant that issues a
 *   user's tokens (authorization code, refresh, device code, password,
 *   mfa_otp, forward-auth's code redemption).
 * - SamlIdpService.createSamlResponse: a SAML assertion for a user, also
 *   when it is served from an existing SSO session.
 *
 * Not counted: service accounts (client_credentials issues no session),
 * impersonation, and admin console sign-ins (their own path).
 *
 * Independent of login events: it is written whether a realm records events
 * or not, and is never pruned by the event retention.
 *
 * Cost: one `INSERT ... ON CONFLICT DO NOTHING` per user per month per
 * process. A user already written this month is answered from memory.
 */
@Injectable()
export class UsageActivityRecorder {
  private readonly logger = new Logger(UsageActivityRecorder.name);
  /** `month|userId` already written; insertion-ordered, for eviction. */
  private readonly recorded = new Set<string>();
  private recordedMonth = '';

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records `userId` of `realmId` as active in the current UTC month. Never
   * throws: a failure is logged and the next authentication tries again, so
   * no sign-in fails because of usage metering.
   */
  async record(
    realmId: string,
    userId: string,
    at = new Date(),
  ): Promise<void> {
    const period = monthOf(at);
    if (period.month !== this.recordedMonth) {
      this.recorded.clear();
      this.recordedMonth = period.month;
    }
    const key = `${period.month}|${userId}`;
    if (this.recorded.has(key)) return;

    try {
      await this.prisma.userMonthlyActivity.createMany({
        data: [{ month: period.start, realmId, userId }],
        skipDuplicates: true,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to record monthly activity of user ${userId}: ${(err as Error).message}`,
      );
      return;
    }

    // Only after the row is known to exist; the month may have turned over
    // while the insert ran, in which case the key is simply stale.
    if (period.month !== this.recordedMonth) return;
    if (this.recorded.size >= RECORDED_CACHE_LIMIT) {
      const oldest = this.recorded.values().next().value;
      if (oldest !== undefined) this.recorded.delete(oldest);
    }
    this.recorded.add(key);
  }
}
