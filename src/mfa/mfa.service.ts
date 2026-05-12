import { Injectable, Logger, Optional } from '@nestjs/common';
import * as OTPAuth from 'otpauth';
import * as QRCode from 'qrcode';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { RedisService } from '../redis/redis.service.js';
import type { Realm } from '@prisma/client';

/** The shape of the JSON object stored in PendingAction.data for MFA challenges. */
interface MfaChallengeData {
  userId: string;
  realmId: string;
  oauthParams?: Record<string, string>;
  attempts: number;
}

/** TTL in seconds for a used TOTP code entry — covers the full ±1-step window (3 periods × 30s). */
const TOTP_USED_CODE_TTL_SECONDS = 90;

@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);

  private readonly usedTotpCodes = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  private async markTotpCodeUsed(userId: string, code: string): Promise<void> {
    const key = `totp:used:${userId}:${code}`;
    const codeHash = this.crypto.sha256(code);
    const expiresAt = new Date(Date.now() + TOTP_USED_CODE_TTL_SECONDS * 1000);

    try {
      await this.prisma.usedTotpCode.create({
        data: { userId, codeHash, expiresAt },
      });
    } catch (err) {
      this.logger.warn(`Failed to persist used TOTP code to DB: ${(err as Error).message}`);
    }

    if (this.redis?.isAvailable()) {
      try {
        await this.redis.set(key, '1', TOTP_USED_CODE_TTL_SECONDS);
        return;
      } catch (err) {
        this.logger.warn(`Failed to store used TOTP code in Redis: ${(err as Error).message}`);
      }
    }

    this.usedTotpCodes.set(key, expiresAt.getTime());
  }

  private async isTotpCodeUsed(userId: string, code: string): Promise<boolean> {
    const key = `totp:used:${userId}:${code}`;
    const codeHash = this.crypto.sha256(code);

    if (this.redis?.isAvailable()) {
      try {
        if (await this.redis.exists(key)) return true;
      } catch {
        // Fall through to other checks
      }
    }

    const memExpiry = this.usedTotpCodes.get(key);
    if (memExpiry !== undefined) {
      if (Date.now() > memExpiry) {
        this.usedTotpCodes.delete(key);
        return false;
      }
      return true;
    }

    try {
      const record = await this.prisma.usedTotpCode.findFirst({
        where: { userId, codeHash, expiresAt: { gt: new Date() } },
      });
      if (record) {
        if (this.redis?.isAvailable()) {
          await this.redis.set(key, '1', TOTP_USED_CODE_TTL_SECONDS).catch(() => {});
        }
        return true;
      }
    } catch (err) {
      this.logger.warn(`Failed to check DB for used TOTP code: ${(err as Error).message}`);
    }

    return false;
  }

  async setupTotp(userId: string, realmName: string, username: string) {
    // Delete any existing unverified credential
    await this.prisma.userCredential.deleteMany({
      where: { userId, type: 'totp', verified: false },
    });

    const secret = new OTPAuth.Secret({ size: 20 });

    const totp = new OTPAuth.TOTP({
      issuer: `AuthMe (${realmName})`,
      label: username,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });

    await this.prisma.userCredential.create({
      data: {
        userId,
        type: 'totp',
        secretKey: secret.base32,
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        verified: false,
      },
    });

    const otpauthUrl = totp.toString();
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    return {
      secret: secret.base32,
      qrCodeDataUrl,
      otpauthUrl,
    };
  }

  async verifyAndActivateTotp(userId: string, code: string): Promise<string[] | null> {
    const credential = await this.prisma.userCredential.findUnique({
      where: { userId_type: { userId, type: 'totp' } },
    });

    if (!credential || credential.verified) return null;

    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(credential.secretKey),
      algorithm: credential.algorithm,
      digits: credential.digits,
      period: credential.period,
    });

    const delta = totp.validate({ token: code, window: 1 });
    if (delta === null) return null;

    await this.prisma.userCredential.update({
      where: { id: credential.id },
      data: { verified: true },
    });

    // Generate and return recovery codes (single generation point)
    return this.generateRecoveryCodes(userId);
  }

  async verifyTotp(userId: string, code: string): Promise<boolean> {
    const credential = await this.prisma.userCredential.findUnique({
      where: { userId_type: { userId, type: 'totp' } },
    });

    if (!credential || !credential.verified) return false;

    // Replay-attack prevention: reject codes already used within the window.
    if (await this.isTotpCodeUsed(userId, code)) {
      this.logger.warn(`Replay attack detected: TOTP code reuse for user ${userId}`);
      return false;
    }

    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(credential.secretKey),
      algorithm: credential.algorithm,
      digits: credential.digits,
      period: credential.period,
    });

    const delta = totp.validate({ token: code, window: 1 });
    if (delta === null) return false;

    // Mark the code as used so it cannot be replayed within the TOTP window.
    await this.markTotpCodeUsed(userId, code);
    return true;
  }

  async verifyRecoveryCode(userId: string, code: string): Promise<boolean> {
    const codeHash = this.crypto.sha256(code.toLowerCase().replace(/\s/g, ''));

    const recoveryCode = await this.prisma.recoveryCode.findFirst({
      where: { userId, codeHash, used: false },
    });

    if (!recoveryCode) return false;

    await this.prisma.recoveryCode.update({
      where: { id: recoveryCode.id },
      data: { used: true },
    });

    return true;
  }

  async generateRecoveryCodes(userId: string): Promise<string[]> {
    // Delete existing codes
    await this.prisma.recoveryCode.deleteMany({ where: { userId } });

    const codes: string[] = [];
    for (let i = 0; i < 10; i++) {
      const code = this.crypto.generateSecret(4).toUpperCase(); // 8-char hex
      codes.push(code);

      await this.prisma.recoveryCode.create({
        data: {
          userId,
          codeHash: this.crypto.sha256(code.toLowerCase()),
        },
      });
    }

    return codes;
  }

  async disableTotp(userId: string): Promise<void> {
    await this.prisma.userCredential.deleteMany({ where: { userId, type: 'totp' } });
    await this.prisma.recoveryCode.deleteMany({ where: { userId } });
  }

  async isMfaEnabled(userId: string): Promise<boolean> {
    const credential = await this.prisma.userCredential.findUnique({
      where: { userId_type: { userId, type: 'totp' } },
    });
    return !!credential?.verified;
  }

  async isMfaRequired(realm: Realm, userId: string): Promise<boolean> {
    if (realm.mfaRequired) return true;
    return this.isMfaEnabled(userId);
  }

  private static readonly MAX_MFA_ATTEMPTS = 5;

  async createMfaChallenge(
    userId: string,
    realmId: string,
    oauthParams?: Record<string, string>,
  ): Promise<string> {
    const token = this.crypto.generateSecret(32);
    const tokenHash = this.crypto.sha256(token);

    const challengeData: MfaChallengeData = { userId, realmId, oauthParams, attempts: 0 };
    await this.prisma.pendingAction.create({
      data: {
        tokenHash,
        type: 'mfa_challenge',
        data: challengeData as unknown as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 min TTL
      },
    });

    return token;
  }

  async validateMfaChallenge(
    challengeToken: string,
  ): Promise<{ userId: string; realmId: string; oauthParams?: Record<string, string> } | null> {
    const tokenHash = this.crypto.sha256(challengeToken);

    const action = await this.prisma.pendingAction.findUnique({
      where: { tokenHash },
    });

    if (!action || action.type !== 'mfa_challenge') return null;
    if (action.expiresAt < new Date()) {
      await this.prisma.pendingAction.delete({ where: { id: action.id } });
      return null;
    }

    // Consume the challenge (one-time use)
    await this.prisma.pendingAction.delete({ where: { id: action.id } });

    const data = action.data as unknown as MfaChallengeData;
    return { userId: data.userId, realmId: data.realmId, oauthParams: data.oauthParams };
  }

  /**
   * Validates the challenge without consuming it, increments attempt counter.
   * Returns null if challenge is invalid, expired, or max attempts exceeded.
   */
  async validateMfaChallengeWithAttemptCheck(
    challengeToken: string,
  ): Promise<{ userId: string; realmId: string; oauthParams?: Record<string, string> } | null> {
    const tokenHash = this.crypto.sha256(challengeToken);

    const action = await this.prisma.pendingAction.findUnique({
      where: { tokenHash },
    });

    if (!action || action.type !== 'mfa_challenge') return null;
    if (action.expiresAt < new Date()) {
      await this.prisma.pendingAction.delete({ where: { id: action.id } });
      return null;
    }

    const data = action.data as unknown as MfaChallengeData;
    const attempts = (data.attempts ?? 0) + 1;

    if (attempts > MfaService.MAX_MFA_ATTEMPTS) {
      // Too many attempts — delete challenge and force re-authentication
      await this.prisma.pendingAction.delete({ where: { id: action.id } });
      this.logger.warn(`MFA challenge exceeded max attempts for user ${data.userId}`);
      return null;
    }

    // Update attempt counter (keep the challenge alive for retries)
    const updatedData: MfaChallengeData = { ...data, attempts };
    await this.prisma.pendingAction.update({
      where: { id: action.id },
      data: { data: updatedData as unknown as Prisma.InputJsonValue },
    });

    return { userId: data.userId, realmId: data.realmId, oauthParams: data.oauthParams };
  }

  /**
   * Consumes (deletes) a challenge token after successful verification.
   */
  async consumeMfaChallenge(challengeToken: string): Promise<void> {
    const tokenHash = this.crypto.sha256(challengeToken);
    await this.prisma.pendingAction.delete({ where: { tokenHash } }).catch(() => {});
  }

  @Interval(60_000)
  async cleanupExpiredActions(): Promise<void> {
    const { count } = await this.prisma.pendingAction.deleteMany({
      where: { type: 'mfa_challenge', expiresAt: { lt: new Date() } },
    });
    if (count > 0) {
      this.logger.debug(`Cleaned up ${count} expired MFA challenges`);
    }

    const { count: totpCount } = await this.prisma.usedTotpCode.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (totpCount > 0) {
      this.logger.debug(`Cleaned up ${totpCount} expired used TOTP codes`);
    }
  }
}
