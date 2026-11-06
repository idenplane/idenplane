import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import type { Realm } from '@prisma/client';
import { randomInt, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { SmsService } from './sms.service.js';

/** What a code was sent for. A code is only accepted for the same purpose and binding. */
export type SmsOtpPurpose = 'enroll' | 'login' | 'step_up';

/** Guesses allowed per challenge, across every code resent for it. */
export const SMS_OTP_MAX_ATTEMPTS = 5;
/** Codes that may be sent for one challenge (the first send plus resends). */
export const SMS_OTP_MAX_SENDS = 5;
/** Minimum wait between two sends for the same challenge. */
export const SMS_OTP_RESEND_COOLDOWN_SECONDS = 30;
/** Sends allowed from one IP address per realm rate-limit window. */
export const SMS_OTP_MAX_SENDS_PER_IP = 10;
/** Realm-wide sends per hour; caps the cost of an SMS-pumping attack. */
const DEFAULT_REALM_HOURLY_LIMIT = 1000;
/** Delivery logs older than this are deleted. */
const DELIVERY_LOG_RETENTION_DAYS = 90;

const MIN_CODE_LENGTH = 6;
const MAX_CODE_LENGTH = 10;
const MIN_EXPIRY_SECONDS = 60;
const MAX_EXPIRY_SECONDS = 15 * 60;

/** HMAC purposes; see CryptoService.hmac. */
const HMAC_BINDING = 'sms-otp-binding';
const HMAC_CODE = 'sms-otp-code';
const HMAC_PHONE = 'sms-phone';
const HMAC_IP = 'sms-ip';

/** E.164: "+", a non-zero country digit, 7–14 more digits. */
const E164 = /^\+[1-9]\d{7,14}$/;

export type SmsOtpErrorCode =
  | 'unavailable'
  | 'invalid_phone'
  | 'cooldown'
  | 'rate_limited'
  | 'too_many_sends'
  | 'locked'
  | 'send_failed';

/** A send that was refused. `message` is safe to show to the user. */
export class SmsOtpError extends Error {
  constructor(
    readonly code: SmsOtpErrorCode,
    message: string,
    /** For `cooldown`: seconds until a resend is allowed. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'SmsOtpError';
  }
}

export interface SmsOtpSendResult {
  /** The destination with all but the country prefix and last digits hidden. */
  maskedPhone: string;
  expiresAt: Date;
  /** Earliest time another code can be requested for this challenge. */
  resendAvailableAt: Date;
}

export type SmsOtpVerifyResult =
  | {
      ok: true;
      /** The number the code was sent to (decrypted). */ phone: string;
    }
  | {
      ok: false;
      reason: 'invalid' | 'expired' | 'locked' | 'not_found';
      remainingAttempts?: number;
    };

type RealmSmsSettings = Pick<
  Realm,
  | 'id'
  | 'name'
  | 'displayName'
  | 'smsMfaEnabled'
  | 'smsProvider'
  | 'otpLength'
  | 'otpExpirySeconds'
  | 'smsMaxRequestsPerUser'
  | 'smsRateLimitWindow'
>;

/**
 * One-time codes sent by SMS, for enrolling a phone and as a second factor.
 *
 * Each code belongs to a challenge identified by (purpose, binding). The
 * binding is a token of the flow that asked for the code — the MFA challenge
 * token for a sign-in, the step-up token, the enrolment token — so a code
 * sent for one flow is worthless in another. Codes and phone numbers are
 * stored only as keyed hashes (and the enrolling number encrypted), every
 * guess is counted atomically *before* it is checked, and the guess budget
 * survives resends. Sends are limited per challenge, user, phone, IP and
 * realm, because every SMS costs the operator money.
 */
@Injectable()
export class SmsOtpService {
  private readonly logger = new Logger(SmsOtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly smsService: SmsService,
  ) {}

  // ── Helpers ───────────────────────────────────────────────

  /** Canonical E.164 form of a user-typed number, or null if it isn't one. */
  static normalizePhone(input: string | null | undefined): string | null {
    if (typeof input !== 'string') return null;
    let phone = input.trim().replace(/[\s().-]/g, '');
    if (phone.startsWith('00')) phone = `+${phone.slice(2)}`;
    return E164.test(phone) ? phone : null;
  }

  /** "+201012345678" → "+20••••••5678". */
  static maskPhone(phone: string): string {
    if (phone.length <= 7) return '••••';
    return `${phone.slice(0, 3)}${'•'.repeat(phone.length - 7)}${phone.slice(-4)}`;
  }

  /** A provider is set up, so codes can be delivered at all. */
  static canDeliver(realm: Pick<Realm, 'smsProvider'>): boolean {
    return !!realm.smsProvider && realm.smsProvider !== 'none';
  }

  /** New phones may be enrolled: SMS MFA is switched on and deliverable. */
  static canEnroll(
    realm: Pick<Realm, 'smsProvider' | 'smsMfaEnabled'>,
  ): boolean {
    return realm.smsMfaEnabled && SmsOtpService.canDeliver(realm);
  }

  private bindingHash(purpose: SmsOtpPurpose, binding: string): string {
    return this.crypto.hmac(HMAC_BINDING, `${purpose}:${binding}`);
  }

  private codeHash(bindingHash: string, code: string): string {
    return this.crypto.hmac(HMAC_CODE, `${bindingHash}:${code}`);
  }

  phoneHash(phone: string): string {
    return this.crypto.hmac(HMAC_PHONE, phone);
  }

  private generateCode(length: number): string {
    return randomInt(0, 10 ** length)
      .toString()
      .padStart(length, '0');
  }

  private static clamp(
    value: number | null | undefined,
    min: number,
    max: number,
    fallback: number,
  ): number {
    if (!value || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(value)));
  }

  // ── Enrolled phone ────────────────────────────────────────

  /** The user's verified SMS number, decrypted, or null if none. */
  async getEnrolledPhone(userId: string): Promise<string | null> {
    const credential = await this.prisma.userCredential.findUnique({
      where: { userId_type: { userId, type: 'sms' } },
      select: { phoneNumber: true, verified: true },
    });
    if (!credential?.verified || !credential.phoneNumber) return null;
    // Strict decrypt: if the key changed, fail rather than text the ciphertext.
    try {
      return SmsOtpService.normalizePhone(
        this.crypto.decrypt(credential.phoneNumber),
      );
    } catch {
      this.logger.error(`Could not decrypt the SMS phone of user ${userId}`);
      return null;
    }
  }

  /** Record `phone` as the user's SMS factor (replacing any previous number). */
  async saveEnrolledPhone(userId: string, phone: string): Promise<void> {
    const phoneNumber = this.crypto.encrypt(phone);
    await this.prisma.userCredential.upsert({
      where: { userId_type: { userId, type: 'sms' } },
      create: {
        userId,
        type: 'sms',
        secretKey: '',
        phoneNumber,
        verified: true,
      },
      update: { phoneNumber, verified: true },
    });
  }

  /** Remove the SMS factor and any codes still pending for the user. */
  async removeEnrolledPhone(userId: string): Promise<void> {
    await this.prisma.userCredential.deleteMany({
      where: { userId, type: 'sms' },
    });
    await this.prisma.otpAttempt.deleteMany({ where: { userId } });
  }

  // ── Sending ───────────────────────────────────────────────

  /**
   * Send a code for the challenge (purpose, binding). Calling it again for
   * the same challenge is a resend: a new code replaces the old one, the
   * guess budget carries over. For `enroll`, `phone` is the number being
   * added; otherwise the code goes to the user's enrolled number.
   *
   * @throws SmsOtpError when the send is refused or the provider fails.
   */
  async sendCode(params: {
    realm: RealmSmsSettings;
    userId: string;
    purpose: SmsOtpPurpose;
    binding: string;
    phone?: string;
    ip?: string;
  }): Promise<SmsOtpSendResult> {
    const { realm, userId, purpose, binding } = params;

    let phone: string | null;
    if (purpose === 'enroll') {
      if (!SmsOtpService.canEnroll(realm)) {
        throw new SmsOtpError(
          'unavailable',
          'Text message verification is not available.',
        );
      }
      phone = SmsOtpService.normalizePhone(params.phone);
      if (!phone) {
        throw new SmsOtpError(
          'invalid_phone',
          'Enter the number in international format, for example +201012345678.',
        );
      }
    } else {
      // Existing enrolments keep working when the switch is turned off; only
      // a missing provider stops them, because nothing could be delivered.
      if (!SmsOtpService.canDeliver(realm)) {
        throw new SmsOtpError(
          'unavailable',
          'Text message verification is not available.',
        );
      }
      phone = await this.getEnrolledPhone(userId);
      if (!phone) {
        throw new SmsOtpError(
          'unavailable',
          'No phone number is set up for this account.',
        );
      }
    }

    const bindingHash = this.bindingHash(purpose, binding);
    const phoneHash = this.phoneHash(phone);
    const ipHash = params.ip ? this.crypto.hmac(HMAC_IP, params.ip) : null;
    const now = new Date();

    const existing = await this.prisma.otpAttempt.findUnique({
      where: { purpose_bindingHash: { purpose, bindingHash } },
    });
    if (
      existing &&
      (existing.userId !== userId || existing.realmId !== realm.id)
    ) {
      // A binding is a secret token of one user's flow; a mismatch is misuse.
      throw new SmsOtpError(
        'unavailable',
        'Text message verification is not available.',
      );
    }
    if (existing && existing.attempts >= SMS_OTP_MAX_ATTEMPTS) {
      throw new SmsOtpError(
        'locked',
        'Too many incorrect codes. Please start again.',
      );
    }
    if (existing && existing.sendCount >= SMS_OTP_MAX_SENDS) {
      throw new SmsOtpError(
        'too_many_sends',
        'Too many codes were requested. Please start again.',
      );
    }
    if (existing) {
      const wait = Math.ceil(
        (existing.lastSentAt.getTime() +
          SMS_OTP_RESEND_COOLDOWN_SECONDS * 1000 -
          now.getTime()) /
          1000,
      );
      if (wait > 0) {
        throw new SmsOtpError(
          'cooldown',
          `Please wait ${wait} seconds before requesting another code.`,
          wait,
        );
      }
    }

    // Reserve the send in the delivery log *before* counting. Every
    // concurrent request then sees at least its own row and those committed
    // before it, so a parallel burst can't all pass a count taken first.
    // Refused sends stay in the log as REJECTED and keep counting.
    const log = await this.prisma.smsDeliveryLog.create({
      data: {
        realmId: realm.id,
        userId,
        phoneHash,
        ipHash,
        provider: realm.smsProvider,
        status: 'PENDING',
      },
    });
    const reject = async (error: SmsOtpError): Promise<never> => {
      await this.prisma.smsDeliveryLog.update({
        where: { id: log.id },
        data: { status: 'REJECTED', errorMessage: error.code },
      });
      throw error;
    };

    const limitError = await this.checkSendLimits(
      realm,
      userId,
      phoneHash,
      ipHash,
      now,
    );
    if (limitError) await reject(limitError);

    const length = SmsOtpService.clamp(
      realm.otpLength,
      MIN_CODE_LENGTH,
      MAX_CODE_LENGTH,
      MIN_CODE_LENGTH,
    );
    const expirySeconds = SmsOtpService.clamp(
      realm.otpExpirySeconds,
      MIN_EXPIRY_SECONDS,
      MAX_EXPIRY_SECONDS,
      300,
    );
    const code = this.generateCode(length);
    const expiresAt = new Date(now.getTime() + expirySeconds * 1000);
    const fields = {
      codeHash: this.codeHash(bindingHash, code),
      phoneHash,
      phoneEncrypted: purpose === 'enroll' ? this.crypto.encrypt(phone) : null,
      expiresAt,
      lastSentAt: now,
    };

    if (existing) {
      // Claim the resend atomically: two concurrent resends can't both pass
      // the cooldown or exceed the send budget.
      const { count } = await this.prisma.otpAttempt.updateMany({
        where: {
          id: existing.id,
          lastSentAt: {
            lte: new Date(
              now.getTime() - SMS_OTP_RESEND_COOLDOWN_SECONDS * 1000,
            ),
          },
          sendCount: { lt: SMS_OTP_MAX_SENDS },
          attempts: { lt: SMS_OTP_MAX_ATTEMPTS },
        },
        data: { ...fields, sendCount: { increment: 1 } },
      });
      if (count === 0) {
        await reject(
          new SmsOtpError(
            'cooldown',
            `Please wait ${SMS_OTP_RESEND_COOLDOWN_SECONDS} seconds before requesting another code.`,
            SMS_OTP_RESEND_COOLDOWN_SECONDS,
          ),
        );
      }
    } else {
      try {
        await this.prisma.otpAttempt.create({
          data: { realmId: realm.id, userId, purpose, bindingHash, ...fields },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          // A concurrent first send for the same challenge won the race.
          await reject(
            new SmsOtpError(
              'cooldown',
              `Please wait ${SMS_OTP_RESEND_COOLDOWN_SECONDS} seconds before requesting another code.`,
              SMS_OTP_RESEND_COOLDOWN_SECONDS,
            ),
          );
        }
        throw err;
      }
    }

    const minutes = Math.max(1, Math.round(expirySeconds / 60));
    const appName = realm.displayName || realm.name;
    const message = `${code} is your ${appName} verification code. It expires in ${minutes} minute${minutes === 1 ? '' : 's'}. Never share it with anyone.`;

    try {
      await this.smsService.sendSms(realm.name, phone, message);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      await this.prisma.smsDeliveryLog.update({
        where: { id: log.id },
        data: { status: 'FAILED', errorMessage: errorMessage.slice(0, 500) },
      });
      this.logger.error(
        `SMS code delivery failed (realm ${realm.name}, log ${log.id}): ${errorMessage}`,
      );
      throw new SmsOtpError(
        'send_failed',
        'The text message could not be sent. Please try again later.',
      );
    }
    await this.prisma.smsDeliveryLog.update({
      where: { id: log.id },
      data: { status: 'SENT' },
    });

    return {
      maskedPhone: SmsOtpService.maskPhone(phone),
      expiresAt,
      resendAvailableAt: new Date(
        now.getTime() + SMS_OTP_RESEND_COOLDOWN_SECONDS * 1000,
      ),
    };
  }

  /**
   * Per-user, per-phone, per-IP and realm-wide caps, counted from the
   * delivery log in the database so they hold across server instances. The
   * caller has already logged this send, so the counts include it.
   */
  private async checkSendLimits(
    realm: RealmSmsSettings,
    userId: string,
    phoneHash: string,
    ipHash: string | null,
    now: Date,
  ): Promise<SmsOtpError | null> {
    const maxPerWindow = SmsOtpService.clamp(
      realm.smsMaxRequestsPerUser,
      1,
      100,
      3,
    );
    const windowSeconds = SmsOtpService.clamp(
      realm.smsRateLimitWindow,
      60,
      86_400,
      900,
    );
    const windowStart = new Date(now.getTime() - windowSeconds * 1000);
    const hourStart = new Date(now.getTime() - 3_600_000);
    const realmHourlyLimit = SmsOtpService.clamp(
      Number(process.env['SMS_REALM_HOURLY_LIMIT']),
      1,
      1_000_000,
      DEFAULT_REALM_HOURLY_LIMIT,
    );

    const since = { gte: windowStart };
    const [byUser, byPhone, byIp, byRealm] = await Promise.all([
      this.prisma.smsDeliveryLog.count({
        where: { realmId: realm.id, userId, createdAt: since },
      }),
      this.prisma.smsDeliveryLog.count({
        where: { realmId: realm.id, phoneHash, createdAt: since },
      }),
      ipHash
        ? this.prisma.smsDeliveryLog.count({
            where: { realmId: realm.id, ipHash, createdAt: since },
          })
        : Promise.resolve(0),
      this.prisma.smsDeliveryLog.count({
        where: { realmId: realm.id, createdAt: { gte: hourStart } },
      }),
    ]);

    // Each count includes this send's own row, hence "greater than".
    if (byRealm > realmHourlyLimit) {
      this.logger.warn(`Realm-wide SMS limit reached for realm ${realm.name}`);
    }
    if (
      byUser > maxPerWindow ||
      byPhone > maxPerWindow ||
      byIp > SMS_OTP_MAX_SENDS_PER_IP ||
      byRealm > realmHourlyLimit
    ) {
      return new SmsOtpError(
        'rate_limited',
        'Too many text messages were requested. Please try again later.',
      );
    }
    return null;
  }

  // ── Verifying ─────────────────────────────────────────────

  /**
   * Check a code for the challenge (purpose, binding). Every call spends one
   * guess before the comparison, atomically, so parallel requests can't get
   * more than SMS_OTP_MAX_ATTEMPTS guesses. A correct code is claimed with a
   * conditional delete, so it can be used exactly once.
   */
  async verifyCode(params: {
    realmId: string;
    userId: string;
    purpose: SmsOtpPurpose;
    binding: string;
    code: string;
  }): Promise<SmsOtpVerifyResult> {
    const { realmId, userId, purpose } = params;
    const bindingHash = this.bindingHash(purpose, params.binding);

    const row = await this.prisma.otpAttempt.findUnique({
      where: { purpose_bindingHash: { purpose, bindingHash } },
    });
    if (!row || row.userId !== userId || row.realmId !== realmId) {
      return { ok: false, reason: 'not_found' };
    }

    const now = new Date();
    const { count: reserved } = await this.prisma.otpAttempt.updateMany({
      where: {
        id: row.id,
        attempts: { lt: SMS_OTP_MAX_ATTEMPTS },
        expiresAt: { gt: now },
      },
      data: { attempts: { increment: 1 } },
    });
    if (reserved === 0) {
      return row.expiresAt <= now
        ? { ok: false, reason: 'expired' }
        : { ok: false, reason: 'locked', remainingAttempts: 0 };
    }

    const code = (params.code ?? '').replace(/\s/g, '');
    const expected = Buffer.from(row.codeHash, 'hex');
    const actual = Buffer.from(this.codeHash(bindingHash, code), 'hex');
    const matches =
      expected.length === actual.length && timingSafeEqual(expected, actual);

    if (!matches) {
      const remainingAttempts = Math.max(
        0,
        SMS_OTP_MAX_ATTEMPTS - (row.attempts + 1),
      );
      return remainingAttempts === 0
        ? { ok: false, reason: 'locked', remainingAttempts }
        : { ok: false, reason: 'invalid', remainingAttempts };
    }

    // Claim: only succeeds if the row still holds the code we compared
    // against (a resend in between replaced it) and nobody claimed it first.
    const { count: claimed } = await this.prisma.otpAttempt.deleteMany({
      where: { id: row.id, codeHash: row.codeHash },
    });
    if (claimed !== 1) return { ok: false, reason: 'not_found' };

    const phone =
      purpose === 'enroll'
        ? row.phoneEncrypted
          ? this.crypto.decrypt(row.phoneEncrypted)
          : null
        : await this.getEnrolledPhone(userId);
    if (!phone) return { ok: false, reason: 'not_found' };
    return { ok: true, phone };
  }

  // ── Housekeeping ──────────────────────────────────────────

  @Interval(300_000)
  async cleanup(): Promise<void> {
    const { count } = await this.prisma.otpAttempt.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (count > 0) this.logger.debug(`Removed ${count} expired SMS codes`);

    await this.prisma.smsDeliveryLog.deleteMany({
      where: {
        createdAt: {
          lt: new Date(Date.now() - DELIVERY_LOG_RETENTION_DAYS * 86_400_000),
        },
      },
    });
  }
}
