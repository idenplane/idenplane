import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  PasswordVerificationService,
  type StoredPassword,
} from '../crypto/password-verification.service.js';
import type { Realm, User } from '@prisma/client';

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

@Injectable()
export class PasswordPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordVerificationService,
  ) {}

  validate(realm: Realm, password: string): PasswordValidationResult {
    const errors: string[] = [];

    if (password.length < realm.passwordMinLength) {
      errors.push(
        `Password must be at least ${realm.passwordMinLength} characters`,
      );
    }

    if (realm.passwordRequireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    if (realm.passwordRequireLowercase && !/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    if (realm.passwordRequireDigits && !/\d/.test(password)) {
      errors.push('Password must contain at least one digit');
    }

    if (realm.passwordRequireSpecialChars && !/[^A-Za-z0-9]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Whether `password` is one of the user's recent passwords: their
   * current one, or one of the last `historyCount` hashes in their history.
   *
   * The current hash always counts. It is usually also the newest history
   * row, but not for a user whose password was imported from another IdP
   * (Keycloak, Auth0, Authentik, Zitadel), set while history was off, or
   * rehashed at sign-in: without it such a user could "change" their
   * password to the same one.
   *
   * Same format dispatch as sign-in, so a bcrypt or PBKDF2 hash still
   * detects reuse, and an unlabelled legacy PBKDF2 hash is checked with the
   * algorithm stored next to it (the user's `passwordAlgorithm`, or the
   * history row's). check() and not verifyUserPassword(): nothing here is
   * ever rewritten.
   */
  async checkHistory(
    userId: string,
    realmId: string,
    password: string,
    historyCount: number,
  ): Promise<boolean> {
    if (historyCount <= 0) return false;

    const [current, history] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: userId, realmId },
        select: { passwordHash: true, passwordAlgorithm: true },
      }),
      this.prisma.passwordHistory.findMany({
        where: { userId, realmId },
        orderBy: { createdAt: 'desc' },
        take: historyCount,
        select: { passwordHash: true, passwordAlgorithm: true },
      }),
    ]);

    const candidates: StoredPassword[] = [...history];
    if (
      current?.passwordHash &&
      current.passwordHash !== history[0]?.passwordHash
    ) {
      candidates.unshift(current);
    }

    for (const stored of candidates) {
      const { valid } = await this.passwords.check(stored, password);
      if (valid) return true;
    }

    return false;
  }

  /**
   * Record a newly set password hash and trim the history to
   * `historyCount` entries.
   *
   * `previous` is the user's hash (and its algorithm) just before the
   * change. When it is not already the newest entry (an imported hash, one
   * set while history was off, or one rehashed at sign-in) it is recorded
   * first, so it stays "recently used" for the next changes too, not only
   * the first.
   */
  async recordHistory(
    userId: string,
    realmId: string,
    passwordHash: string,
    historyCount: number,
    previous?: StoredPassword | null,
  ): Promise<void> {
    if (historyCount <= 0) return;

    const now = Date.now();
    const rows: Array<{
      userId: string;
      realmId: string;
      passwordHash: string;
      passwordAlgorithm: string | null;
      createdAt: Date;
    }> = [];

    if (previous?.passwordHash && previous.passwordHash !== passwordHash) {
      const newest = await this.prisma.passwordHistory.findFirst({
        where: { userId, realmId },
        orderBy: { createdAt: 'desc' },
        select: { passwordHash: true },
      });
      if (newest?.passwordHash !== previous.passwordHash) {
        rows.push({
          userId,
          realmId,
          passwordHash: previous.passwordHash,
          passwordAlgorithm: previous.passwordAlgorithm ?? null,
          // Explicitly older than the new entry: the trim below orders by
          // creation time, and two rows written in the same millisecond
          // would otherwise tie.
          createdAt: new Date(now - 1),
        });
      }
    }
    rows.push({
      userId,
      realmId,
      passwordHash,
      passwordAlgorithm: null,
      createdAt: new Date(now),
    });

    await this.prisma.passwordHistory.createMany({ data: rows });

    // Trim old entries beyond historyCount
    const entries = await this.prisma.passwordHistory.findMany({
      where: { userId, realmId },
      orderBy: { createdAt: 'desc' },
      skip: historyCount,
      select: { id: true },
    });

    if (entries.length > 0) {
      await this.prisma.passwordHistory.deleteMany({
        where: { id: { in: entries.map((e) => e.id) } },
      });
    }
  }

  isExpired(user: User, realm: Realm): boolean {
    if (realm.passwordMaxAgeDays <= 0) return false;
    if (!user.passwordChangedAt) return true; // never set → treat as expired

    const maxAgeMs = realm.passwordMaxAgeDays * 24 * 60 * 60 * 1000;
    return Date.now() - user.passwordChangedAt.getTime() > maxAgeMs;
  }
}
