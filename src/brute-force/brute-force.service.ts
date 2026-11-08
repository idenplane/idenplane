import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmailService } from '../email/email.service.js';
import type { Realm, User } from '@prisma/client';

/**
 * PostgreSQL aborted a transaction as a serialization conflict (SQLSTATE
 * 40001). Prisma reports it as P2034; through the pg driver adapter it
 * arrives as a DriverAdapterError whose cause is a TransactionWriteConflict.
 */
function isSerializationConflict(err: unknown): boolean {
  const e = err as {
    code?: string;
    name?: string;
    message?: string;
    cause?: { kind?: string; originalCode?: string; code?: string };
  };
  return (
    e?.code === 'P2034' ||
    e?.code === '40001' ||
    e?.cause?.kind === 'TransactionWriteConflict' ||
    e?.cause?.originalCode === '40001' ||
    e?.cause?.code === '40001' ||
    /TransactionWriteConflict|could not serialize access/.test(e?.message ?? '')
  );
}

@Injectable()
export class BruteForceService {
  private readonly logger = new Logger(BruteForceService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly emailService?: EmailService,
  ) {}

  checkLocked(
    realm: Realm,
    user: User,
  ): { locked: boolean; lockedUntil?: Date } {
    if (!realm.bruteForceEnabled) return { locked: false };
    if (!user.lockedUntil) return { locked: false };

    if (user.lockedUntil > new Date()) {
      return { locked: true, lockedUntil: user.lockedUntil };
    }

    return { locked: false };
  }

  async recordFailure(
    realm: Realm,
    userId: string,
    ipAddress?: string | null,
  ): Promise<void> {
    if (!realm.bruteForceEnabled) return;

    const maxFailures = Math.max(realm.maxLoginFailures, 1);
    const resetTime = Math.max(realm.failureResetTime, 1);
    const lockoutDuration = realm.lockoutDuration;
    const permanentLockoutAfter = realm.permanentLockoutAfter;

    // Serializable, so concurrent failures for one user count correctly; it
    // aborts one of two conflicting transactions (P2034), which is retried
    // so that no failure goes uncounted. The notification goes out once the
    // lockout has committed, never from inside a transaction that may rerun.
    const outcome = await this.withSerializationRetry(() =>
      this.prisma.$transaction(
        async (tx): Promise<'none' | 'locked' | 'permanent'> => {
          await tx.loginFailure.create({
            data: { realmId: realm.id, userId, ipAddress: ipAddress ?? null },
          });

          const windowStart = new Date(Date.now() - resetTime * 1000);
          const failureCount = await tx.loginFailure.count({
            where: {
              realmId: realm.id,
              userId,
              failedAt: { gte: windowStart },
            },
          });

          if (failureCount < maxFailures) return 'none';

          if (permanentLockoutAfter > 0) {
            const totalFailures = await tx.loginFailure.count({
              where: { realmId: realm.id, userId },
            });
            const lockoutCount = Math.floor(totalFailures / maxFailures);

            if (lockoutCount >= permanentLockoutAfter) {
              await tx.user.update({
                where: { id: userId },
                data: {
                  lockedUntil: new Date('2099-12-31T23:59:59Z'),
                  enabled: false,
                },
              });
              this.logger.warn(
                `User ${userId} in realm ${realm.id} permanently locked after ${lockoutCount} lockout cycles`,
              );
              return 'permanent';
            }
          }

          const lockedUntil = new Date(Date.now() + lockoutDuration * 1000);
          await tx.user.update({
            where: { id: userId },
            data: { lockedUntil },
          });
          return 'locked';
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      ),
    );
    if (outcome !== 'none') {
      await this.sendLockoutNotification(
        realm,
        userId,
        outcome === 'permanent',
      );
    }
  }

  /** Reruns `fn` when PostgreSQL aborts it as a serialization conflict. */
  private async withSerializationRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (!isSerializationConflict(err) || attempt >= 10) throw err;
        // Spread the retries so the same transactions do not collide again.
        await new Promise((r) => setTimeout(r, Math.random() * 20 * attempt));
      }
    }
  }

  async resetFailures(realmId: string, userId: string): Promise<void> {
    await this.prisma.loginFailure.deleteMany({
      where: { realmId, userId },
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: { lockedUntil: null },
    });
  }

  async resetTotpFailures(realmId: string, userId: string): Promise<void> {
    await this.prisma.totpFailureTracking.deleteMany({
      where: { userId },
    });
  }

  async recordWebAuthnFailure(
    realm: Realm,
    userId: string,
    ipAddress?: string | null,
  ): Promise<void> {
    if (!realm.bruteForceEnabled) return;

    await this.prisma.webAuthnFailureTracking.create({
      data: { realmId: realm.id, userId, ipAddress: ipAddress ?? null },
    });

    const maxFailures = Math.max(realm.maxLoginFailures, 1);
    const resetTime = Math.max(realm.failureResetTime, 1);
    const windowStart = new Date(Date.now() - resetTime * 1000);

    const failureCount = await this.prisma.webAuthnFailureTracking.count({
      where: {
        realmId: realm.id,
        userId,
        failedAt: { gte: windowStart },
      },
    });

    this.logger.debug(
      `WebAuthn brute force: user=${userId} failures=${failureCount}/${maxFailures} window=${resetTime}s`,
    );

    if (failureCount >= maxFailures) {
      const lockedUntil = new Date(Date.now() + realm.lockoutDuration * 1000);
      await this.prisma.user.update({
        where: { id: userId },
        data: { lockedUntil },
      });
      this.logger.warn(
        `User ${userId} in realm ${realm.id} locked due to WebAuthn brute-force attempts`,
      );
    }
  }

  async resetWebAuthnFailures(realmId: string, userId: string): Promise<void> {
    await this.prisma.webAuthnFailureTracking.deleteMany({
      where: { realmId, userId },
    });
  }

  async recordTotpFailure(
    realm: Realm,
    userId: string,
    ipAddress?: string | null,
  ): Promise<void> {
    if (!realm.bruteForceEnabled) return;

    await this.prisma.totpFailureTracking.create({
      data: { userId, ipAddress: ipAddress ?? null },
    });

    const maxFailures = Math.max(realm.maxLoginFailures, 1);
    const resetTime = Math.max(realm.failureResetTime, 1);
    const windowStart = new Date(Date.now() - resetTime * 1000);

    const failureCount = await this.prisma.totpFailureTracking.count({
      where: {
        userId,
        failedAt: { gte: windowStart },
      },
    });

    this.logger.debug(
      `TOTP brute force: user=${userId} failures=${failureCount}/${maxFailures} window=${resetTime}s`,
    );

    if (failureCount >= maxFailures) {
      const lockedUntil = new Date(Date.now() + realm.lockoutDuration * 1000);
      await this.prisma.user.update({
        where: { id: userId },
        data: { lockedUntil },
      });
      this.logger.warn(
        `User ${userId} in realm ${realm.id} locked due to TOTP brute-force attempts`,
      );
      await this.sendLockoutNotification(realm, userId, false);
    }
  }

  async checkTotpRateLimit(
    realm: Realm,
    userId: string,
  ): Promise<{
    blocked: boolean;
    remainingAttempts: number;
    retryAfterSeconds?: number;
  }> {
    if (!realm.bruteForceEnabled) {
      return { blocked: false, remainingAttempts: -1 };
    }

    const maxFailures = Math.max(realm.maxLoginFailures, 1);
    const resetTime = Math.max(realm.failureResetTime, 1);
    const windowStart = new Date(Date.now() - resetTime * 1000);

    const failureCount = await this.prisma.totpFailureTracking.count({
      where: {
        userId,
        failedAt: { gte: windowStart },
      },
    });

    if (failureCount >= maxFailures) {
      const oldestFailure = await this.prisma.totpFailureTracking.findFirst({
        where: { userId, failedAt: { gte: windowStart } },
        orderBy: { failedAt: 'asc' },
        select: { failedAt: true },
      });

      let retryAfterSeconds: number | undefined;
      if (oldestFailure) {
        const retryAfterMs =
          oldestFailure.failedAt.getTime() + resetTime * 1000 - Date.now();
        retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
      }

      return {
        blocked: true,
        remainingAttempts: 0,
        retryAfterSeconds,
      };
    }

    return {
      blocked: false,
      remainingAttempts: maxFailures - failureCount,
    };
  }

  private async sendLockoutNotification(
    realm: Realm,
    userId: string,
    permanent: boolean,
  ): Promise<void> {
    if (!this.emailService) return;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, username: true },
    });

    if (!user?.email) return;

    const html = permanent
      ? `
        <h2>Account Permanently Locked</h2>
        <p>Your account <strong>${user.username}</strong> in realm <strong>${realm.name}</strong> has been permanently locked due to multiple failed login attempts.</p>
        <p>Please contact your administrator to regain access to your account.</p>
      `
      : `
        <h2>Account Temporarily Locked</h2>
        <p>Your account <strong>${user.username}</strong> in realm <strong>${realm.name}</strong> has been temporarily locked due to multiple failed login attempts.</p>
        <p>The lockout will automatically expire after the configured duration. If you did not attempt to log in, please contact your administrator.</p>
      `;

    try {
      await this.emailService.sendEmail(
        realm.name,
        user.email,
        permanent ? 'Account Permanently Locked' : 'Account Temporarily Locked',
        html,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to send lockout notification email to ${user.email}: ${(err as Error).message}`,
      );
    }
  }

  async unlockUser(realmId: string, userId: string): Promise<void> {
    // Verify the user exists and belongs to the specified realm before unlocking.
    // Without this check, a caller with access to realm A could unlock (or
    // manipulate) a user that lives in realm B simply by knowing their userId.
    const user = await this.prisma.user.findFirst({
      where: { id: userId, realmId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException(`User not found`);
    }

    // Clear the lock on the user record - update only affects this realm's user
    await this.prisma.user.update({
      where: { id: userId, realmId },
      data: { lockedUntil: null, enabled: true },
    });
    // Also delete all stored failure records for this user.  Without this,
    // recordFailure() would count the old failures on the very next login
    // attempt and immediately re-lock the account.
    await this.prisma.loginFailure.deleteMany({
      where: { realmId, userId },
    });
  }

  async getLockedUsers(realmId: string) {
    return this.prisma.user.findMany({
      where: {
        realmId,
        lockedUntil: { gt: new Date() },
      },
      select: {
        id: true,
        username: true,
        email: true,
        lockedUntil: true,
      },
    });
  }

  @Interval(300_000) // every 5 minutes
  async cleanupOldFailures(): Promise<void> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { count: loginCount } = await this.prisma.loginFailure.deleteMany({
      where: { failedAt: { lt: cutoff } },
    });
    if (loginCount > 0) {
      this.logger.debug(`Cleaned up ${loginCount} old login failure records`);
    }

    const { count: totpCount } =
      await this.prisma.totpFailureTracking.deleteMany({
        where: { failedAt: { lt: cutoff } },
      });
    if (totpCount > 0) {
      this.logger.debug(`Cleaned up ${totpCount} old TOTP failure records`);
    }

    const { count: webauthnCount } =
      await this.prisma.webAuthnFailureTracking.deleteMany({
        where: { failedAt: { lt: cutoff } },
      });
    if (webauthnCount > 0) {
      this.logger.debug(
        `Cleaned up ${webauthnCount} old WebAuthn failure records`,
      );
    }
  }
}
