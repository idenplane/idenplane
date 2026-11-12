import { Injectable, Logger } from '@nestjs/common';
import type { Realm } from '@prisma/client';
import { MfaService, type VerifiedFactor } from '../mfa/mfa.service.js';
import { BruteForceService } from '../brute-force/brute-force.service.js';
import { EventsService } from '../events/events.service.js';
import { LoginEventType } from '../events/event-types.js';

/** A second-factor answer as the sign-in form submits it. */
export interface SecondFactorAnswer {
  /** A code from the authenticator app. */
  code?: string;
  /** A recovery code. */
  recoveryCode?: string;
  /** A code texted to the enrolled phone. */
  smsCode?: string;
}

export type SecondFactorResult =
  | { ok: true; factor: VerifiedFactor | undefined }
  /** Too many recent failures: the answer was not checked at all. */
  | { ok: false; reason: 'rate_limited' }
  /**
   * A wrong answer, now recorded. `tooManyAttempts` is true when the user is
   * blocked or close to it, so the page warns instead of inviting a retry.
   */
  | { ok: false; reason: 'invalid'; tooManyAttempts: boolean };

/**
 * Checks a second-factor answer during a sign-in: the per-user rate limit,
 * the factor itself (authenticator code, texted code or recovery code), and
 * on failure the failure record and the MFA error event.
 *
 * Clearing the failures after a successful sign-in is left to the caller
 * ({@link SecondFactorVerifier.recordSuccess}), once the sign-in is known to
 * go ahead.
 */
@Injectable()
export class SecondFactorVerifier {
  private readonly logger = new Logger(SecondFactorVerifier.name);

  constructor(
    private readonly mfaService: MfaService,
    private readonly bruteForceService: BruteForceService,
    private readonly eventsService: EventsService,
  ) {}

  /**
   * @param binding the sign-in's challenge token; a texted code is only
   *   accepted for the challenge it was sent for.
   * @param ip the client address, for the failure record and the event.
   */
  async verify(
    realm: Realm,
    userId: string,
    input: SecondFactorAnswer,
    binding: string,
    ip: string,
  ): Promise<SecondFactorResult> {
    // Check TOTP rate limit before processing
    const rateLimitCheck = await this.bruteForceService.checkTotpRateLimit(
      realm,
      userId,
    );
    if (rateLimitCheck.blocked) {
      this.logger.warn(
        `TOTP rate limit exceeded for user ${userId} in realm ${realm.id}`,
      );
      return { ok: false, reason: 'rate_limited' };
    }

    const { code, recoveryCode, smsCode } = input;
    const { verified, factor } = smsCode
      ? await this.mfaService.verifySecondFactor(userId, {
          method: 'sms',
          code: smsCode,
          realmId: realm.id,
          purpose: 'login',
          binding,
        })
      : code
        ? await this.mfaService.verifySecondFactor(userId, {
            method: 'totp',
            code,
          })
        : await this.mfaService.verifySecondFactor(userId, {
            method: 'recovery',
            code: recoveryCode ?? '',
          });

    if (!verified) {
      await this.bruteForceService.recordTotpFailure(realm, userId, ip);
      void this.eventsService.recordLoginEvent({
        realmId: realm.id,
        type: LoginEventType.MFA_VERIFY_ERROR,
        userId,
        ipAddress: ip,
        error: 'Invalid MFA code',
      });
      const remainingCheck = await this.bruteForceService.checkTotpRateLimit(
        realm,
        userId,
      );
      return {
        ok: false,
        reason: 'invalid',
        tooManyAttempts:
          remainingCheck.blocked || remainingCheck.remainingAttempts <= 2,
      };
    }

    return { ok: true, factor };
  }

  /** Clears the user's failure count once the second factor let them in. */
  async recordSuccess(realm: Realm, userId: string): Promise<void> {
    await this.bruteForceService.resetTotpFailures(realm.id, userId);
  }
}
