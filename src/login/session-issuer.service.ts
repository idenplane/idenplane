import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Realm, User } from '@prisma/client';
import { LoginService } from './login.service.js';
import { resolveClientIp } from '../common/utils/proxy-ip.util.js';
import type { AuthContext } from '../authn-core/auth-context.js';
import { SESSION_COOKIE } from '../authn-core/cookies.js';

/** How long a "remember me" SSO cookie lasts. */
const REMEMBER_ME_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The one place an SSO session is created and its cookie set. Every sign-in
 * path that ends in a session (the login pages, a passkey) goes through here,
 * so the session always records how it was established and the cookie always
 * has the same attributes. A lint rule forbids `createLoginSession(`
 * anywhere else.
 */
@Injectable()
export class SessionIssuer {
  constructor(private readonly loginService: LoginService) {}

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
    options: { rememberMe?: boolean } = {},
  ): Promise<string> {
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
}
