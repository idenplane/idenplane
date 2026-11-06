import { Injectable, Logger, Optional } from '@nestjs/common';
import * as OTPAuth from 'otpauth';
import * as QRCode from 'qrcode';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { RedisService } from '../redis/redis.service.js';
import { BruteForceService } from '../brute-force/brute-force.service.js';
import { SmsOtpService, type SmsOtpPurpose } from '../sms/sms-otp.service.js';
import type { Realm } from '@prisma/client';

/** Credential types that count as a second factor. */
export const SECOND_FACTOR_TYPES = ['totp', 'sms'] as const;
export type SecondFactorType = (typeof SECOND_FACTOR_TYPES)[number];

/** Which factor satisfied a second-factor check. */
export type VerifiedFactor = SecondFactorType | 'recovery';

/**
 * A second-factor answer.
 * - `totp`, `recovery`, `sms`: the user said which kind of code it is.
 * - `otp`: a single code field (token API, step-up API, auth flows) — tried
 *   as an authenticator code, then as a recovery code.
 */
export type SecondFactorInput =
  | { method: 'totp' | 'recovery' | 'otp'; code: string }
  | {
      method: 'sms';
      code: string;
      realmId: string;
      purpose: Exclude<SmsOtpPurpose, 'enroll'>;
      /** The token of the flow the code was sent for. */
      binding: string;
    };

/** The shape of the JSON object stored in PendingAction.data for MFA challenges. */
interface MfaChallengeData {
  userId: string;
  realmId: string;
  clientId?: string;
  oauthParams?: Record<string, string>;
  /** RFC 8176 methods of the first factor; absent means a password. */
  primaryAmr?: string[];
}

/**
 * A password-verified sign-in that is waiting for the user to enrol TOTP
 * because the realm requires MFA. It is deliberately *not* an SSO session:
 * it only unlocks the TOTP setup page, and the real session is created once
 * enrolment succeeds.
 */
export interface MfaEnrollmentData {
  userId: string;
  realmId: string;
  oauthParams?: Record<string, string>;
  rememberMe?: boolean;
  /** RFC 8176 methods of the first factor; absent means a password. */
  primaryAmr?: string[];
  /** Set once the user has activated TOTP with this enrolment. */
  verified?: boolean;
}

export const MFA_ENROLLMENT_COOKIE = 'IDENPLANE_MFA_ENROLLMENT';
export const MFA_ENROLLMENT_TTL_SECONDS = 15 * 60;

/** TTL in seconds for a used TOTP code entry — covers the full ±1-step window (3 periods × 30s). */
const TOTP_USED_CODE_TTL_SECONDS = 90;

/** Rate limiting for MFA challenge creation */
const MFA_CHALLENGE_RATE_LIMIT_MAX_REQUESTS = 5;
const MFA_CHALLENGE_RATE_LIMIT_WINDOW_SECONDS = 300;

@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);

  private readonly usedTotpCodes = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly bruteForceService?: BruteForceService,
    @Optional() private readonly smsOtp?: SmsOtpService,
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
      this.logger.warn(
        `Failed to persist used TOTP code to DB: ${(err as Error).message}`,
      );
    }

    if (this.redis?.isAvailable()) {
      try {
        await this.redis.set(key, '1', TOTP_USED_CODE_TTL_SECONDS);
        return;
      } catch (err) {
        this.logger.warn(
          `Failed to store used TOTP code in Redis: ${(err as Error).message}`,
        );
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
          await this.redis
            .set(key, '1', TOTP_USED_CODE_TTL_SECONDS)
            .catch(() => {});
        }
        return true;
      }
    } catch (err) {
      this.logger.warn(
        `Failed to check DB for used TOTP code: ${(err as Error).message}`,
      );
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
      issuer: `Idenplane (${realmName})`,
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

  async verifyAndActivateTotp(
    userId: string,
    code: string,
  ): Promise<string[] | null> {
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

    // First factor enrolled: issue recovery codes. If another factor already
    // gave the user codes, keep them (an empty list means "unchanged").
    return (await this.ensureRecoveryCodes(userId)) ?? [];
  }

  async verifyTotp(userId: string, code: string): Promise<boolean> {
    const credential = await this.prisma.userCredential.findUnique({
      where: { userId_type: { userId, type: 'totp' } },
    });

    if (!credential || !credential.verified) return false;

    // Replay-attack prevention: reject codes already used within the window.
    if (await this.isTotpCodeUsed(userId, code)) {
      this.logger.warn(
        `Replay attack detected: TOTP code reuse for user ${userId}`,
      );
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

    // The conditional update is the claim: two concurrent requests with the
    // same code can't both see `used: false` and both succeed.
    const { count } = await this.prisma.recoveryCode.updateMany({
      where: { userId, codeHash, used: false },
      data: { used: true },
    });
    return count > 0;
  }

  /**
   * Issue recovery codes unless the user still has unused ones. Returns the
   * new codes, or null when the existing codes were kept.
   */
  async ensureRecoveryCodes(userId: string): Promise<string[] | null> {
    const unused = await this.prisma.recoveryCode.count({
      where: { userId, used: false },
    });
    if (unused > 0) return null;
    return this.generateRecoveryCodes(userId);
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

  /** Remove the authenticator app. Recovery codes go with the last factor. */
  async disableTotp(userId: string): Promise<void> {
    await this.prisma.userCredential.deleteMany({
      where: { userId, type: 'totp' },
    });
    await this.deleteRecoveryCodesIfNoFactorLeft(userId);
  }

  /** Remove the SMS phone. Recovery codes go with the last factor. */
  async disableSms(userId: string): Promise<void> {
    await this.prisma.userCredential.deleteMany({
      where: { userId, type: 'sms' },
    });
    await this.prisma.otpAttempt.deleteMany({ where: { userId } });
    await this.deleteRecoveryCodesIfNoFactorLeft(userId);
  }

  /** Remove every second factor and the recovery codes (admin reset). */
  async disableAllFactors(userId: string): Promise<void> {
    await this.prisma.userCredential.deleteMany({
      where: { userId, type: { in: [...SECOND_FACTOR_TYPES] } },
    });
    await this.prisma.otpAttempt.deleteMany({ where: { userId } });
    await this.prisma.recoveryCode.deleteMany({ where: { userId } });
  }

  private async deleteRecoveryCodesIfNoFactorLeft(userId: string) {
    if ((await this.getEnrolledFactors(userId)).length === 0) {
      await this.prisma.recoveryCode.deleteMany({ where: { userId } });
    }
  }

  /** The user's verified second factors. */
  async getEnrolledFactors(userId: string): Promise<SecondFactorType[]> {
    const credentials = await this.prisma.userCredential.findMany({
      where: {
        userId,
        verified: true,
        type: { in: [...SECOND_FACTOR_TYPES] },
      },
      select: { type: true },
    });
    return SECOND_FACTOR_TYPES.filter((t) =>
      credentials.some((c) => c.type === t),
    );
  }

  /** Whether the user has an authenticator app set up. */
  async isTotpEnabled(userId: string): Promise<boolean> {
    const credential = await this.prisma.userCredential.findUnique({
      where: { userId_type: { userId, type: 'totp' } },
    });
    return !!credential?.verified;
  }

  /**
   * Whether the user has *any* second factor. Every "must this sign-in pass
   * a second factor?" decision goes through here, so a newly added factor
   * type can never be skipped by a check that only knew about TOTP.
   */
  async isMfaEnabled(userId: string): Promise<boolean> {
    return (await this.getEnrolledFactors(userId)).length > 0;
  }

  /**
   * The one place a second-factor answer is checked. Every entry point (login
   * page, token API, step-up, auth flows) calls this, so they accept exactly
   * the same factors in the same way.
   */
  async verifySecondFactor(
    userId: string,
    input: SecondFactorInput,
  ): Promise<{ verified: boolean; factor?: VerifiedFactor }> {
    const code = typeof input.code === 'string' ? input.code.trim() : '';
    if (!code) return { verified: false };

    switch (input.method) {
      case 'totp':
        return (await this.verifyTotp(userId, code))
          ? { verified: true, factor: 'totp' }
          : { verified: false };
      case 'recovery':
        return (await this.verifyRecoveryCode(userId, code))
          ? { verified: true, factor: 'recovery' }
          : { verified: false };
      case 'otp':
        if (await this.verifyTotp(userId, code)) {
          return { verified: true, factor: 'totp' };
        }
        return (await this.verifyRecoveryCode(userId, code))
          ? { verified: true, factor: 'recovery' }
          : { verified: false };
      case 'sms': {
        if (!this.smsOtp) return { verified: false };
        const result = await this.smsOtp.verifyCode({
          realmId: input.realmId,
          userId,
          purpose: input.purpose,
          binding: input.binding,
          code,
        });
        return result.ok
          ? { verified: true, factor: 'sms' }
          : { verified: false };
      }
      default:
        return { verified: false };
    }
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
    clientId?: string,
    primaryAmr?: string[],
  ): Promise<string> {
    const windowStart = new Date(
      Date.now() - MFA_CHALLENGE_RATE_LIMIT_WINDOW_SECONDS * 1000,
    );
    const recentChallenges = await this.prisma.pendingAction.count({
      where: {
        type: 'mfa_challenge',
        data: { path: ['userId'], equals: userId },
        createdAt: { gte: windowStart },
      },
    });

    if (recentChallenges >= MFA_CHALLENGE_RATE_LIMIT_MAX_REQUESTS) {
      throw new Error(
        `Rate limit exceeded: too many MFA challenge requests. Please try again later.`,
      );
    }

    const token = this.crypto.generateSecret(32);
    const tokenHash = this.crypto.sha256(token);

    const challengeData: MfaChallengeData = {
      userId,
      realmId,
      clientId,
      oauthParams,
      primaryAmr,
    };
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

  async validateMfaChallenge(challengeToken: string): Promise<{
    userId: string;
    realmId: string;
    clientId?: string;
    oauthParams?: Record<string, string>;
    primaryAmr?: string[];
  } | null> {
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
    return {
      userId: data.userId,
      realmId: data.realmId,
      clientId: data.clientId,
      oauthParams: data.oauthParams,
      primaryAmr: data.primaryAmr,
    };
  }

  /**
   * Validates the challenge without consuming it, increments attempt counter.
   * Returns null if challenge is invalid, expired, or max attempts exceeded.
   */
  async validateMfaChallengeWithAttemptCheck(challengeToken: string): Promise<{
    userId: string;
    realmId: string;
    clientId?: string;
    oauthParams?: Record<string, string>;
    primaryAmr?: string[];
  } | null> {
    const tokenHash = this.crypto.sha256(challengeToken);

    // Spend one attempt atomically before anything is checked. A
    // read-then-write counter would let parallel requests all read the same
    // count and get far more than MAX_MFA_ATTEMPTS guesses.
    const { count } = await this.prisma.pendingAction.updateMany({
      where: {
        tokenHash,
        type: 'mfa_challenge',
        expiresAt: { gt: new Date() },
        attempts: { lt: MfaService.MAX_MFA_ATTEMPTS },
      },
      data: { attempts: { increment: 1 } },
    });

    if (count === 0) {
      // Unknown, expired or out of attempts: drop it and force a new sign-in.
      const { count: deleted } = await this.prisma.pendingAction.deleteMany({
        where: { tokenHash, type: 'mfa_challenge' },
      });
      if (deleted > 0) {
        this.logger.warn(
          'MFA challenge expired or exceeded max attempts; discarded',
        );
      }
      return null;
    }

    const action = await this.prisma.pendingAction.findUnique({
      where: { tokenHash },
    });
    if (!action) return null;
    const data = action.data as unknown as MfaChallengeData;

    return {
      userId: data.userId,
      realmId: data.realmId,
      clientId: data.clientId,
      oauthParams: data.oauthParams,
      primaryAmr: data.primaryAmr,
    };
  }

  /**
   * Consumes (deletes) a challenge token after successful verification.
   */
  async consumeMfaChallenge(challengeToken: string): Promise<void> {
    const tokenHash = this.crypto.sha256(challengeToken);
    await this.prisma.pendingAction
      .delete({ where: { tokenHash } })
      .catch(() => {});
  }

  // ── Required-MFA enrolment ────────────────────────────────

  async createMfaEnrollment(
    data: Omit<MfaEnrollmentData, 'verified'>,
  ): Promise<string> {
    const token = this.crypto.generateSecret(32);
    await this.prisma.pendingAction.create({
      data: {
        tokenHash: this.crypto.sha256(token),
        type: 'mfa_enrollment',
        data: { ...data, verified: false },
        expiresAt: new Date(Date.now() + MFA_ENROLLMENT_TTL_SECONDS * 1000),
      },
    });
    return token;
  }

  /** The pending enrolment for `token`, or null if unknown or expired. */
  async getMfaEnrollment(token: string): Promise<MfaEnrollmentData | null> {
    const action = await this.prisma.pendingAction.findUnique({
      where: { tokenHash: this.crypto.sha256(token) },
    });
    if (!action || action.type !== 'mfa_enrollment') return null;
    if (action.expiresAt < new Date()) return null;
    return action.data as unknown as MfaEnrollmentData;
  }

  /** Record that TOTP was activated through this enrolment. */
  async markMfaEnrollmentVerified(token: string): Promise<void> {
    const tokenHash = this.crypto.sha256(token);
    const action = await this.prisma.pendingAction.findUnique({
      where: { tokenHash },
    });
    if (!action || action.type !== 'mfa_enrollment') return;
    const data = action.data as unknown as MfaEnrollmentData;
    await this.prisma.pendingAction.update({
      where: { id: action.id },
      data: {
        data: { ...data, verified: true },
      },
    });
  }

  /**
   * Single-use: delete the enrolment and return it, but only if TOTP was
   * activated through it and it has not expired. The delete is the claim, so
   * two concurrent requests cannot both complete the sign-in.
   */
  async consumeVerifiedMfaEnrollment(
    token: string,
  ): Promise<MfaEnrollmentData | null> {
    const action = await this.prisma.pendingAction
      .delete({ where: { tokenHash: this.crypto.sha256(token) } })
      .catch(() => null);
    if (!action || action.type !== 'mfa_enrollment') return null;
    if (action.expiresAt < new Date()) return null;
    const data = action.data as unknown as MfaEnrollmentData;
    return data.verified ? data : null;
  }

  @Interval(60_000)
  async cleanupExpiredActions(): Promise<void> {
    const { count } = await this.prisma.pendingAction.deleteMany({
      where: {
        type: { in: ['mfa_challenge', 'mfa_enrollment'] },
        expiresAt: { lt: new Date() },
      },
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
