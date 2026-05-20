import { Injectable, Logger, Optional } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { RedisService } from '../redis/redis.service.js';
import { SmsService } from './sms.service.js';

/** TTL in seconds for a rate limit counter entry. */
const _RATE_LIMIT_TTL_SECONDS = 900; // 15 minutes default

/** Default OTP length when not configured. */
const DEFAULT_OTP_LENGTH = 6;

/** Default OTP expiry in seconds (5 minutes). */
const DEFAULT_OTP_EXPIRY_SECONDS = 300;

/** Maximum verification attempts before lockout. */
const MAX_VERIFICATION_ATTEMPTS = 5;

/**
 * Result of generating an OTP for delivery.
 */
export interface OtpGenerationResult {
  /** The plain OTP code (only available immediately after generation). */
  code?: string;
  /** Whether SMS was successfully sent. */
  smsSent: boolean;
  /** Delivery log ID for tracking. */
  deliveryLogId?: string;
  /** Error message if SMS delivery failed. */
  errorMessage?: string;
}

/** Default OTP lockout duration in seconds (15 minutes). */
const DEFAULT_OTP_LOCKOUT_DURATION_SECONDS = 900;

/**
 * Result of checking OTP lockout status.
 */
export interface OtpLockoutStatus {
  /** Whether the user is currently locked out. */
  locked: boolean;
  /** If locked, the time when the lock expires. */
  lockedUntil?: Date;
  /** Remaining verification attempts. */
  remainingAttempts?: number;
}

/**
 * Result of verifying an OTP code.
 */
export interface OtpVerificationResult {
  /** Whether the code was valid and verified. */
  success: boolean;
  /** Whether the user is temporarily locked out due to too many attempts. */
  locked: boolean;
  /** If locked, the time when the lock expires. */
  lockedUntil?: Date;
  /** Remaining verification attempts (if not locked). */
  remainingAttempts?: number;
  /** Error message describing the failure reason. */
  error?: string;
}

/**
 * Delivery status for SMS messages.
 */
export enum SmsDeliveryStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
  UNKNOWN = 'UNKNOWN',
}

@Injectable()
export class SmsOtpService {
  private readonly logger = new Logger(SmsOtpService.name);

  /**
   * In-memory fallback store for rate limiting when Redis is unavailable.
   * Key: `ratelimit:{realmId}:{userId}`, Value: { count: number, windowStart: number }.
   */
  private readonly rateLimitStore = new Map<
    string,
    { count: number; windowStart: number }
  >();

  /**
   * In-memory fallback store for OTP verification lockouts when Redis is unavailable.
   * Key: `otplockout:{realmId}:{userId}`, Value: { lockExpiresAt: number }.
   */
  private readonly otpLockoutStore = new Map<
    string,
    { lockExpiresAt: number }
  >();

  /**
   * In-memory store for verification attempt counts (when DB is unavailable for read).
   * Key: `otpattempts:{realmId}:{userId}`, Value: { count: number, windowStart: number }.
   */
  private readonly verificationAttemptsStore = new Map<
    string,
    { count: number; windowStart: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @Optional() private readonly redis?: RedisService,
    private readonly smsService?: SmsService,
  ) {}

  /**
   * Generate a numeric OTP code of the specified length.
   */
  private generateOtpCode(length: number): string {
    let code = '';
    for (let i = 0; i < length; i++) {
      code += Math.floor(Math.random() * 10).toString();
    }
    return code;
  }

  /**
   * Check if the user has exceeded the SMS rate limit for the realm.
   * Uses Redis for atomic increment, falls back to in-memory tracking.
   *
   * @returns true if rate limited (should NOT send), false if allowed
   */
  private async isRateLimited(
    realmId: string,
    userId: string,
    maxRequests: number,
    windowSeconds: number,
  ): Promise<boolean> {
    const key = `sms:ratelimit:${realmId}:${userId}`;

    if (this.redis?.isAvailable()) {
      // Use Redis for atomic rate limiting
      const count = await this.redis.incr(key, windowSeconds);
      return count > maxRequests;
    }

    // In-memory fallback
    const entry = this.rateLimitStore.get(key);
    const now = Date.now();

    if (!entry || now - entry.windowStart > windowSeconds * 1000) {
      // Start new window
      this.rateLimitStore.set(key, { count: 1, windowStart: now });
      return false;
    }

    entry.count++;
    if (entry.count > maxRequests) {
      return true;
    }
    return false;
  }

  /**
   * Get rate limit status for a user in a realm.
   */
  async getRateLimitStatus(
    realmId: string,
    userId: string,
    maxRequests: number,
    windowSeconds: number,
  ): Promise<{ remaining: number; resetAt: Date }> {
    const key = `sms:ratelimit:${realmId}:${userId}`;

    if (this.redis?.isAvailable()) {
      const count = await this.redis.get(key);
      const remaining = Math.max(0, maxRequests - parseInt(count ?? '0', 10));
      // TTL from Redis would give exact reset time, approximate here
      const resetAt = new Date(Date.now() + windowSeconds * 1000);
      return { remaining, resetAt };
    }

    // In-memory fallback
    const entry = this.rateLimitStore.get(key);
    if (!entry) {
      return { remaining: maxRequests, resetAt: new Date() };
    }

    const elapsed = Date.now() - entry.windowStart;
    if (elapsed > windowSeconds * 1000) {
      return { remaining: maxRequests, resetAt: new Date() };
    }

    const remaining = Math.max(0, maxRequests - entry.count);
    const resetAt = new Date(entry.windowStart + windowSeconds * 1000);
    return { remaining, resetAt };
  }

  /**
   * Get the lockout status for OTP verification for a user in a realm.
   * Checks the most recent unverified OTP attempt for lockout information.
   *
   * @returns Lockout status with remaining attempts
   */
  async getOtpLockoutStatus(
    realmId: string,
    userId: string,
    phoneHash: string,
  ): Promise<OtpLockoutStatus> {
    const otpAttempt = await this.prisma.otpAttempt.findFirst({
      where: {
        realmId,
        userId,
        phoneHash,
        verified: false,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpAttempt) {
      return { locked: false, remainingAttempts: MAX_VERIFICATION_ATTEMPTS };
    }

    const now = new Date();
    if (otpAttempt.expiresAt > now) {
      // If the expiresAt is in the future and failed attempts are high,
      // this indicates a lockout (we set expiresAt to future when locking)
      if (otpAttempt.failedAttempts >= MAX_VERIFICATION_ATTEMPTS) {
        return {
          locked: true,
          lockedUntil: otpAttempt.expiresAt,
          remainingAttempts: 0,
        };
      }
    }

    return {
      locked: false,
      remainingAttempts: Math.max(
        0,
        MAX_VERIFICATION_ATTEMPTS - otpAttempt.failedAttempts,
      ),
    };
  }

  /**
   * Check if a user is currently locked out from OTP verification.
   * Uses Redis for lockout state, falls back to in-memory tracking.
   */
  async isOtpLockedOut(
    realmId: string,
    userId: string,
  ): Promise<{ locked: boolean; lockedUntil?: Date }> {
    const key = `sms:otplockout:${realmId}:${userId}`;

    if (this.redis?.isAvailable()) {
      const lockData = await this.redis.get(key);
      if (lockData) {
        const lockUntil = new Date(lockData);
        if (lockUntil > new Date()) {
          return { locked: true, lockedUntil: lockUntil };
        }
        // Lock expired, clean it up
        await this.redis.del(key);
      }
      return { locked: false };
    }

    // In-memory fallback
    const entry = this.otpLockoutStore.get(key);
    if (!entry) {
      return { locked: false };
    }

    if (Date.now() > entry.lockExpiresAt) {
      this.otpLockoutStore.delete(key);
      return { locked: false };
    }

    return { locked: true, lockedUntil: new Date(entry.lockExpiresAt) };
  }

  /**
   * Lock a user out from OTP verification attempts.
   * Uses Redis for persistent lockout state, falls back to in-memory tracking.
   *
   * @param realmId - The realm ID
   * @param userId - The user ID
   * @param lockoutSeconds - Duration of the lockout in seconds
   */
  async lockOtpVerification(
    realmId: string,
    userId: string,
    lockoutSeconds: number,
  ): Promise<void> {
    const key = `sms:otplockout:${realmId}:${userId}`;
    const lockedUntil = new Date(Date.now() + lockoutSeconds * 1000);

    if (this.redis?.isAvailable()) {
      await this.redis.set(key, lockedUntil.toISOString(), lockoutSeconds);
    } else {
      this.otpLockoutStore.set(key, { lockExpiresAt: lockedUntil.getTime() });
    }

    this.logger.debug(
      `OTP verification locked for user ${userId} in realm ${realmId} until ${lockedUntil.toISOString()}`,
    );
  }

  /**
   * Unlock a user from OTP verification lockout.
   * Uses Redis for persistent lockout state, falls back to in-memory tracking.
   */
  async unlockOtpVerification(realmId: string, userId: string): Promise<void> {
    const key = `sms:otplockout:${realmId}:${userId}`;

    if (this.redis?.isAvailable()) {
      await this.redis.del(key);
    } else {
      this.otpLockoutStore.delete(key);
    }

    this.logger.debug(
      `OTP verification unlocked for user ${userId} in realm ${realmId}`,
    );
  }

  /**
   * Clean up expired OTP lockout entries from in-memory store.
   * Runs every 15 minutes.
   */
  @Interval(900_000) // every 15 minutes
  cleanupOtpLockoutStore(): void {
    const now = Date.now();

    for (const [key, entry] of this.otpLockoutStore.entries()) {
      if (now > entry.lockExpiresAt) {
        this.otpLockoutStore.delete(key);
      }
    }
  }

  /**
   * Generate and send an OTP code via SMS.
   *
   * @param realmId - The realm ID for configuration lookup
   * @param userId - The user ID for rate limiting
   * @param phoneNumber - The recipient phone number (E.164 format recommended)
   * @param realmName - The realm name for SMS configuration
   * @returns Result containing delivery status
   */
  async generateAndSendOtp(
    realmId: string,
    userId: string,
    phoneNumber: string,
    realmName: string,
  ): Promise<OtpGenerationResult> {
    // Get realm SMS configuration
    const realm = await this.prisma.realm.findUnique({
      where: { id: realmId },
      select: {
        smsProvider: true,
        smsFrom: true,
        smsProviderConfig: true,
        otpLength: true,
        otpExpirySeconds: true,
        smsMaxRequestsPerUser: true,
        smsRateLimitWindow: true,
      },
    });

    if (!realm) {
      return { smsSent: false, errorMessage: 'Realm not found' };
    }

    if (!realm.smsProvider || realm.smsProvider === 'none') {
      return {
        smsSent: false,
        errorMessage: 'SMS provider not configured for realm',
      };
    }

    const otpLength = realm.otpLength || DEFAULT_OTP_LENGTH;
    const expirySeconds = realm.otpExpirySeconds || DEFAULT_OTP_EXPIRY_SECONDS;
    const maxRequests = realm.smsMaxRequestsPerUser || 3;
    const windowSeconds = realm.smsRateLimitWindow || 900;

    // Check rate limit
    if (await this.isRateLimited(realmId, userId, maxRequests, windowSeconds)) {
      this.logger.warn(
        `SMS rate limit exceeded for user ${userId} in realm ${realmId}`,
      );
      return {
        smsSent: false,
        errorMessage:
          'Rate limit exceeded. Please wait before requesting another code.',
      };
    }

    // Generate OTP code
    const code = this.generateOtpCode(otpLength);
    const codeHash = this.crypto.sha256(code);
    const phoneHash = this.crypto.sha256(phoneNumber);
    const expiresAt = new Date(Date.now() + expirySeconds * 1000);

    // Clean up any existing unverified OTP attempts for this user/phone
    await this.prisma.otpAttempt.deleteMany({
      where: { realmId, userId, phoneHash, verified: false },
    });

    // Store OTP attempt in database
    await this.prisma.otpAttempt.create({
      data: {
        realmId,
        userId,
        phoneHash,
        codeHash,
        expiresAt,
        failedAttempts: 0,
        verified: false,
      },
    });

    // Create delivery log entry
    const deliveryLog = await this.prisma.smsDeliveryLog.create({
      data: {
        realmId,
        userId,
        phoneHash,
        provider: realm.smsProvider,
        status: 'PENDING',
      },
    });

    // Send SMS if service is available
    let smsSent = false;
    let errorMessage: string | undefined;

    if (this.smsService) {
      try {
        const message = `Your Idenplane verification code is: ${code}. This code expires in ${Math.floor(expirySeconds / 60)} minutes.`;
        await this.smsService.sendSms(realmName, phoneNumber, message);
        smsSent = true;

        // Update delivery log
        await this.prisma.smsDeliveryLog.update({
          where: { id: deliveryLog.id },
          data: { status: 'SENT' },
        });
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`Failed to send SMS OTP: ${errorMessage}`);

        // Update delivery log with error
        await this.prisma.smsDeliveryLog.update({
          where: { id: deliveryLog.id },
          data: {
            status: 'FAILED',
            errorMessage,
          },
        });
      }
    } else {
      // No SMS service - log that code would be sent (development mode)
      this.logger.log(`SMS OTP would be sent to ${phoneNumber}: ${code}`);
      smsSent = true;

      await this.prisma.smsDeliveryLog.update({
        where: { id: deliveryLog.id },
        data: { status: 'DEV_MODE' },
      });
    }

    return {
      code: smsSent ? code : undefined, // Only return code if SMS was sent successfully
      smsSent,
      deliveryLogId: deliveryLog.id,
      errorMessage,
    };
  }

  /**
   * Verify an OTP code.
   * Tracks verification attempts and locks out users after too many failures.
   *
   * @param realmId - The realm ID
   * @param userId - The user ID
   * @param phoneNumber - The phone number used for the OTP (for hash matching)
   * @param code - The OTP code to verify
   * @returns Verification result with success status and lockout info
   */
  async verifyOtp(
    realmId: string,
    userId: string,
    phoneNumber: string,
    code: string,
  ): Promise<OtpVerificationResult> {
    const phoneHash = this.crypto.sha256(phoneNumber);
    const codeHash = this.crypto.sha256(code);

    // First, check if user is locked out from OTP verification
    const lockoutCheck = await this.isOtpLockedOut(realmId, userId);
    if (lockoutCheck.locked) {
      return {
        success: false,
        locked: true,
        lockedUntil: lockoutCheck.lockedUntil,
        error: 'Too many failed attempts. Please wait before trying again.',
      };
    }

    // Find the most recent unverified OTP attempt
    const otpAttempt = await this.prisma.otpAttempt.findFirst({
      where: {
        realmId,
        userId,
        phoneHash,
        verified: false,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpAttempt) {
      return {
        success: false,
        locked: false,
        error: 'No OTP code found. Please request a new code.',
      };
    }

    // Check if expired
    if (otpAttempt.expiresAt < new Date()) {
      // Clean up expired attempt
      await this.prisma.otpAttempt.delete({ where: { id: otpAttempt.id } });
      return {
        success: false,
        locked: false,
        error: 'OTP code has expired. Please request a new code.',
      };
    }

    // Check failed attempts from database
    if (otpAttempt.failedAttempts >= MAX_VERIFICATION_ATTEMPTS) {
      const lockDuration = DEFAULT_OTP_LOCKOUT_DURATION_SECONDS;
      const lockedUntil = new Date(Date.now() + lockDuration * 1000);

      // Lock the user out using Redis/in-memory store
      await this.lockOtpVerification(realmId, userId, lockDuration);

      return {
        success: false,
        locked: true,
        lockedUntil,
        error: 'Too many failed attempts. Please wait before trying again.',
      };
    }

    // Verify code
    if (otpAttempt.codeHash !== codeHash) {
      // Increment failed attempts
      const newFailedAttempts = otpAttempt.failedAttempts + 1;
      await this.prisma.otpAttempt.update({
        where: { id: otpAttempt.id },
        data: { failedAttempts: newFailedAttempts },
      });

      // Check if this attempt caused a lockout
      if (newFailedAttempts >= MAX_VERIFICATION_ATTEMPTS) {
        const lockDuration = DEFAULT_OTP_LOCKOUT_DURATION_SECONDS;
        const lockedUntil = new Date(Date.now() + lockDuration * 1000);

        // Lock the user out using Redis/in-memory store
        await this.lockOtpVerification(realmId, userId, lockDuration);

        return {
          success: false,
          locked: true,
          lockedUntil,
          error: 'Too many failed attempts. Please wait before trying again.',
        };
      }

      const remaining = MAX_VERIFICATION_ATTEMPTS - newFailedAttempts;
      return {
        success: false,
        locked: false,
        remainingAttempts: remaining,
        error:
          remaining > 0
            ? `Invalid code. ${remaining} attempt(s) remaining.`
            : 'Invalid code. Too many failed attempts.',
      };
    }

    // Code is valid - mark as verified and clear any lockout
    await this.prisma.otpAttempt.update({
      where: { id: otpAttempt.id },
      data: {
        verified: true,
        verifiedAt: new Date(),
      },
    });

    // Clear any lockout since verification succeeded
    await this.unlockOtpVerification(realmId, userId);

    return {
      success: true,
      locked: false,
    };
  }

  /**
   * Check if a user has SMS MFA enabled (verified phone number).
   */
  async hasSmsMfaEnabled(realmId: string, userId: string): Promise<boolean> {
    const attempt = await this.prisma.otpAttempt.findFirst({
      where: {
        realmId,
        userId,
        verified: true,
      },
      orderBy: { verifiedAt: 'desc' },
    });
    return !!attempt;
  }

  /**
   * Get the phone hash for a user's verified phone number.
   */
  async getVerifiedPhoneHash(
    realmId: string,
    userId: string,
  ): Promise<string | null> {
    const attempt = await this.prisma.otpAttempt.findFirst({
      where: {
        realmId,
        userId,
        verified: true,
      },
      select: { phoneHash: true },
      orderBy: { verifiedAt: 'desc' },
    });
    return attempt?.phoneHash ?? null;
  }

  /**
   * Remove SMS MFA for a user (clear verified phone).
   */
  async disableSmsMfa(realmId: string, userId: string): Promise<void> {
    // Delete all OTP attempts for this user
    await this.prisma.otpAttempt.deleteMany({
      where: { realmId, userId },
    });
  }

  /**
   * Clean up expired OTP attempts.
   * Runs every 5 minutes.
   */
  @Interval(300_000) // every 5 minutes
  async cleanupExpiredOtpAttempts(): Promise<void> {
    const { count } = await this.prisma.otpAttempt.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
        verified: false,
      },
    });
    if (count > 0) {
      this.logger.debug(`Cleaned up ${count} expired OTP attempts`);
    }
  }

  /**
   * Clean up old rate limit entries from in-memory store.
   * Runs every 15 minutes.
   */
  @Interval(900_000) // every 15 minutes
  cleanupRateLimitStore(): void {
    const now = Date.now();
    const windowMs = 16 * 60 * 1000; // 16 minutes (slightly longer than max window)

    for (const [key, entry] of this.rateLimitStore.entries()) {
      if (now - entry.windowStart > windowMs) {
        this.rateLimitStore.delete(key);
      }
    }
  }

  /**
   * Get a delivery log entry by ID.
   *
   * @param deliveryLogId - The delivery log ID
   * @returns The delivery log entry or null if not found
   */
  async getDeliveryLog(deliveryLogId: string): Promise<{
    id: string;
    status: string;
    provider: string;
    providerMessageId: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: Date;
  } | null> {
    const log = await this.prisma.smsDeliveryLog.findUnique({
      where: { id: deliveryLogId },
      select: {
        id: true,
        status: true,
        provider: true,
        providerMessageId: true,
        errorCode: true,
        errorMessage: true,
        createdAt: true,
      },
    });
    return log;
  }

  /**
   * Get delivery logs for a user in a realm.
   * Useful for troubleshooting SMS delivery issues.
   *
   * @param realmId - The realm ID
   * @param userId - The user ID
   * @param limit - Maximum number of logs to return (default 50)
   * @returns Array of delivery log entries
   */
  async getDeliveryLogsForUser(
    realmId: string,
    userId: string,
    limit = 50,
  ): Promise<
    Array<{
      id: string;
      status: string;
      provider: string;
      providerMessageId: string | null;
      errorCode: string | null;
      errorMessage: string | null;
      createdAt: Date;
    }>
  > {
    const logs = await this.prisma.smsDeliveryLog.findMany({
      where: { realmId, userId },
      select: {
        id: true,
        status: true,
        provider: true,
        providerMessageId: true,
        errorCode: true,
        errorMessage: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return logs;
  }

  /**
   * Update the delivery status of a message.
   * Used for delivery receipt tracking from providers.
   *
   * @param deliveryLogId - The delivery log ID
   * @param status - The new status (SENT, DELIVERED, FAILED)
   * @param providerMessageId - Optional provider message ID
   * @param errorCode - Optional error code
   * @param errorMessage - Optional error message
   */
  async updateDeliveryStatus(
    deliveryLogId: string,
    status: SmsDeliveryStatus,
    providerMessageId?: string,
    errorCode?: string,
    errorMessage?: string,
  ): Promise<void> {
    await this.prisma.smsDeliveryLog.update({
      where: { id: deliveryLogId },
      data: {
        status,
        ...(providerMessageId !== undefined && { providerMessageId }),
        ...(errorCode !== undefined && { errorCode }),
        ...(errorMessage !== undefined && { errorMessage }),
      },
    });

    this.logger.debug(
      `Updated delivery log ${deliveryLogId} status to ${status}`,
    );
  }

  /**
   * Get delivery statistics for a realm.
   * Useful for monitoring SMS delivery success rates.
   *
   * @param realmId - The realm ID
   * @param since - Start date for statistics (default 24 hours ago)
   * @returns Object containing delivery counts by status
   */
  async getDeliveryStats(
    realmId: string,
    since?: Date,
  ): Promise<{
    total: number;
    pending: number;
    sent: number;
    delivered: number;
    failed: number;
    successRate: number;
  }> {
    const sinceDate = since || new Date(Date.now() - 24 * 60 * 60 * 1000); // Default: last 24 hours

    const logs = await this.prisma.smsDeliveryLog.findMany({
      where: {
        realmId,
        createdAt: { gte: sinceDate },
      },
      select: { status: true },
    });

    const counts = {
      total: logs.length,
      pending: logs.filter((l) => l.status === 'PENDING').length,
      sent: logs.filter((l) => l.status === 'SENT').length,
      delivered: logs.filter((l) => l.status === 'DELIVERED').length,
      failed: logs.filter((l) => l.status === 'FAILED').length,
      successRate: 0,
    };

    // Calculate success rate (SENT + DELIVERED / total)
    const successful = counts.sent + counts.delivered;
    counts.successRate =
      counts.total > 0 ? Math.round((successful / counts.total) * 100) : 0;

    return counts;
  }
}
