import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Realm, User } from '@prisma/client';
import { LoginService } from './login.service.js';
import { resolveClientIp } from '../common/utils/proxy-ip.util.js';
import type { AuthContext } from '../authn-core/auth-context.js';
import { SESSION_COOKIE } from '../authn-core/cookies.js';
import {
  LEGACY_SESSION_PROOF,
  isMintedFlowSessionProof,
  type SessionProof,
} from '../authn-core/flow-contracts.js';
import { isAuthFlowRuntimeEnabled } from '../auth-flow/auth-flow-runtime.js';
import {
  FlowBindingResolver,
  type ResolverClient,
} from '../auth-flow/flow-binding.resolver.js';

/** How long a "remember me" SSO cookie lasts. */
const REMEMBER_ME_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The one place an SSO session is created and its cookie set. Every sign-in
 * path that ends in a session (the login pages, a passkey) goes through here,
 * so the session always records how it was established and the cookie always
 * has the same attributes. A lint rule forbids `createLoginSession(`
 * anywhere else.
 *
 * It is also the last line of the custom-flow runtime: where the binding
 * resolver says a login runs a bound flow, a session is only issued for a
 * finalised login transaction of exactly that flow and version, never for
 * the built-in ("legacy") sign-in paths.
 */
@Injectable()
export class SessionIssuer {
  private readonly logger = new Logger(SessionIssuer.name);

  constructor(
    private readonly loginService: LoginService,
    private readonly flowBinding: FlowBindingResolver,
  ) {}

  /**
   * Creates the SSO session at the level that was satisfied and sets its
   * cookie. Any session the browser already holds is replaced, so a session
   * planted before sign-in cannot be carried over (session fixation).
   *
   * @returns the new session token.
   */
  async issue(
    realm: Realm,
    user: User,
    authContext: AuthContext,
    req: Request,
    res: Response,
    options: {
      rememberMe?: boolean;
      /** The client of the OAuth request (decides the flow binding). */
      client?: ResolverClient | null;
      /** How the sign-in was completed; the built-in paths by default. */
      proof?: SessionProof;
    } = {},
  ): Promise<string> {
    await this.assertProofAccepted(
      realm,
      user,
      options.client ?? null,
      options.proof ?? LEGACY_SESSION_PROOF,
    );

    const sessionToken = await this.loginService.createLoginSession(
      realm,
      user,
      resolveClientIp(req),
      req.headers['user-agent'],
      req.cookies?.[SESSION_COOKIE] as string | undefined,
      // Recorded on the session so silent SSO later reports the real acr/amr
      // (and an MFA-required realm accepts the session).
      authContext,
    );

    res.cookie(SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      secure: true, // session/auth cookies must never traverse plain HTTP (localhost is a secure context)
      // Lax, not Strict: applications on other sites send the browser here
      // with a top-level GET (authorization, logout), and a Strict cookie
      // would not come along, so single sign-on and sign-out would not see
      // the session. Every state-changing form still carries a CSRF token.
      sameSite: 'lax',
      // Without "remember me" the cookie lasts as long as the browser session.
      maxAge: options.rememberMe ? REMEMBER_ME_MAX_AGE_MS : undefined,
      path: `/realms/${realm.name}`,
    });

    return sessionToken;
  }

  /**
   * Throws (403) unless a built-in sign-in path may finish a login of
   * `client` in `realm`: false only where the binding resolver says the
   * login is bound to a flow (or misconfigured). Built-in paths call this
   * before any side effect (an MFA challenge, a texted code), so a refused
   * sign-in fails at its first step rather than after a consumed code.
   * Without AUTH_FLOW_RUNTIME_ENABLED it returns without reading anything.
   */
  async assertBuiltInSignInAllowed(
    realm: Realm,
    client: ResolverClient | null,
  ): Promise<void> {
    if (!isAuthFlowRuntimeEnabled()) return;
    const binding = await this.flowBinding.resolve(realm, client);
    if (binding.kind === 'legacy') return;
    this.logger.warn(
      `Refused a built-in sign-in in realm ${realm.id}: the login is bound to a custom flow (${binding.kind})`,
    );
    throw new ForbiddenException(
      'Sign-in must be completed through this application’s sign-in flow. Please start again.',
    );
  }

  /**
   * Refuses a session the binding does not allow: built-in sign-in proof
   * where a flow is bound (or misconfigured), or flow proof that is not a
   * finalised transaction of the flow and version bound right now.
   */
  private async assertProofAccepted(
    realm: Realm,
    user: User,
    client: ResolverClient | null,
    proof: SessionProof,
  ): Promise<void> {
    if (proof.kind === 'legacy') {
      return this.assertBuiltInSignInAllowed(realm, client);
    }

    const binding = await this.flowBinding.resolve(realm, client);
    const accepted =
      isMintedFlowSessionProof(proof) &&
      proof.realmId === realm.id &&
      proof.userId === user.id &&
      binding.kind === 'bound' &&
      binding.flow.id === proof.flowId &&
      binding.flow.version === proof.flowVersion;
    if (!accepted) {
      this.logger.warn(
        `Refused a flow sign-in session in realm ${realm.id}: the proof does not match the current binding`,
      );
      throw new ForbiddenException(
        'The sign-in flow changed during sign-in. Please start again.',
      );
    }
  }
}
