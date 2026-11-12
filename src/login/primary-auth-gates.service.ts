import { Injectable, Optional } from '@nestjs/common';
import type { Realm, User } from '@prisma/client';
import { OAUTH_FORM_PARAM_KEYS } from '../authn-core/oauth-params.js';
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
}

export type PrimaryAuthGateResult =
  /**
   * The sign-in may go on. `riskStepUp` asks for a second factor even where
   * MFA is optional.
   */
  | { kind: 'continue'; riskStepUp: boolean }
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
    if (this.passwordPolicyService.isExpired(user, realm)) {
      const changeToken = this.crypto.generateSecret(32);
      // Store a short-lived verification token for the change-password flow
      await this.verificationService.createTokenWithHash(
        user.id,
        'change_password',
        300,
        this.crypto.sha256(changeToken),
      );

      return {
        kind: 'block',
        redirectUrl: `/realms/${realm.name}/change-password?token=${changeToken}&info=${encodeURIComponent('Your password has expired and must be changed.')}`,
      };
    }

    return { kind: 'continue', riskStepUp };
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
