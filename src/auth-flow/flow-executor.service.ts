import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Realm } from '@prisma/client';
import { AuthFlowService, FlowStep, FlowContext } from './auth-flow.service.js';
import { LoginService } from '../login/login.service.js';
import { MfaService } from '../mfa/mfa.service.js';

// ─── Types ─────────────────────────────────────────────────

export interface FlowSession {
  flowId: string;
  realmId: string;
  userId?: string;
  completedStepIds: string[];
  currentStepId: string | null;
  context: FlowContext;
  complete: boolean;
}

export interface StepResult {
  success: boolean;
  stepId: string;
  stepType: string;
  nextStepId: string | null;
  flowComplete: boolean;
  message?: string;
  /** Extra data the caller may need (e.g. redirect URL) */
  data?: Record<string, unknown>;
}

// ─── Service ───────────────────────────────────────────────

/**
 * FlowExecutorService orchestrates the multi-step authentication flow during
 * login.  It maintains per-request flow state (passed in as a FlowSession
 * object), routes credential checks to the appropriate handler service, and
 * handles fallback paths on failure.
 *
 * Callers are responsible for persisting the FlowSession between requests
 * (e.g. in the login session or a short-lived pending-action record).
 */
@Injectable()
export class FlowExecutorService {
  private readonly logger = new Logger(FlowExecutorService.name);

  constructor(
    private readonly authFlowService: AuthFlowService,
    private readonly loginService: LoginService,
    private readonly mfaService: MfaService,
  ) {}

  // ── Session helpers ─────────────────────────────────────

  createSession(
    flowId: string,
    realmId: string,
    context: FlowContext = {},
  ): FlowSession {
    return {
      flowId,
      realmId,
      completedStepIds: [],
      currentStepId: null,
      context,
      complete: false,
    };
  }

  // ── Main entry points ───────────────────────────────────

  /**
   * Return the first step the caller should present to the user.
   */
  async startFlow(session: FlowSession): Promise<FlowStep | null> {
    const nextStep = await this.authFlowService.getNextStep(
      session.flowId,
      null,
      session.context,
    );
    session.currentStepId = nextStep?.id ?? null;
    return nextStep;
  }

  /**
   * Process the user's input for the current step.
   * Updates the session in place.
   */
  async processStep(
    session: FlowSession,
    stepId: string,
    credentials: Record<string, unknown>,
    realm: Realm,
  ): Promise<StepResult> {
    if (session.complete) {
      throw new BadRequestException('Authentication flow is already complete');
    }

    const { step, skipped } = await this.authFlowService.executeStep(
      session.flowId,
      stepId,
      session.context,
    );

    // If the step is being skipped (optional + condition not met), advance
    if (skipped) {
      return this.advanceSession(session, step, true);
    }

    let success: boolean;
    let extraData: Record<string, unknown> | undefined;

    try {
      const result = await this.dispatchStep(step, credentials, session, realm);
      success = result.success;
      extraData = result.data;
    } catch (err: unknown) {
      // Propagate auth errors (they carry HTTP status codes)
      if (err instanceof UnauthorizedException) throw err;

      this.logger.error(
        `Step '${stepId}' (${step.type}) threw an unexpected error`,
        err,
      );

      // Try fallback path if available
      if (step.fallbackStepId) {
        session.currentStepId = step.fallbackStepId;
        return {
          success: false,
          stepId,
          stepType: step.type,
          nextStepId: step.fallbackStepId,
          flowComplete: false,
          message: 'Step failed; redirected to fallback',
        };
      }

      throw err;
    }

    if (!success) {
      if (step.fallbackStepId) {
        session.currentStepId = step.fallbackStepId;
        return {
          success: false,
          stepId,
          stepType: step.type,
          nextStepId: step.fallbackStepId,
          flowComplete: false,
          message: 'Step verification failed; redirected to fallback',
        };
      }
      return {
        success: false,
        stepId,
        stepType: step.type,
        nextStepId: stepId, // stay on same step
        flowComplete: false,
        message: 'Verification failed',
      };
    }

    // Step succeeded — record and advance
    const result = await this.advanceSession(session, step, true);
    result.data = extraData;
    return result;
  }

  // ── Step dispatcher ─────────────────────────────────────

  private async dispatchStep(
    step: FlowStep,
    credentials: Record<string, unknown>,
    session: FlowSession,
    realm: Realm,
  ): Promise<{ success: boolean; data?: Record<string, unknown> }> {
    switch (step.type) {
      case 'password':
        return this.handlePasswordStep(step, credentials, session, realm);

      case 'totp':
        return this.handleTotpStep(credentials, session);

      case 'webauthn':
        // WebAuthn challenge / response is handled by WebAuthnController;
        // the flow executor just verifies the assertion result stored on the
        // session context.
        return this.handleWebAuthnStep(credentials, session);

      case 'ldap':
        // LDAP is delegated to LoginService.validateCredentials (federation path)
        return this.handlePasswordStep(step, credentials, session, realm);

      case 'social':
      case 'email_otp':
      case 'magic_link':
      case 'consent':
        // These step types require external redirects / UI — the executor
        // records them as "pending" and the dedicated controller completes them.
        return { success: true, data: { pending: true, stepType: step.type } };

      default: {
        const stepType = step.type as string;
        this.logger.warn(`Unknown step type: ${stepType}`);
        return { success: false };
      }
    }
  }

  // ── Individual step handlers ────────────────────────────

  private async handlePasswordStep(
    _step: FlowStep,
    credentials: Record<string, unknown>,
    session: FlowSession,
    realm: Parameters<LoginService['validateCredentials']>[0],
  ): Promise<{ success: boolean }> {
    const { username, password } = credentials as {
      username?: string;
      password?: string;
    };
    if (!username || !password) {
      throw new BadRequestException(
        'username and password are required for password step',
      );
    }

    const user = await this.loginService.validateCredentials(
      realm,
      username,
      password,
    );
    // Store validated user on the session context for subsequent steps
    session.userId = user.id;
    session.context['user'] = {
      id: user.id,
      username: user.username,
      email: user.email,
      enabled: user.enabled,
    };
    return { success: true };
  }

  private async handleTotpStep(
    credentials: Record<string, unknown>,
    session: FlowSession,
  ): Promise<{ success: boolean }> {
    if (!session.userId) {
      throw new BadRequestException(
        'Password step must be completed before TOTP',
      );
    }
    const { code } = credentials as { code?: string };
    if (!code) {
      throw new BadRequestException('code is required for TOTP step');
    }

    // First try recovery code, then TOTP
    const recoveryOk = await this.mfaService.verifyRecoveryCode(
      session.userId,
      code,
    );
    if (recoveryOk) return { success: true };

    const totpOk = await this.mfaService.verifyTotp(session.userId, code);
    return { success: totpOk };
  }

  private handleWebAuthnStep(
    credentials: Record<string, unknown>,
    session: FlowSession,
  ): { success: boolean; data?: Record<string, unknown> } {
    // The WebAuthn assertion is completed by the /webauthn/authenticate endpoint.
    // If the assertion result is already on the context (placed there by that
    // controller), we accept it here.
    const webauthnVerified = session.context['webauthnVerified'] as
      boolean | undefined;
    const userId = credentials['userId'] as string | undefined;

    if (webauthnVerified && userId) {
      session.userId = userId;
      session.context['user'] = { id: userId };
      return { success: true };
    }

    // Signal that the caller must redirect to WebAuthn challenge
    return { success: false, data: { redirect: 'webauthn_challenge' } };
  }

  // ── Session advancement ─────────────────────────────────

  private async advanceSession(
    session: FlowSession,
    completedStep: FlowStep,

    _success: boolean,
  ): Promise<StepResult> {
    session.completedStepIds.push(completedStep.id);

    const nextStep = await this.authFlowService.getNextStep(
      session.flowId,
      completedStep.id,
      session.context,
    );

    session.currentStepId = nextStep?.id ?? null;
    session.complete = nextStep === null;

    return {
      success: true,
      stepId: completedStep.id,
      stepType: completedStep.type,
      nextStepId: nextStep?.id ?? null,
      flowComplete: session.complete,
    };
  }
}
