import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Realm, User } from '@prisma/client';
import { randomInt, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { EmailService } from '../email/email.service.js';
import { ThemeEmailService } from '../theme/theme-email.service.js';

/** `OtpAttempt.purpose` of a code sent by an `email_otp` flow step. */
export const EMAIL_OTP_PURPOSE = 'email_login';
/** Guesses allowed per transaction, across every code resent for it. */
export const EMAIL_OTP_MAX_ATTEMPTS = 5;
/** Codes that may be sent for one transaction (first send plus resends). */
export const EMAIL_OTP_MAX_SENDS = 5;
/** Minimum wait between two sends for the same transaction. */
export const EMAIL_OTP_RESEND_COOLDOWN_SECONDS = 30;
/**
 * Across every transaction of one user: codes sent and wrong guesses per
 * window. A fresh transaction brings a fresh code and guess budget, so the
 * per-transaction limits alone would let someone who knows the password
 * keep guessing (or keep mailing the user) by starting over.
 */
export const EMAIL_OTP_USER_WINDOW_SECONDS = 15 * 60;
export const EMAIL_OTP_MAX_SENDS_PER_USER = 10;
export const EMAIL_OTP_MAX_FAILURES_PER_USER = 10;

export const EMAIL_OTP_DEFAULT_LENGTH = 6;
export const EMAIL_OTP_DEFAULT_EXPIRY_SECONDS = 300;

/** HMAC purposes; see CryptoService.hmac. */
const HMAC_BINDING = 'email-otp-binding';
const HMAC_CODE = 'email-otp-code';
const HMAC_DESTINATION = 'email-otp-destination';

export type EmailOtpErrorCode =
  'unavailable' | 'cooldown' | 'too_many_sends' | 'rate_limited' | 'locked';

/** A send that was refused. `message` is safe to show to the user. */
export class EmailOtpError extends Error {
  constructor(
    readonly code: EmailOtpErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'EmailOtpError';
  }
}

export type EmailOtpVerifyResult =
  | { ok: true }
  | {
      ok: false;
      /**
       * `locked`: no guesses left for this transaction, or this user made
       * too many wrong guesses recently; never an occasion for a fallback.
       */
      reason: 'invalid' | 'expired' | 'locked' | 'not_found';
    };

/**
 * One-time codes sent by email for the `email_otp` flow step, to the
 * identified user's verified address.
 *
 * Built like the texted codes (SmsOtpService) and stored in the same table
 * (`otp_attempts`, purpose `email_login`): each code belongs to one login
 * transaction (the binding), and only keyed hashes of the code, the binding
 * and the address are stored. Every guess is counted atomically *before*
 * the comparison (constant time), the guess budget survives resends, a
 * correct code is claimed with a conditional delete so it works once, and
 * codes expire after `expirySeconds` (at most the transaction's 10 minutes).
 */
@Injectable()
export class EmailOtpService {
  private readonly logger = new Logger(EmailOtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly emailService: EmailService,
    private readonly themeEmail: ThemeEmailService,
  ) {}

  /** "jane.doe@example.com" → "j•••@example.com". */
  static maskEmail(email: string): string {
    const at = email.lastIndexOf('@');
    if (at < 1) return '•••';
    return `${email[0]}•••${email.slice(at)}`;
  }

  /**
   * Whether codes can reach `user`: a verified address (an unverified one
   * may belong to someone else) and email delivery set up for the realm.
   */
  async canDeliver(
    realm: Pick<Realm, 'name'>,
    user: Pick<User, 'email' | 'emailVerified'>,
  ): Promise<boolean> {
    if (!user.email || !user.emailVerified) return false;
    return this.emailService.isConfigured(realm.name);
  }

  private bindingHash(binding: string): string {
    return this.crypto.hmac(HMAC_BINDING, `${EMAIL_OTP_PURPOSE}:${binding}`);
  }

  private codeHash(bindingHash: string, code: string): string {
    return this.crypto.hmac(HMAC_CODE, `${bindingHash}:${code}`);
  }

  /**
   * Sends a code for the transaction `binding` to the user's address. A
   * second call for the same transaction is a resend: a new code replaces
   * the old one and the guess budget carries over.
   *
   * @throws EmailOtpError when the send is refused.
   */
  async send(params: {
    realm: Realm;
    user: User;
    binding: string;
    length?: number;
    expirySeconds?: number;
    now?: Date;
  }): Promise<{ maskedEmail: string; expiresAt: Date }> {
    const { realm, user } = params;
    const now = params.now ?? new Date();
    if (!(await this.canDeliver(realm, user)) || !user.email) {
      throw new EmailOtpError(
        'unavailable',
        'A code cannot be sent to this account by email.',
      );
    }
    const bindingHash = this.bindingHash(params.binding);
    const existing = await this.prisma.otpAttempt.findUnique({
      where: {
        purpose_bindingHash: { purpose: EMAIL_OTP_PURPOSE, bindingHash },
      },
    });
    if (
      existing &&
      (existing.userId !== user.id || existing.realmId !== realm.id)
    ) {
      // A binding is one user's transaction; a mismatch is misuse.
      throw new EmailOtpError(
        'unavailable',
        'A code cannot be sent to this account by email.',
      );
    }
    if (existing && existing.attempts >= EMAIL_OTP_MAX_ATTEMPTS) {
      throw new EmailOtpError(
        'locked',
        'Too many incorrect codes. Please sign in again.',
      );
    }
    if (existing && existing.sendCount >= EMAIL_OTP_MAX_SENDS) {
      throw new EmailOtpError(
        'too_many_sends',
        'Too many codes were requested. Please sign in again.',
      );
    }
    if (
      existing &&
      existing.lastSentAt.getTime() + EMAIL_OTP_RESEND_COOLDOWN_SECONDS * 1000 >
        now.getTime()
    ) {
      throw new EmailOtpError(
        'cooldown',
        `Please wait ${EMAIL_OTP_RESEND_COOLDOWN_SECONDS} seconds before requesting another code.`,
      );
    }
    const usage = await this.userUsage(realm.id, user.id, now);
    if (usage.sends >= EMAIL_OTP_MAX_SENDS_PER_USER) {
      throw new EmailOtpError(
        'rate_limited',
        'Too many codes were requested. Please try again later.',
      );
    }
    if (usage.failures >= EMAIL_OTP_MAX_FAILURES_PER_USER) {
      throw new EmailOtpError(
        'locked',
        'Too many incorrect codes. Please try again later.',
      );
    }

    const length = params.length === 8 ? 8 : EMAIL_OTP_DEFAULT_LENGTH;
    const expirySeconds = Math.min(
      600,
      Math.max(60, params.expirySeconds ?? EMAIL_OTP_DEFAULT_EXPIRY_SECONDS),
    );
    const code = randomInt(0, 10 ** length)
      .toString()
      .padStart(length, '0');
    const expiresAt = new Date(now.getTime() + expirySeconds * 1000);
    const fields = {
      codeHash: this.codeHash(bindingHash, code),
      phoneHash: this.crypto.hmac(HMAC_DESTINATION, user.email.toLowerCase()),
      expiresAt,
      lastSentAt: now,
    };

    if (existing) {
      // Claim the resend atomically against the cooldown and budgets.
      const { count } = await this.prisma.otpAttempt.updateMany({
        where: {
          id: existing.id,
          lastSentAt: {
            lte: new Date(
              now.getTime() - EMAIL_OTP_RESEND_COOLDOWN_SECONDS * 1000,
            ),
          },
          sendCount: { lt: EMAIL_OTP_MAX_SENDS },
          attempts: { lt: EMAIL_OTP_MAX_ATTEMPTS },
        },
        data: { ...fields, sendCount: { increment: 1 } },
      });
      if (count === 0) {
        throw new EmailOtpError(
          'cooldown',
          `Please wait ${EMAIL_OTP_RESEND_COOLDOWN_SECONDS} seconds before requesting another code.`,
        );
      }
    } else {
      try {
        await this.prisma.otpAttempt.create({
          data: {
            realmId: realm.id,
            userId: user.id,
            purpose: EMAIL_OTP_PURPOSE,
            bindingHash,
            ...fields,
          },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          throw new EmailOtpError(
            'cooldown',
            `Please wait ${EMAIL_OTP_RESEND_COOLDOWN_SECONDS} seconds before requesting another code.`,
          );
        }
        throw err;
      }
    }

    const minutes = Math.max(1, Math.round(expirySeconds / 60));
    const html = this.themeEmail.renderEmail(realm, 'email-otp', {
      code,
      minutes,
    });
    await this.emailService.sendEmail(
      realm.name,
      user.email,
      this.themeEmail.getSubject(realm, 'emailOtpSubject'),
      html,
    );
    this.logger.log(`Sign-in code sent by email to user ${user.id}`);
    return { maskedEmail: EmailOtpService.maskEmail(user.email), expiresAt };
  }

  /**
   * Checks a code for the transaction `binding`. The guess is spent before
   * the comparison, atomically; a correct code is claimed once.
   */
  async verify(params: {
    realmId: string;
    userId: string;
    binding: string;
    code: string | undefined;
    now?: Date;
  }): Promise<EmailOtpVerifyResult> {
    const now = params.now ?? new Date();
    const bindingHash = this.bindingHash(params.binding);
    const row = await this.prisma.otpAttempt.findUnique({
      where: {
        purpose_bindingHash: { purpose: EMAIL_OTP_PURPOSE, bindingHash },
      },
    });
    if (
      !row ||
      row.userId !== params.userId ||
      row.realmId !== params.realmId
    ) {
      return { ok: false, reason: 'not_found' };
    }
    const usage = await this.userUsage(params.realmId, params.userId, now);
    if (usage.failures >= EMAIL_OTP_MAX_FAILURES_PER_USER) {
      return { ok: false, reason: 'locked' };
    }

    const { count: reserved } = await this.prisma.otpAttempt.updateMany({
      where: {
        id: row.id,
        attempts: { lt: EMAIL_OTP_MAX_ATTEMPTS },
        expiresAt: { gt: now },
      },
      data: { attempts: { increment: 1 } },
    });
    if (reserved === 0) {
      return {
        ok: false,
        reason: row.expiresAt <= now ? 'expired' : 'locked',
      };
    }

    const code = (params.code ?? '').replace(/\s/g, '');
    const expected = Buffer.from(row.codeHash, 'hex');
    const actual = Buffer.from(this.codeHash(bindingHash, code), 'hex');
    const matches =
      expected.length === actual.length && timingSafeEqual(expected, actual);
    if (!matches) {
      return row.attempts + 1 >= EMAIL_OTP_MAX_ATTEMPTS
        ? { ok: false, reason: 'locked' }
        : { ok: false, reason: 'invalid' };
    }

    // Single use: only the request that still sees this code claims it.
    const { count: claimed } = await this.prisma.otpAttempt.deleteMany({
      where: { id: row.id, codeHash: row.codeHash },
    });
    return claimed === 1 ? { ok: true } : { ok: false, reason: 'not_found' };
  }

  /**
   * Codes sent and wrong guesses for this user over the last window, from
   * the codes still on record (spent codes are deleted, so a success does
   * not count; expired ones are kept for 30 minutes by the SMS cleanup).
   */
  private async userUsage(
    realmId: string,
    userId: string,
    now: Date,
  ): Promise<{ sends: number; failures: number }> {
    const since = new Date(
      now.getTime() - EMAIL_OTP_USER_WINDOW_SECONDS * 1000,
    );
    const agg = await this.prisma.otpAttempt.aggregate({
      where: {
        realmId,
        userId,
        purpose: EMAIL_OTP_PURPOSE,
        lastSentAt: { gte: since },
      },
      _sum: { sendCount: true, attempts: true },
    });
    return {
      sends: agg._sum.sendCount ?? 0,
      failures: agg._sum.attempts ?? 0,
    };
  }
}
