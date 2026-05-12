import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Realm, User } from '@prisma/client';

@Injectable()
export class BruteForceService {
  private readonly logger = new Logger(BruteForceService.name);

  constructor(private readonly prisma: PrismaService) {}

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

    await this.prisma.loginFailure.create({
      data: { realmId: realm.id, userId, ipAddress: ipAddress ?? null },
    });

    // Count recent failures within the reset window.
    // Ensure maxLoginFailures is at least 1 to prevent instant lockout on misconfiguration.
    const maxFailures = Math.max(realm.maxLoginFailures, 1);
    const resetTime = Math.max(realm.failureResetTime, 1); // min 1 second window
    const windowStart = new Date(Date.now() - resetTime * 1000);
    const failureCount = await this.prisma.loginFailure.count({
      where: {
        realmId: realm.id,
        userId,
        failedAt: { gte: windowStart },
      },
    });

    this.logger.debug(
      `Brute force: user=${userId} failures=${failureCount}/${maxFailures} window=${resetTime}s`,
    );

    if (failureCount >= maxFailures) {
      // Check if permanent lockout is configured
      if (realm.permanentLockoutAfter > 0) {
        // Count total lockouts (approximate by counting failure bursts)
        const totalFailures = await this.prisma.loginFailure.count({
          where: { realmId: realm.id, userId },
        });
        const lockoutCount = Math.floor(totalFailures / maxFailures);

        if (lockoutCount >= realm.permanentLockoutAfter) {
          // Permanent lock — set far future date but do NOT disable the account.
          // Disabling prevents admin unlock from working and creates a DoS vector.
          await this.prisma.user.update({
            where: { id: userId },
            data: { lockedUntil: new Date('2099-12-31T23:59:59Z') },
          });
          this.logger.warn(
            `User ${userId} in realm ${realm.id} permanently locked after ${lockoutCount} lockout cycles. ` +
              `Admin action required to unlock via POST /admin/realms/:realm/users/:userId/unlock`,
          );
          return;
        }
      }

      const lockedUntil = new Date(Date.now() + realm.lockoutDuration * 1000);
      await this.prisma.user.update({
        where: { id: userId },
        data: { lockedUntil },
      });
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
    // Delete login failures older than 24 hours
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.loginFailure.deleteMany({
      where: { failedAt: { lt: cutoff } },
    });
    if (count > 0) {
      this.logger.debug(`Cleaned up ${count} old login failure records`);
    }
  }
}
