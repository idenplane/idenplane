import { Injectable, Optional } from '@nestjs/common';
import type { Prisma, Realm, User } from '@prisma/client';
import {
  OAUTH_FORM_PARAM_KEYS,
  pickOAuthParams,
} from '../authn-core/oauth-params.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RiskAssessmentService } from '../risk-assessment/risk-assessment.service.js';
import { PasswordPolicyService } from '../password-policy/password-policy.service.js';
import { VerificationService } from '../verification/verification.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { EventsService } from '../events/events.service.js';
import { LoginEventType } from '../events/event-types.js';

/** The request a password sign-in came with, as the gates need it. */
export interface PrimaryAuthRequest {
  ipAddress: string;
  userAgent: string | null;
  deviceFingerprint: string | null;
  /** The submitted login form; its OAuth fields survive a refusal. */
  form: Record<string, string | undefined>;
  /**
   * Skip the password-expiry gate: the user was identified without a
   * password (a passkey), as the passkey sign-in has always done.
   */
  skipPasswordExpiry?: boolean;
  /**
   * The OAuth request (and remember-me) to resume once an expired password
   * is changed. Kept server-side, keyed by the change token; defaults to
   * the OAuth fields of `form`.
   */
  resume?: { oauthParams: Record<string, string>; rememberMe: boolean };
}

/** `PendingAction.type` of the sign-in to resume after a password change. */
export const PASSWORD_CHANGE_RESUME_TYPE = 'password_change_resume';

/** How long a forced password change may take (the change token's TTL). */
export const PASSWORD_CHANGE_TTL_SECONDS = 300;

/** The sign-in an expired-password change interrupted. */
export interface PasswordChangeResume {
  userId: string;
  realmId: string;
  /** The authorization request, or empty for an account-console sign-in. */
  oauthParams: Record<string, string>;
  rememberMe: boolean;
}

export type PrimaryAuthGateResult =
  /**
   * The sign-in may go on. `riskStepUp` asks for a second factor even where
   * MFA is optional.
   */
  | {
      kind: 'continue';
      riskStepUp: boolean;
      /** The risk assessment's score and level, when one ran. */
      riskScore?: number;
      riskLevel?: string;
    }
  /** The sign-in stops here; the browser goes to `redirectUrl`. */
  | { kind: 'block'; redirectUrl: string };

/**
 * The checks between a correct password and the rest of the sign-in, in
 * this order: risk assessment (block, or flag for step-up), email
 * verification, password expiry.
 */
@Injectable()
export class PrimaryAuthGatesService {
  constructor(
    private readonly passwordPolicyService: PasswordPolicyService,
    private readonly verificationService: VerificationService,
    private readonly crypto: CryptoService,
    private readonly eventsService: EventsService,
    private readonly prisma: PrismaService,
    @Optional() private readonly riskAssessmentService?: RiskAssessmentService,
  ) {}

  async evaluate(
    realm: Realm,
    user: User,
    request: PrimaryAuthRequest,
  ): Promise<PrimaryAuthGateResult> {
    const { form } = request;

    // ── Adaptive authentication / risk assessment ──────────────────────────
    let riskStepUp = false;
    let riskScore: number | undefined;
    let riskLevel: string | undefined;
    if (realm.adaptiveAuthEnabled && this.riskAssessmentService) {
      const riskContext = {
        userId: user.id,
        realmId: realm.id,
        realmName: realm.name,
        ipAddress: request.ipAddress,
        userAgent: request.userAgent,
        deviceFingerprint: request.deviceFingerprint,
        timestamp: new Date(),
      };

      const assessment =
        await this.riskAssessmentService.assessRisk(riskContext);

      if (assessment.action === 'BLOCK') {
        // Send email notification if user has an email address
        if (user.email) {
          void this.riskAssessmentService.sendBlockedLoginEmail(
            realm.name,
            user.email,
            riskContext,
            assessment.geoLocation,
          );
        }

        void this.eventsService.recordLoginEvent({
          realmId: realm.id,
          type: LoginEventType.LOGIN_ERROR,
          userId: user.id,
          clientId: form['client_id'],
          ipAddress: request.ipAddress,
          error: `Login blocked by risk assessment (score=${assessment.riskScore})`,
        });

        return this.backToLogin(
          realm,
          'Login blocked due to suspicious activity. Check your email for details.',
          form,
        );
      }

      // STEP_UP is applied after the account gates below, so a risky
      // sign-in still has to pass email verification and password expiry.
      riskStepUp = assessment.action === 'STEP_UP';
      riskScore = assessment.riskScore;
      riskLevel = assessment.riskLevel;

      // Update the user's profile on ALLOW or STEP_UP (will learn from the login)
      void this.riskAssessmentService.updateUserProfile(
        user.id,
        realm.id,
        riskContext,
        assessment.geoLocation,
      );
    }
    // ── End risk assessment ────────────────────────────────────────────────

    // Check email verification requirement
    if (realm.requireEmailVerification && user.email && !user.emailVerified) {
      return this.backToLogin(
        realm,
        'Please verify your email address before signing in. Check your inbox for the verification link.',
        form,
      );
    }

    // Check password expiry
    if (
      !request.skipPasswordExpiry &&
      this.passwordPolicyService.isExpired(user, realm)
    ) {
      const changeToken = this.crypto.generateSecret(32);
      // Store a short-lived verification token for the change-password flow
      await this.verificationService.createTokenWithHash(
        user.id,
        'change_password',
        PASSWORD_CHANGE_TTL_SECONDS,
        this.crypto.sha256(changeToken),
      );
      // The OAuth request waits server-side (never in the URL) so the
      // sign-in can continue to the application once the password changed.
      await this.storeResume(changeToken, {
        userId: user.id,
        realmId: realm.id,
        oauthParams:
          request.resume?.oauthParams ??
          pickOAuthParams(form, OAUTH_FORM_PARAM_KEYS),
        rememberMe: request.resume?.rememberMe ?? !!form['rememberMe'],
      });

      return {
        kind: 'block',
        redirectUrl: `/realms/${realm.name}/change-password?token=${changeToken}&info=${encodeURIComponent('Your password has expired and must be changed.')}`,
      };
    }

    return { kind: 'continue', riskStepUp, riskScore, riskLevel };
  }

  /**
   * Takes (single use) the sign-in an expired-password change interrupted,
   * for the change token `changeToken`. Null when there is none, it expired,
   * or it was for another realm or user.
   */
  async takePasswordChangeResume(
    changeToken: string,
    realmId: string,
    userId: string,
  ): Promise<PasswordChangeResume | null> {
    const tokenHash = this.resumeHash(changeToken);
    const row = await this.prisma.pendingAction.findUnique({
      where: { tokenHash },
    });
    if (!row || row.type !== PASSWORD_CHANGE_RESUME_TYPE) return null;
    const { count } = await this.prisma.pendingAction.deleteMany({
      where: { id: row.id, type: PASSWORD_CHANGE_RESUME_TYPE },
    });
    if (count !== 1 || row.expiresAt.getTime() <= Date.now()) return null;
    const data = row.data as unknown as PasswordChangeResume;
    if (data.realmId !== realmId || data.userId !== userId) return null;
    return data;
  }

  private async storeResume(
    changeToken: string,
    resume: PasswordChangeResume,
  ): Promise<void> {
    // One pending change per user, as for the change token itself.
    await this.prisma.pendingAction.deleteMany({
      where: {
        type: PASSWORD_CHANGE_RESUME_TYPE,
        data: { path: ['userId'], equals: resume.userId },
      },
    });
    await this.prisma.pendingAction.create({
      data: {
        tokenHash: this.resumeHash(changeToken),
        type: PASSWORD_CHANGE_RESUME_TYPE,
        data: resume as unknown as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + PASSWORD_CHANGE_TTL_SECONDS * 1000),
      },
    });
  }

  /** Distinct from the change token's own hash (another table, another use). */
  private resumeHash(changeToken: string): string {
    return this.crypto.sha256(`${PASSWORD_CHANGE_RESUME_TYPE}:${changeToken}`);
  }

  /** The login page with an error, keeping the OAuth request. */
  private backToLogin(
    realm: Realm,
    error: string,
    form: Record<string, string | undefined>,
  ): PrimaryAuthGateResult {
    const params = new URLSearchParams();
    params.set('error', error);
    for (const key of OAUTH_FORM_PARAM_KEYS) {
      if (form[key]) params.set(key, form[key]);
    }
    return {
      kind: 'block',
      redirectUrl: `/realms/${realm.name}/login?${params.toString()}`,
    };
  }
}
