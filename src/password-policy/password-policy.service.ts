import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import type { Realm, User } from '@prisma/client';

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

@Injectable()
export class PasswordPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
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

  async checkHistory(
    userId: string,
    realmId: string,
    password: string,
    historyCount: number,
  ): Promise<boolean> {
    if (historyCount <= 0) return false;

    const history = await this.prisma.passwordHistory.findMany({
      where: { userId, realmId },
      orderBy: { createdAt: 'desc' },
      take: historyCount,
    });

    for (const entry of history) {
      const match = await this.crypto.verifyPassword(
        entry.passwordHash,
        password,
      );
      if (match) return true;
    }

    return false;
  }

  async recordHistory(
    userId: string,
    realmId: string,
    passwordHash: string,
    historyCount: number,
  ): Promise<void> {
    if (historyCount <= 0) return;

    await this.prisma.passwordHistory.create({
      data: { userId, realmId, passwordHash },
    });

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
