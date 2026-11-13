import { HttpException, Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthenticationFlow, Client, Realm, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginService } from '../login/login.service.js';
import { SessionIssuer } from '../login/session-issuer.service.js';
import {
  PostAuthService,
  authorizationError,
} from '../login/post-auth.service.js';
import { PrimaryAuthGatesService } from '../login/primary-auth-gates.service.js';
import { SecondFactorVerifier } from '../login/second-factor-verifier.service.js';
import { OAuthService } from '../oauth/oauth.service.js';
import { StepUpService } from '../step-up/step-up.service.js';
import { WebAuthnService } from '../webauthn/webauthn.service.js';
import {
  MfaService,
  MFA_ENROLLMENT_TTL_SECONDS,
  type MfaEnrollmentData,
} from '../mfa/mfa.service.js';
import { SmsOtpError, SmsOtpService } from '../sms/sms-otp.service.js';
import { EventsService } from '../events/events.service.js';
import { LoginEventType } from '../events/event-types.js';
import { ThemeRenderService } from '../theme/theme-render.service.js';
import { CsrfService } from '../common/csrf/csrf.service.js';
import { resolveClientIp } from '../common/utils/proxy-ip.util.js';
import { ACR_MFA, riskStepUpAcr, satisfiesAcr } from '../authn-core/acr.js';
import {
  AUTHN_TXN_COOKIE,
  MFA_ENROLLMENT_COOKIE,
  WEBAUTHN_LOGIN_COOKIE,
} from '../authn-core/cookies.js';
import {
  OAUTH_FORM_PARAM_KEYS,
  pickOAuthParams,
  type AuthorizeParams,
} from '../authn-core/oauth-params.js';
import {
  STEP_ENDPOINT,
  type LoginEndpoint,
  type StepOutcome,
} from '../authn-core/flow-contracts.js';
import {
  acrFromClaimsParam,
  acrFromReceipts,
  amrFromReceipts,
  computeTargetAcr,
  meetsAcr,
} from '../authn-core/flow-assurance.js';
import { isAuthFlowRuntimeEnabled } from './auth-flow-runtime.js';
import {
  FlowBindingResolver,
  type FlowBindingResolution,
} from './flow-binding.resolver.js';
import {
  FlowGraph,
  evaluateFlowCondition,
  runtimeSteps,
  type ConditionContext,
  type RuntimeStep,
} from './flow-graph.js';
import {
  AUTHN_TXN_TTL_MS,
  AuthnTransactionStore,
  type AuthnTxn,
  type AuthnTxnState,
  type SyntheticStep,
} from './authn-transaction.store.js';
import {
  FlowStepHandlers,
  type PasswordStepInput,
  type TotpStepInput,
  type WebAuthnStepInput,
} from './flow-step-handlers.service.js';

/** A submission to one of the existing login endpoints. */
export type FlowSubmission =
  | ({
      endpoint: 'password';
      rememberMe: boolean;
      deviceFingerprint: string | null;
      /** The form's client_id: only used when no transaction exists yet. */
      clientId?: string;
      /** The form's OAuth fields: only used to restart the login. */
      form: Record<string, string | undefined>;
    } & PasswordStepInput)
  | ({ endpoint: 'totp' } & TotpStepInput)
  | ({ endpoint: 'webauthn'; clientId?: string } & WebAuthnStepInput);

/** What the browser gets back; rendered per endpoint (redirect or JSON). */
type Reply =
  | { kind: 'redirect'; url: string }
  | { kind: 'error'; status: number; title: string; message: string };

interface ActiveTxn {
  txn: AuthnTxn;
  flow: AuthenticationFlow;
  graph: FlowGraph;
}

type Loaded =
  | { kind: 'none' }
  | { kind: 'active'; active: ActiveTxn }
  | { kind: 'reply'; reply: Reply };

/** Failed answers a transaction tolerates before the login starts over. */
export const MAX_FLOW_FAILURES = 5;

/** Ids of the steps the runtime adds after the flow. */
const ASSURANCE_STEP_PREFIX = '__assurance_';
const ASSURANCE_ENROL = `${ASSURANCE_STEP_PREFIX}enrol`;

const MISCONFIGURED_MESSAGE =
  'Sign-in for this application is not configured correctly. Please contact the administrator.';
const EXPIRED_MESSAGE = 'Your sign-in expired. Please sign in again.';
const INVALID_TXN_MESSAGE =
  'Your sign-in is no longer valid. Please sign in again.';
const FLOW_CHANGED_MESSAGE =
  'The sign-in steps changed while you were signing in. Please sign in again.';
const UNEXPECTED_STEP_MESSAGE =
  'This sign-in step was not expected. Please sign in again.';
const CONCURRENT_MESSAGE =
  'This sign-in is already being processed. Please wait a moment and reload the page.';
const USER_MISMATCH_MESSAGE =
  'You must finish signing in with the account you started with.';
const FAILED_MESSAGE = 'Sign-in failed. Please sign in again.';
const TOO_MANY_FAILURES_MESSAGE =
  'Too many failed attempts. Please sign in again.';

/**
 * The custom authentication-flow runtime. Behind the existing login
 * endpoints (themes hard-code their form actions), it drives a login
 * through the flow the binding resolver selects:
 *
 * - **Transaction.** A login transaction is server-side state (see
 *   AuthnTransactionStore) pointed to by the `IDENPLANE_AUTHN_TXN` cookie.
 *   The flow id and version are pinned at start; the OAuth request is taken
 *   from it and never again from a form.
 * - **Dispatch.** Every login POST is first offered to {@link dispatch}. The
 *   endpoint must match the current step, or the transaction fails closed.
 *   Outcomes: `passed` → gates (once, after identification) → advance;
 *   `failed` → the step's fallback, else an error on the same step;
 *   `locked`, a thrown error or another user → the transaction ends.
 * - **Finalisation.** ACR/AMR come only from the receipts. The sign-in must
 *   reach the target ACR (never weaker than the built-in login): assurance
 *   steps or the MFA-enrolment detour are added when it does not. Then the
 *   single-use claim, the session (SessionIssuer), consent and the code.
 *
 * With AUTH_FLOW_RUNTIME_ENABLED off, or for a login the resolver calls
 * `legacy`, every entry point returns false / `{ active: false }` before
 * doing anything, and the built-in login runs unchanged.
 */
@Injectable()
export class FlowRuntimeService {
  private readonly logger = new Logger(FlowRuntimeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: FlowBindingResolver,
    private readonly store: AuthnTransactionStore,
    private readonly handlers: FlowStepHandlers,
    private readonly gates: PrimaryAuthGatesService,
    private readonly secondFactorVerifier: SecondFactorVerifier,
    private readonly sessionIssuer: SessionIssuer,
    private readonly postAuth: PostAuthService,
    private readonly oauthService: OAuthService,
    private readonly loginService: LoginService,
    private readonly stepUpService: StepUpService,
    private readonly webAuthnService: WebAuthnService,
    private readonly mfaService: MfaService,
    private readonly smsOtp: SmsOtpService,
    private readonly eventsService: EventsService,
    private readonly themeRender: ThemeRenderService,
    private readonly csrfService: CsrfService,
  ) {}

  // ─── Entry: the authorization endpoint ─────────────────────

  /** Which flow (if any) a login of `client` in `realm` runs. */
  resolveBinding(
    realm: Realm,
    client: Pick<Client, 'authFlowId'> | null,
  ): Promise<FlowBindingResolution> {
    return this.resolver.resolve(realm, client);
  }

  /** The message of the 503 page for a misconfigured binding. */
  static readonly misconfiguredMessage = MISCONFIGURED_MESSAGE;

  /**
   * Starts a login transaction for an authorization request that `/auth`
   * has validated, and sends the browser to its first step.
   */
  async beginFromAuthorize(
    realm: Realm,
    flow: AuthenticationFlow,
    query: Record<string, string>,
    req: Request,
    res: Response,
  ): Promise<void> {
    await this.startTransaction(realm, flow, query, req, res);
    res.redirect(302, `/realms/${realm.name}/login`);
  }

  // ─── Entry: the login page ─────────────────────────────────

  /**
   * `GET /login`. Returns false (render the built-in page) when the login
   * is not bound to a flow. Otherwise renders the transaction's current
   * step, starting a transaction when the page carries an OAuth request
   * (validated here exactly as `/auth` does) or when none is active.
   */
  async showLoginPage(
    realm: Realm,
    query: Record<string, string>,
    req: Request,
    res: Response,
  ): Promise<boolean> {
    if (!isAuthFlowRuntimeEnabled()) return false;
    // A realm without custom flows has nothing to resolve, unless this
    // browser still holds a transaction from when it had.
    if (!realm.authFlowsEnabled && !this.txnCookie(req)) return false;
    const messages = { error: query['error'] ?? '', info: query['info'] ?? '' };

    if (query['client_id']) {
      const client = await this.findClient(realm, query['client_id']);
      const binding = await this.resolver.resolve(realm, client);
      if (binding.kind === 'legacy') return false;
      if (binding.kind === 'misconfigured') {
        this.renderMisconfigured(realm, binding, req, res);
        return true;
      }
      try {
        await this.oauthService.validateAuthRequest(
          realm,
          query as unknown as AuthorizeParams,
        );
      } catch (err) {
        this.renderError(
          realm,
          {
            kind: 'error',
            status: err instanceof HttpException ? err.getStatus() : 400,
            title: 'We can’t complete this sign-in request',
            message: describeError(err),
          },
          req,
          res,
        );
        return true;
      }
      const txn = await this.startTransaction(
        realm,
        binding.flow,
        query,
        req,
        res,
      );
      await this.renderStep(
        realm,
        { txn, flow: binding.flow, graph: graphOf(binding.flow) },
        messages,
        req,
        res,
      );
      return true;
    }

    const loaded = await this.load(realm, req, res);
    if (loaded.kind === 'reply') {
      this.send('page', realm, loaded.reply, req, res);
      return true;
    }
    if (loaded.kind === 'active') {
      await this.renderStep(realm, loaded.active, messages, req, res);
      return true;
    }

    // No transaction: a sign-in to the account console (no client).
    const binding = await this.resolver.resolve(realm, null);
    if (binding.kind === 'legacy') return false;
    if (binding.kind === 'misconfigured') {
      this.renderMisconfigured(realm, binding, req, res);
      return true;
    }
    const txn = await this.startTransaction(realm, binding.flow, {}, req, res);
    await this.renderStep(
      realm,
      { txn, flow: binding.flow, graph: graphOf(binding.flow) },
      messages,
      req,
      res,
    );
    return true;
  }

  /** `GET /totp` while a transaction is active; false otherwise. */
  async showTotpPage(
    realm: Realm,
    query: { error?: string; info?: string; method?: string },
    req: Request,
    res: Response,
  ): Promise<boolean> {
    if (!isAuthFlowRuntimeEnabled() || !this.txnCookie(req)) return false;
    const loaded = await this.load(realm, req, res);
    if (loaded.kind === 'none') return false;
    if (loaded.kind === 'reply') {
      this.send('page', realm, loaded.reply, req, res);
      return true;
    }
    const { active } = loaded;
    const step = this.currentStep(active);
    if (!step || step.type !== 'totp' || active.txn.state.enrolling) {
      res.redirect(302, this.pageOf(realm, active, {}));
      return true;
    }
    const userId = active.txn.state.userId as string;
    const factors = await this.mfaService.getEnrolledFactors(userId);
    const hasTotp = factors.includes('totp');
    let hasSms = false;
    let maskedPhone = '';
    if (factors.includes('sms') && SmsOtpService.canDeliver(realm)) {
      const phone = await this.smsOtp.getEnrolledPhone(userId);
      if (phone) {
        hasSms = true;
        maskedPhone = SmsOtpService.maskPhone(phone);
      }
    }
    const csrfToken = this.setCsrfCookie(realm, res);
    this.themeRender.render(
      res,
      realm,
      'login',
      'totp',
      {
        pageTitle: 'Two-Factor Authentication',
        error: query.error ?? '',
        info: query.info ?? '',
        csrfToken,
        hasTotp,
        hasSms,
        smsMode: hasSms && (query.method === 'sms' || !hasTotp),
        recoveryOnly: !hasTotp && !hasSms,
        maskedPhone,
      },
      req,
    );
    return true;
  }

  /**
   * `POST /totp/sms` while a transaction is active: texts a code to the
   * identified user, bound to this transaction. False otherwise.
   */
  async sendSmsCode(
    realm: Realm,
    req: Request,
    res: Response,
  ): Promise<boolean> {
    if (!isAuthFlowRuntimeEnabled() || !this.txnCookie(req)) return false;
    const loaded = await this.load(realm, req, res);
    if (loaded.kind === 'none') return false;
    if (loaded.kind === 'reply') {
      this.send('page', realm, loaded.reply, req, res);
      return true;
    }
    const { active } = loaded;
    const step = this.currentStep(active);
    if (!step || step.type !== 'totp' || active.txn.state.enrolling) {
      await this.end(active.txn.id, realm, res);
      this.send('page', realm, this.unexpectedStep(), req, res);
      return true;
    }
    const userId = active.txn.state.userId as string;
    try {
      const sent = await this.smsOtp.sendCode({
        realm,
        userId,
        purpose: 'login',
        binding: active.txn.id,
        ip: resolveClientIp(req),
      });
      void this.eventsService.recordLoginEvent({
        realmId: realm.id,
        type: LoginEventType.MFA_CHALLENGE,
        userId,
        ipAddress: resolveClientIp(req),
      });
      res.redirect(
        `/realms/${realm.name}/totp?method=sms&info=${encodeURIComponent(`We sent a code to ${sent.maskedPhone}.`)}`,
      );
    } catch (err) {
      if (!(err instanceof SmsOtpError)) throw err;
      res.redirect(
        `/realms/${realm.name}/totp?method=sms&error=${encodeURIComponent(err.message)}`,
      );
    }
    return true;
  }

  /**
   * `POST /webauthn/authenticate/options`: inside a transaction, the
   * challenge is for the identified user (whatever the body says).
   */
  async passkeyChallengeUser(
    realm: Realm,
    req: Request,
  ): Promise<{ active: false } | { active: true; userId?: string }> {
    if (!isAuthFlowRuntimeEnabled()) return { active: false };
    const token = this.txnCookie(req);
    if (!token) return { active: false };
    const found = await this.store.find(token);
    if (found.status !== 'active' || found.txn.state.realmId !== realm.id) {
      return { active: false };
    }
    return { active: true, userId: found.txn.state.userId ?? undefined };
  }

  // ─── Dispatch ──────────────────────────────────────────────

  /**
   * Runs first in every login POST endpoint. Returns false only when the
   * built-in login should handle the request: the runtime is off, or no
   * transaction is active and the resolver says `legacy`. Otherwise it has
   * answered the request (and the endpoint must return).
   */
  async dispatch(
    realm: Realm,
    submission: FlowSubmission,
    req: Request,
    res: Response,
  ): Promise<boolean> {
    if (!isAuthFlowRuntimeEnabled()) return false;
    const endpoint = submission.endpoint;

    if (!this.txnCookie(req)) {
      // The second-factor page only exists after a first factor, which a
      // bound login can only pass inside a transaction (SessionIssuer
      // refuses any session that bypasses one).
      if (endpoint === 'totp' || !realm.authFlowsEnabled) return false;
      const client = submission.clientId
        ? await this.findClient(realm, submission.clientId)
        : null;
      const binding = await this.resolver.resolve(realm, client);
      if (binding.kind === 'legacy') return false;
      if (binding.kind === 'misconfigured') {
        this.send(endpoint, realm, this.misconfiguredReply(), req, res);
        return true;
      }
      // Bound, but the browser has no transaction (a stale page, a forged
      // post): never the built-in login. Start again at the login page.
      const form = endpoint === 'password' ? submission.form : {};
      this.send(
        endpoint,
        realm,
        this.restartReply(
          realm,
          { oauthParams: pickOAuthParams(form, TXN_OAUTH_KEYS) },
          { error: INVALID_TXN_MESSAGE },
        ),
        req,
        res,
      );
      return true;
    }

    const loaded = await this.load(realm, req, res);
    if (loaded.kind === 'reply') {
      this.send(endpoint, realm, loaded.reply, req, res);
      return true;
    }
    if (loaded.kind === 'none') {
      // A cookie but no usable transaction: never the built-in login.
      this.send(
        endpoint,
        realm,
        this.restartReply(realm, {}, { error: INVALID_TXN_MESSAGE }),
        req,
        res,
      );
      return true;
    }

    const reply = await this.dispatchActive(
      realm,
      loaded.active,
      submission,
      req,
      res,
    );
    this.send(endpoint, realm, reply, req, res);
    return true;
  }

  private async dispatchActive(
    realm: Realm,
    active: ActiveTxn,
    submission: FlowSubmission,
    req: Request,
    res: Response,
  ): Promise<Reply> {
    const { graph } = active;
    const state: AuthnTxnState = structuredClone(active.txn.state);
    let step = this.currentStep(active);

    // The endpoint must be the current step's. One exception: posting to the
    // endpoint of the current step's own fallback declines the current step
    // (a cancelled passkey prompt never reaches the server, so the login
    // page's password form is how a user takes the password fallback). That
    // is a `failed` outcome the user could produce anyway with a wrong
    // answer, so it opens nothing a fallback would not.
    if (!step || state.enrolling) {
      await this.end(active.txn.id, realm, res);
      return this.unexpectedStep();
    }
    if (STEP_ENDPOINT[step.type] !== submission.endpoint) {
      const fallback = state.synthetic ? undefined : graph.fallbackOf(step);
      if (!fallback || STEP_ENDPOINT[fallback.type] !== submission.endpoint) {
        await this.end(active.txn.id, realm, res);
        return this.unexpectedStep();
      }
      step = fallback;
      state.currentStepId = fallback.id;
    }

    // Optimistic lock: of two concurrent submissions only one runs.
    const txn = await this.store.begin(active.txn);
    if (!txn) return this.concurrent();

    const pinned = state.userId
      ? await this.loginService.findUserById(state.userId)
      : null;
    if (state.userId && (!pinned || !pinned.enabled)) {
      await this.end(txn.id, realm, res);
      return this.restartReply(realm, state, { error: FAILED_MESSAGE });
    }

    const ip = resolveClientIp(req);
    let outcome: StepOutcome & { user?: User };
    try {
      outcome = await this.runHandler(realm, step, submission, txn, pinned, ip);
    } catch (err) {
      this.logger.error(
        `Flow step '${step.id}' (${step.type}) threw; the login transaction ends`,
        err instanceof Error ? err.stack : String(err),
      );
      await this.end(txn.id, realm, res);
      return this.restartReply(realm, state, { error: FAILED_MESSAGE });
    }

    switch (outcome.kind) {
      case 'user_mismatch':
        this.logger.warn(
          `Flow step '${step.id}' answered for another user; transaction ${txn.id} ends`,
        );
        await this.end(txn.id, realm, res);
        return this.restartReply(realm, state, {
          error: USER_MISMATCH_MESSAGE,
        });

      case 'locked':
        this.recordStepError(realm, state, step, ip, outcome.message);
        await this.end(txn.id, realm, res);
        return this.restartReply(realm, state, { error: outcome.message });

      case 'failed':
        this.recordStepError(realm, state, step, ip, outcome.message);
        return this.onFailed(
          realm,
          { ...active, txn },
          state,
          step,
          outcome,
          res,
        );

      case 'passed':
        return this.onPassed(
          realm,
          { ...active, txn },
          state,
          step,
          outcome,
          submission,
          req,
          res,
        );
    }
  }

  private async runHandler(
    realm: Realm,
    step: RuntimeStep,
    submission: FlowSubmission,
    txn: AuthnTxn,
    pinned: User | null,
    ip: string,
  ): Promise<StepOutcome & { user?: User }> {
    switch (submission.endpoint) {
      case 'password':
        return this.handlers.password(realm, step, submission, pinned, ip);
      case 'totp':
        if (!pinned) throw new Error('A totp step needs an identified user');
        // A texted code is bound to the transaction id, which survives the
        // cookie rotation.
        return this.handlers.totp(realm, pinned.id, submission, txn.id, ip);
      case 'webauthn':
        return this.handlers.webauthn(realm, submission, pinned?.id ?? null);
    }
  }

  private async onFailed(
    realm: Realm,
    active: ActiveTxn,
    state: AuthnTxnState,
    step: RuntimeStep,
    outcome: { message: string },
    res: Response,
  ): Promise<Reply> {
    state.failures += 1;
    if (state.failures >= MAX_FLOW_FAILURES) {
      await this.end(active.txn.id, realm, res);
      return this.restartReply(realm, state, {
        error: TOO_MANY_FAILURES_MESSAGE,
      });
    }
    const fallback = state.synthetic
      ? undefined
      : active.graph.fallbackOf(step);
    if (fallback) state.currentStepId = fallback.id;
    const committed = await this.store.commit(active.txn, state);
    if (!committed) return this.concurrent();
    return {
      kind: 'redirect',
      url: this.pageOf(
        realm,
        { ...active, txn: committed.txn },
        { error: outcome.message },
      ),
    };
  }

  private async onPassed(
    realm: Realm,
    active: ActiveTxn,
    state: AuthnTxnState,
    step: RuntimeStep,
    outcome: { userId: string; amr: string[]; user?: User },
    submission: FlowSubmission,
    req: Request,
    res: Response,
  ): Promise<Reply> {
    const identifying = state.userId === null;
    const user =
      outcome.user ?? (await this.loginService.findUserById(outcome.userId));
    if (!user) {
      await this.end(active.txn.id, realm, res);
      return this.restartReply(realm, state, { error: FAILED_MESSAGE });
    }

    if (identifying) {
      state.userId = user.id;
      if (submission.endpoint === 'password') {
        state.rememberMe = submission.rememberMe;
      }
      // The gates, once, right after identification: risk (block / step-up),
      // email verification, password expiry (not after a passkey, as the
      // built-in passkey sign-in).
      const gate = await this.gates.evaluate(realm, user, {
        ipAddress: resolveClientIp(req),
        userAgent: req.headers['user-agent'] ?? null,
        deviceFingerprint:
          submission.endpoint === 'password'
            ? submission.deviceFingerprint
            : null,
        form: state.oauthParams,
        skipPasswordExpiry: step.type === 'webauthn',
      });
      if (gate.kind === 'block') {
        await this.end(active.txn.id, realm, res);
        return { kind: 'redirect', url: gate.redirectUrl };
      }
      state.riskStepUp = gate.riskStepUp;
      state.riskScore = gate.riskScore ?? null;
      state.riskLevel = gate.riskLevel ?? null;
    }

    state.receipts.push({
      stepId: step.id,
      kind: step.type,
      amr: outcome.amr,
      at: new Date().toISOString(),
    });
    state.failures = 0;
    if (step.type === 'totp') {
      await this.secondFactorVerifier.recordSuccess(
        realm,
        user.id,
        resolveClientIp(req),
      );
    }

    if (state.synthetic) {
      state.syntheticDone.push(state.synthetic);
      state.synthetic = null;
      return this.finalise(realm, active, state, user, identifying, req, res);
    }
    return this.advance(realm, active, state, user, identifying, req, res);
  }

  /**
   * Moves to the next main-path step that applies, the MFA-enrolment detour,
   * or finalisation.
   */
  private async advance(
    realm: Realm,
    active: ActiveTxn,
    state: AuthnTxnState,
    user: User,
    rotate: boolean,
    req: Request,
    res: Response,
  ): Promise<Reply> {
    let context: ConditionContext | null = null;
    for (const step of active.graph.mainStepsAfter(state.mainStepId)) {
      if (step.condition) {
        context ??= await this.conditionContext(realm, user, state);
        // A condition decides whether the step applies at all.
        if (!evaluateFlowCondition(step.condition, context)) continue;
      }
      if (await this.canAttempt(realm, step, user)) {
        state.mainStepId = step.id;
        state.currentStepId = step.id;
        return this.commitAndShow(realm, active, state, rotate, res);
      }
      // The user has no credential for this step. Optional: skip it.
      if (!step.required) continue;
      state.mainStepId = step.id;
      // Required second factor not set up: enrol one, as the realm's
      // required-MFA policy does.
      if (step.type === 'totp') {
        state.currentStepId = step.id;
        return this.startEnrolment(realm, active, state, rotate, res);
      }
      // Otherwise its first fallback the user can do, if any.
      const usable = await this.firstUsable(
        realm,
        active.graph.chain(step).slice(1),
        user,
      );
      if (usable) {
        state.currentStepId = usable.id;
        return this.commitAndShow(realm, active, state, rotate, res);
      }
      await this.end(active.txn.id, realm, res);
      return this.restartReply(realm, state, {
        error:
          'Your account is not set up for a sign-in step this application requires. Please contact the administrator.',
      });
    }
    return this.finalise(realm, active, state, user, rotate, req, res);
  }

  private async firstUsable(
    realm: Realm,
    steps: RuntimeStep[],
    user: User,
  ): Promise<RuntimeStep | undefined> {
    for (const s of steps) {
      if (await this.canAttempt(realm, s, user)) return s;
    }
    return undefined;
  }

  /** Whether the identified user has what `step` checks. */
  private async canAttempt(
    realm: Realm,
    step: RuntimeStep,
    user: User,
  ): Promise<boolean> {
    switch (step.type) {
      case 'totp':
        return this.mfaService.isMfaEnabled(user.id);
      case 'webauthn':
        return (
          realm.webAuthnEnabled &&
          (await this.webAuthnService.hasCredentials(user.id, realm.id))
        );
      case 'ldap':
        return !!user.federationLink;
      case 'password':
        return !!user.passwordHash || !!user.federationLink;
    }
  }

  // ─── Finalisation ──────────────────────────────────────────

  private async finalise(
    realm: Realm,
    active: ActiveTxn,
    state: AuthnTxnState,
    user: User,
    rotate: boolean,
    req: Request,
    res: Response,
  ): Promise<Reply> {
    if (!user.enabled) {
      await this.end(active.txn.id, realm, res);
      return this.restartReply(realm, state, { error: FAILED_MESSAGE });
    }

    let client: Client | null = null;
    if (state.oauthParams['client_id']) {
      try {
        client = await this.oauthService.validateAuthRequest(
          realm,
          state.oauthParams as unknown as AuthorizeParams,
        );
      } catch (err) {
        await this.end(active.txn.id, realm, res);
        return {
          kind: 'error',
          status: err instanceof HttpException ? err.getStatus() : 400,
          title: 'We can’t complete this sign-in request',
          message: describeError(err),
        };
      }
    }

    // ACR and AMR from the receipts, and nothing else.
    const acr = acrFromReceipts(state.receipts);
    const amr = amrFromReceipts(state.receipts);

    // The legacy MFA rule, exactly as continueAfterPrimaryAuth applies it.
    const clientRequiresMfa =
      !!client?.requiredAcr && satisfiesAcr(client.requiredAcr, ACR_MFA);
    const mfaRequired =
      clientRequiresMfa ||
      (await this.mfaService.isMfaRequired(realm, user.id));
    const { target, mandatory } = computeTargetAcr({
      requested: state.requestedAcr,
      clientRequiredAcr: client?.requiredAcr,
      riskFloor: await this.stepUpService.getRiskRequiredAcr(realm.id, user.id),
      riskAcr: state.riskStepUp ? riskStepUpAcr(state.riskScore ?? 0) : null,
      mfaRequired,
    });

    if (target && !meetsAcr(acr, target)) {
      const next = await this.assuranceFor(
        realm,
        user,
        acr,
        target,
        mandatory,
        state,
      );
      if (next === 'totp' || next === 'webauthn') {
        state.synthetic = next;
        state.currentStepId = `${ASSURANCE_STEP_PREFIX}${next}`;
        return this.commitAndShow(realm, active, state, rotate, res);
      }
      if (next === 'enrol') {
        state.currentStepId = ASSURANCE_ENROL;
        return this.startEnrolment(realm, active, state, rotate, res);
      }
      if (next === 'deny') {
        await this.end(active.txn.id, realm, res);
        const description =
          'This application requires a stronger sign-in method';
        if (client) {
          return {
            kind: 'redirect',
            url: authorizationError(
              state.oauthParams,
              'access_denied',
              description,
            ),
          };
        }
        return {
          kind: 'error',
          status: 403,
          title: 'Sign-in failed',
          message: description,
        };
      }
      // 'proceed': only optional requirements are unmet and the user has
      // no means to meet them, exactly as the built-in login proceeds.
    }

    // Single use: exactly one request finalises this transaction.
    const proof = await this.store.claim(active.txn, state);
    this.clearTxnCookie(realm, res);
    if (!proof) return this.concurrent();

    const authContext = { acr: acr ?? undefined, amr };
    await this.sessionIssuer.issue(realm, user, authContext, req, res, {
      rememberMe: state.rememberMe,
      client,
      proof,
    });
    void this.eventsService.recordLoginEvent({
      realmId: realm.id,
      type: LoginEventType.LOGIN,
      userId: user.id,
      clientId: state.oauthParams['client_id'],
      ipAddress: resolveClientIp(req),
    });

    // Consent is not a flow step: the same decisions as every sign-in.
    const url = await this.postAuth.continueAuthorization(
      realm,
      user,
      client,
      state.oauthParams,
      authContext,
    );
    return { kind: 'redirect', url };
  }

  /**
   * How to close the gap between what the receipts prove and the target:
   * an assurance step the user can do, the enrolment detour, a refusal, or
   * nothing (only optional requirements unmet and no means to meet them).
   */
  private async assuranceFor(
    realm: Realm,
    user: User,
    acr: string | null,
    target: string,
    mandatory: string | null,
    state: AuthnTxnState,
  ): Promise<SyntheticStep | 'enrol' | 'deny' | 'proceed'> {
    const aboveMfa = !satisfiesAcr(ACR_MFA, target);
    const mandatoryAboveMfa = !!mandatory && !satisfiesAcr(ACR_MFA, mandatory);
    const canPasskey =
      !state.syntheticDone.includes('webauthn') &&
      realm.webAuthnEnabled &&
      (await this.webAuthnService.hasCredentials(user.id, realm.id));

    if (aboveMfa && canPasskey) return 'webauthn';
    // A passkey is mandatory and the user has none: nothing else will do.
    if (mandatoryAboveMfa && !meetsAcr(acr, mandatory)) return 'deny';

    if (!meetsAcr(acr, ACR_MFA)) {
      const canSecondFactor =
        !state.syntheticDone.includes('totp') &&
        (await this.mfaService.isMfaEnabled(user.id));
      if (canSecondFactor) return 'totp';
      if (mandatory && !meetsAcr(acr, mandatory)) {
        // No second factor at all: enrol one (once), as required MFA does.
        return state.receipts.some((r) => r.kind === 'enrolment')
          ? 'deny'
          : 'enrol';
      }
    }
    if (mandatory && !meetsAcr(acr, mandatory)) return 'deny';
    return 'proceed';
  }

  // ─── MFA-enrolment detour ──────────────────────────────────

  private async startEnrolment(
    realm: Realm,
    active: ActiveTxn,
    state: AuthnTxnState,
    rotate: boolean,
    res: Response,
  ): Promise<Reply> {
    state.enrolling = true;
    const committed = await this.store.commit(active.txn, state, { rotate });
    if (!committed) return this.concurrent();
    if (committed.token) this.setTxnCookie(realm, res, committed.token);

    const enrollmentToken = await this.mfaService.createMfaEnrollment({
      userId: state.userId as string,
      realmId: realm.id,
      oauthParams: {},
      rememberMe: state.rememberMe,
      primaryAmr: amrFromReceipts(state.receipts),
      authnTxnId: active.txn.id,
    });
    res.cookie(MFA_ENROLLMENT_COOKIE, enrollmentToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: MFA_ENROLLMENT_TTL_SECONDS * 1000,
      path: `/realms/${realm.name}`,
    });
    return {
      kind: 'redirect',
      url: `/realms/${realm.name}/account/totp-setup?info=${encodeURIComponent('Two-factor authentication is required. Please set it up now.')}`,
    };
  }

  /**
   * `POST /mfa-enrollment/continue` for an enrolment that is a detour of a
   * transaction: the new factor is the step's receipt, then the login goes
   * on. The enrolment row is already consumed by the caller.
   */
  async resumeAfterEnrolment(
    realm: Realm,
    enrollment: MfaEnrollmentData,
    req: Request,
    res: Response,
  ): Promise<void> {
    const loaded = isAuthFlowRuntimeEnabled()
      ? await this.load(realm, req, res)
      : ({ kind: 'none' } as Loaded);
    if (loaded.kind === 'reply') {
      return this.send('page', realm, loaded.reply, req, res);
    }
    if (
      loaded.kind === 'none' ||
      loaded.active.txn.id !== enrollment.authnTxnId ||
      loaded.active.txn.state.userId !== enrollment.userId ||
      !loaded.active.txn.state.enrolling
    ) {
      if (loaded.kind === 'active') {
        await this.end(loaded.active.txn.id, realm, res);
      } else {
        this.clearTxnCookie(realm, res);
      }
      return this.send(
        'page',
        realm,
        this.restartReply(realm, {}, { error: INVALID_TXN_MESSAGE }),
        req,
        res,
      );
    }

    const { active } = loaded;
    const txn = await this.store.begin(active.txn);
    if (!txn) return this.send('page', realm, this.concurrent(), req, res);
    const state: AuthnTxnState = structuredClone(active.txn.state);
    const user = await this.loginService.findUserById(enrollment.userId);
    if (
      !user ||
      !user.enabled ||
      !(await this.mfaService.isMfaEnabled(user.id))
    ) {
      await this.end(txn.id, realm, res);
      return this.send(
        'page',
        realm,
        this.restartReply(realm, state, { error: 'Please sign in again.' }),
        req,
        res,
      );
    }

    state.enrolling = false;
    state.receipts.push({
      stepId: state.currentStepId,
      kind: 'enrolment',
      amr: [enrollment.factor === 'sms' ? 'sms' : 'otp'],
      at: new Date().toISOString(),
    });
    const next = { ...active, txn };
    const reply =
      state.currentStepId === ASSURANCE_ENROL
        ? await this.finalise(realm, next, state, user, false, req, res)
        : await this.advance(realm, next, state, user, false, req, res);
    return this.send('page', realm, reply, req, res);
  }

  // ─── Transactions ──────────────────────────────────────────

  private async startTransaction(
    realm: Realm,
    flow: AuthenticationFlow,
    query: Record<string, string | undefined>,
    req: Request,
    res: Response,
  ): Promise<AuthnTxn> {
    // A new login replaces whatever this browser had in progress.
    const previous = this.txnCookie(req);
    if (previous) {
      const found = await this.store.find(previous);
      if (found.status !== 'missing' && found.txn.state.realmId === realm.id) {
        await this.store.destroy(found.txn.id);
      }
    }

    const graph = graphOf(flow);
    const requestedAcr = [
      query['acr_values']?.split(' ').filter(Boolean)[0],
      acrFromClaimsParam(query['claims']),
    ].filter((v): v is string => !!v);
    const { txn, token } = await this.store.create({
      realmId: realm.id,
      flowId: flow.id,
      flowVersion: flow.version,
      oauthParams: pickOAuthParams(query, TXN_OAUTH_KEYS),
      requestedAcr,
      loginHint: query['login_hint'] || null,
      claims: query['claims'] || null,
      userId: null,
      mainStepId: graph.first.id,
      currentStepId: graph.first.id,
      synthetic: null,
      syntheticDone: [],
      enrolling: false,
      receipts: [],
      rememberMe: false,
      riskStepUp: false,
      riskScore: null,
      riskLevel: null,
      failures: 0,
    });
    this.setTxnCookie(realm, res, token);
    return txn;
  }

  /**
   * The browser's active transaction. Anything else that came with a
   * cookie (expired, another realm, a binding or flow version that changed)
   * ends here and becomes a restart reply: never the built-in login.
   */
  private async load(
    realm: Realm,
    req: Request,
    res: Response,
  ): Promise<Loaded> {
    const token = this.txnCookie(req);
    if (!token) return { kind: 'none' };
    const found = await this.store.find(token);
    if (found.status === 'missing') {
      this.clearTxnCookie(realm, res);
      return { kind: 'none' };
    }
    const { txn } = found;
    if (txn.state.realmId !== realm.id) {
      this.clearTxnCookie(realm, res);
      return { kind: 'none' };
    }
    if (found.status === 'expired') {
      await this.end(txn.id, realm, res);
      return {
        kind: 'reply',
        reply: this.restartReply(realm, txn.state, { error: EXPIRED_MESSAGE }),
      };
    }

    // The flow is pinned: same binding, same flow, same version.
    const clientId = txn.state.oauthParams['client_id'];
    const client = clientId ? await this.findClient(realm, clientId) : null;
    const binding = await this.resolver.resolve(realm, client);
    if (
      binding.kind !== 'bound' ||
      binding.flow.id !== txn.state.flowId ||
      binding.flow.version !== txn.state.flowVersion
    ) {
      await this.end(txn.id, realm, res);
      return {
        kind: 'reply',
        reply: this.restartReply(realm, txn.state, {
          error: FLOW_CHANGED_MESSAGE,
        }),
      };
    }
    return {
      kind: 'active',
      active: { txn, flow: binding.flow, graph: graphOf(binding.flow) },
    };
  }

  /** Ends a transaction and drops the browser's handle to it. */
  private async end(txnId: string, realm: Realm, res: Response) {
    await this.store.destroy(txnId);
    this.clearTxnCookie(realm, res);
  }

  private async commitAndShow(
    realm: Realm,
    active: ActiveTxn,
    state: AuthnTxnState,
    rotate: boolean,
    res: Response,
  ): Promise<Reply> {
    const committed = await this.store.commit(active.txn, state, { rotate });
    if (!committed) return this.concurrent();
    if (committed.token) this.setTxnCookie(realm, res, committed.token);
    return {
      kind: 'redirect',
      url: this.pageOf(realm, { ...active, txn: committed.txn }, {}),
    };
  }

  private currentStep(active: ActiveTxn): RuntimeStep | undefined {
    const { state } = active.txn;
    if (state.synthetic) {
      return {
        id: `${ASSURANCE_STEP_PREFIX}${state.synthetic}`,
        type: state.synthetic,
        required: true,
        order: Number.MAX_SAFE_INTEGER,
      };
    }
    return active.graph.step(state.currentStepId);
  }

  /** The page of the transaction's current step. */
  private pageOf(
    realm: Realm,
    active: ActiveTxn,
    messages: { error?: string; info?: string },
  ): string {
    const qs = new URLSearchParams();
    if (messages.error) qs.set('error', messages.error);
    if (messages.info) qs.set('info', messages.info);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const step = this.currentStep(active);
    if (active.txn.state.enrolling) {
      return `/realms/${realm.name}/account/totp-setup${suffix}`;
    }
    return step?.type === 'totp'
      ? `/realms/${realm.name}/totp${suffix}`
      : `/realms/${realm.name}/login${suffix}`;
  }

  /** Renders the current step with the existing login templates. */
  private async renderStep(
    realm: Realm,
    active: ActiveTxn,
    messages: { error: string; info: string },
    req: Request,
    res: Response,
  ): Promise<void> {
    const step = this.currentStep(active);
    if (!step || step.type === 'totp' || active.txn.state.enrolling) {
      res.redirect(302, this.pageOf(realm, active, messages));
      return;
    }
    const { state } = active.txn;
    const pinned = state.userId
      ? await this.loginService.findUserById(state.userId)
      : null;
    const fallback = state.synthetic
      ? undefined
      : active.graph.fallbackOf(step);
    const passkey =
      !!realm.webAuthnEnabled &&
      (step.type === 'webauthn' || fallback?.type === 'webauthn');

    const registerQs = new URLSearchParams(
      pickOAuthParams(state.oauthParams, OAUTH_FORM_PARAM_KEYS),
    ).toString();
    const csrfToken = this.setCsrfCookie(realm, res);
    this.themeRender.render(
      res,
      realm,
      'login',
      'login',
      {
        pageTitle: 'Sign In',
        registrationAllowed: realm.registrationAllowed && !pinned,
        webAuthnEnabled: passkey,
        // The OAuth request lives in the transaction; the hidden fields
        // stay empty, and anything posted in them is ignored.
        client_id: '',
        redirect_uri: '',
        response_type: '',
        scope: '',
        state: '',
        nonce: '',
        code_challenge: '',
        code_challenge_method: '',
        prompt: '',
        error: messages.error,
        info: messages.info,
        login_hint: pinned?.username ?? state.loginHint ?? '',
        registerUrl: `/realms/${realm.name}/register${registerQs ? `?${registerQs}` : ''}`,
        // Social sign-in is not a flow step yet.
        identityProviders: [],
        csrfToken,
      },
      req,
    );
  }

  /** The condition context: the whitelisted user, client and risk fields. */
  private async conditionContext(
    realm: Realm,
    user: User,
    state: AuthnTxnState,
  ): Promise<ConditionContext> {
    const [groups, roles, factors, webauthnEnrolled] = await Promise.all([
      this.prisma.userGroup.findMany({
        where: { userId: user.id },
        select: { group: { select: { name: true } } },
      }),
      this.prisma.userRole.findMany({
        where: { userId: user.id },
        select: { role: { select: { name: true } } },
      }),
      this.mfaService.getEnrolledFactors(user.id),
      this.webAuthnService.hasCredentials(user.id, realm.id),
    ]);
    return {
      user: {
        username: user.username,
        email: user.email,
        emailVerified: user.emailVerified,
        groups: groups.map((g) => g.group.name),
        roles: roles.map((r) => r.role.name),
        totpEnrolled: factors.includes('totp'),
        webauthnEnrolled,
      },
      client: { clientId: state.oauthParams['client_id'] ?? null },
      risk: { level: state.riskLevel },
    };
  }

  private recordStepError(
    realm: Realm,
    state: AuthnTxnState,
    step: RuntimeStep,
    ip: string,
    message: string,
  ): void {
    // The second-factor verifier records its own MFA error event.
    if (step.type === 'totp') return;
    void this.eventsService.recordLoginEvent({
      realmId: realm.id,
      type: LoginEventType.LOGIN_ERROR,
      userId: state.userId ?? undefined,
      clientId: state.oauthParams['client_id'],
      ipAddress: ip,
      error: message,
    });
  }

  // ─── Replies ───────────────────────────────────────────────

  /**
   * Back to the login page with a fresh start: with the stored OAuth
   * request when there is one (the page validates it and starts a new
   * transaction), otherwise as a sign-in to the account console.
   */
  private restartReply(
    realm: Realm,
    from: {
      oauthParams?: Record<string, string>;
      loginHint?: string | null;
      claims?: string | null;
    },
    messages: { error?: string; info?: string },
  ): Reply {
    const qs = new URLSearchParams(
      pickOAuthParams(from.oauthParams ?? {}, TXN_OAUTH_KEYS),
    );
    if (from.loginHint) qs.set('login_hint', from.loginHint);
    if (from.claims) qs.set('claims', from.claims);
    if (messages.error) qs.set('error', messages.error);
    if (messages.info) qs.set('info', messages.info);
    return {
      kind: 'redirect',
      url: `/realms/${realm.name}/login?${qs.toString()}`,
    };
  }

  private unexpectedStep(): Reply {
    return {
      kind: 'error',
      status: 400,
      title: 'Sign-in failed',
      message: UNEXPECTED_STEP_MESSAGE,
    };
  }

  private concurrent(): Reply {
    return {
      kind: 'error',
      status: 409,
      title: 'Sign-in in progress',
      message: CONCURRENT_MESSAGE,
    };
  }

  private misconfiguredReply(): Extract<Reply, { kind: 'error' }> {
    return {
      kind: 'error',
      status: 503,
      title: 'Sign-in unavailable',
      message: MISCONFIGURED_MESSAGE,
    };
  }

  private renderMisconfigured(
    realm: Realm,
    binding: Extract<FlowBindingResolution, { kind: 'misconfigured' }>,
    req: Request,
    res: Response,
  ): void {
    this.logger.error(
      `Login in realm ${realm.id} refused: ${binding.source} flow binding ${binding.flowId} is ${binding.reason}`,
    );
    this.renderError(realm, this.misconfiguredReply(), req, res);
  }

  private renderError(
    realm: Realm,
    reply: Extract<Reply, { kind: 'error' }>,
    req: Request,
    res: Response,
  ): void {
    res.status(reply.status);
    this.themeRender.render(
      res,
      realm,
      'login',
      'error',
      {
        pageTitle: reply.title,
        errorTitle: reply.title,
        errorMessage: reply.message,
      },
      req,
    );
  }

  /**
   * Answers in the shape the endpoint's page expects: the passkey script
   * reads JSON (`{ redirectUrl }` / `{ message }`), the forms follow
   * redirects and show themed error pages.
   */
  private send(
    endpoint: LoginEndpoint | 'page',
    realm: Realm,
    reply: Reply,
    req: Request,
    res: Response,
  ): void {
    if (endpoint === 'webauthn') {
      // The challenge handle is single use, whatever the outcome.
      res.clearCookie(WEBAUTHN_LOGIN_COOKIE, { path: `/realms/${realm.name}` });
      if (reply.kind === 'redirect') {
        res.status(200).json({ redirectUrl: reply.url });
      } else {
        res
          .status(reply.status)
          .json({ statusCode: reply.status, message: reply.message });
      }
      return;
    }
    if (reply.kind === 'redirect') {
      res.redirect(302, reply.url);
    } else {
      this.renderError(realm, reply, req, res);
    }
  }

  // ─── Cookies and lookups ───────────────────────────────────

  private txnCookie(req: Request): string | undefined {
    const value = (req.cookies as Record<string, string | undefined>)?.[
      AUTHN_TXN_COOKIE
    ];
    return value || undefined;
  }

  private setTxnCookie(realm: Realm, res: Response, token: string): void {
    res.cookie(AUTHN_TXN_COOKIE, token, {
      httpOnly: true,
      secure: true, // session/auth cookies must never traverse plain HTTP (localhost is a secure context)
      // Lax: /auth sets it on a navigation that an application on another
      // site started, and the redirect to the login page must carry it.
      // Every state-changing form still carries a CSRF token.
      sameSite: 'lax',
      maxAge: AUTHN_TXN_TTL_MS,
      path: `/realms/${realm.name}`,
    });
  }

  private clearTxnCookie(realm: Realm, res: Response): void {
    res.clearCookie(AUTHN_TXN_COOKIE, { path: `/realms/${realm.name}` });
  }

  private setCsrfCookie(realm: Realm, res: Response): string {
    const token = this.csrfService.generateToken();
    res.cookie(this.csrfService.cookieName(realm.name), token, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: `/realms/${realm.name}`,
    });
    return token;
  }

  private findClient(
    realm: Realm,
    clientId: string,
  ): Promise<Pick<Client, 'authFlowId'> | null> {
    return this.prisma.client.findUnique({
      where: { realmId_clientId: { realmId: realm.id, clientId } },
      select: { authFlowId: true },
    });
  }
}

/** The OAuth request a transaction keeps (the form keys plus acr_values). */
const TXN_OAUTH_KEYS = [...OAUTH_FORM_PARAM_KEYS, 'acr_values'] as const;

function graphOf(flow: AuthenticationFlow): FlowGraph {
  return new FlowGraph(runtimeSteps(flow.steps));
}

function describeError(err: unknown): string {
  if (err instanceof HttpException) {
    const response = err.getResponse();
    if (typeof response === 'string') return response;
    if (response && typeof response === 'object' && 'message' in response) {
      const message: unknown = response.message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message)) return message.join(', ');
    }
    return err.message;
  }
  return 'The sign-in request could not be processed. Please try again.';
}
