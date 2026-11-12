import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Realm, User } from '@prisma/client';
import { OAuthService } from '../oauth/oauth.service.js';
import { EventsService } from '../events/events.service.js';
import { LoginEventType } from '../events/event-types.js';
import { MfaService, MFA_ENROLLMENT_TTL_SECONDS } from '../mfa/mfa.service.js';
import type { VerifiedFactor } from '../mfa/mfa.service.js';
import { resolveClientIp } from '../common/utils/proxy-ip.util.js';
import { ACR_MFA, ACR_PASSWORD, satisfiesAcr } from '../authn-core/acr.js';
import {
  amrForFactor,
  amrWithOtp,
  type AuthContext,
} from '../authn-core/auth-context.js';
import {
  MFA_CHALLENGE_COOKIE,
  MFA_ENROLLMENT_COOKIE,
} from '../authn-core/cookies.js';
import type { AuthorizeParams } from '../authn-core/oauth-params.js';
import { SessionIssuer } from './session-issuer.service.js';
import { PostAuthService, authorizationError } from './post-auth.service.js';

export { MFA_CHALLENGE_COOKIE };

/**
 * What happens after a user has proven who they are with a first factor
 * (a password, or a federated login at an external identity provider).
 *
 * Every first-factor path goes through here so they all apply the same
 * realm policy — the TOTP challenge, required-MFA enrolment — and finish the
 * same way: an SSO session that records how it was established, the login
 * event, the consent screen and the authorization code. Keeping this in one
 * place is what stops a second sign-in path from silently skipping MFA.
 */
@Injectable()
export class LoginFlowService {
  constructor(
    private readonly oauthService: OAuthService,
    private readonly eventsService: EventsService,
    private readonly mfaService: MfaService,
    private readonly sessionIssuer: SessionIssuer,
    private readonly postAuth: PostAuthService,
  ) {}

  /**
   * @param primaryAmr RFC 8176 methods of the first factor (`['pwd']` for a
   *   password; empty for a federated login, whose methods are not known).
   */
  /**
   * Starts the second-factor challenge for a user who has one enrolled and
   * sends the browser to it. Used after the first factor, and by the risk
   * step-up when MFA is otherwise optional.
   */
  async startSecondFactor(
    realm: Realm,
    user: User,
    oauthParams: Record<string, string>,
    primaryAmr: string[],
    res: Response,
  ): Promise<void> {
    const challengeToken = await this.mfaService.createMfaChallenge(
      user.id,
      realm.id,
      oauthParams,
      undefined,
      primaryAmr,
    );
    res.cookie(MFA_CHALLENGE_COOKIE, challengeToken, {
      httpOnly: true,
      secure: true, // session/auth cookies must never traverse plain HTTP (localhost is a secure context)
      sameSite: 'strict',
      maxAge: 5 * 60 * 1000,
      path: `/realms/${realm.name}`,
    });
    return res.redirect(`/realms/${realm.name}/totp`);
  }

  async continueAfterPrimaryAuth(
    realm: Realm,
    user: User,
    oauthParams: Record<string, string>,
    options: { primaryAmr: string[]; rememberMe?: boolean },
    req: Request,
    res: Response,
  ): Promise<void> {
    // A client that requires MFA (or stronger) makes MFA required for this
    // sign-in, exactly like a realm that requires it: enrolled users answer a
    // challenge, others enrol first.
    const client = oauthParams['client_id']
      ? await this.oauthService.validateAuthRequest(
          realm,
          oauthParams as unknown as AuthorizeParams,
        )
      : null;
    // A password with any second factor reaches MFA at most: a client that
    // requires more (a passkey) cannot be satisfied on this path at all.
    if (client?.requiredAcr && !satisfiesAcr(ACR_MFA, client.requiredAcr)) {
      return res.redirect(
        302,
        authorizationError(
          oauthParams,
          'access_denied',
          'This application requires signing in with a passkey',
        ),
      );
    }
    const clientRequiresMfa =
      !!client?.requiredAcr && satisfiesAcr(client.requiredAcr, ACR_MFA);
    const mfaRequired =
      clientRequiresMfa ||
      (await this.mfaService.isMfaRequired(realm, user.id));
    const mfaEnabled = await this.mfaService.isMfaEnabled(user.id);

    if (mfaEnabled) {
      // The user has TOTP set up — require it.
      return this.startSecondFactor(
        realm,
        user,
        oauthParams,
        options.primaryAmr,
        res,
      );
    }

    if (mfaRequired) {
      // The realm requires MFA and this user has not enrolled yet. Issuing
      // an SSO session here would hand out a single-factor session that
      // /authorize and SAML accept, defeating the requirement. Instead the
      // user gets a short-lived enrolment token that only unlocks the TOTP
      // setup page; the session is created after enrolment, at the MFA level.
      const enrollmentToken = await this.mfaService.createMfaEnrollment({
        userId: user.id,
        realmId: realm.id,
        oauthParams,
        rememberMe: !!options.rememberMe,
        primaryAmr: options.primaryAmr,
      });
      res.cookie(MFA_ENROLLMENT_COOKIE, enrollmentToken, {
        httpOnly: true,
        secure: true, // session/auth cookies must never traverse plain HTTP (localhost is a secure context)
        sameSite: 'strict',
        maxAge: MFA_ENROLLMENT_TTL_SECONDS * 1000,
        path: `/realms/${realm.name}`,
      });
      return res.redirect(
        `/realms/${realm.name}/account/totp-setup?info=${encodeURIComponent('Two-factor authentication is required. Please set it up now.')}`,
      );
    }

    // No second factor needed.
    return this.completeLogin(
      realm,
      user,
      oauthParams,
      req,
      res,
      { acr: ACR_PASSWORD, amr: options.primaryAmr },
      { rememberMe: options.rememberMe },
    );
  }

  /**
   * Create the SSO session at the level that was actually satisfied, then
   * continue the OAuth request: account page, consent screen or code.
   */
  async completeLogin(
    realm: Realm,
    user: User,
    oauthParams: Record<string, string>,
    req: Request,
    res: Response,
    authContext: AuthContext = {},
    options: { rememberMe?: boolean } = {},
  ): Promise<void> {
    // Validate OAuth request (including redirect_uri) BEFORE creating session
    let client;
    if (oauthParams['client_id']) {
      client = await this.oauthService.validateAuthRequest(
        realm,
        oauthParams as unknown as AuthorizeParams,
      );
    }

    // Session fixation: any session the browser already holds is replaced.
    await this.sessionIssuer.issue(realm, user, authContext, req, res, {
      rememberMe: options.rememberMe,
    });

    void this.eventsService.recordLoginEvent({
      realmId: realm.id,
      type: LoginEventType.LOGIN,
      userId: user.id,
      clientId: oauthParams['client_id'],
      ipAddress: resolveClientIp(req),
    });

    // Account page, client policy, consent screen or authorization code.
    const redirectUrl = await this.postAuth.continueAuthorization(
      realm,
      user,
      client,
      oauthParams,
      authContext,
    );
    res.redirect(302, redirectUrl);
  }

  /** The methods to record once TOTP completes a sign-in (RFC 8176). */
  static amrWithOtp(primaryAmr: string[] | undefined): string[] {
    return amrWithOtp(primaryAmr);
  }

  /**
   * RFC 8176 methods after a second factor: `sms` for a texted code, `otp`
   * for an authenticator or recovery code.
   */
  static amrForFactor(
    primaryAmr: string[] | undefined,
    factor: VerifiedFactor | undefined,
  ): string[] {
    return amrForFactor(primaryAmr, factor);
  }
}
