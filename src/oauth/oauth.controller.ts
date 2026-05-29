import {
  Controller,
  Get,
  HttpException,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { Realm } from '@prisma/client';
import { OAuthService, type AuthorizeParams } from './oauth.service.js';
import { LoginService } from '../login/login.service.js';
import { ConsentService } from '../consent/consent.service.js';
import {
  StepUpService,
  ACR_PASSWORD,
  ACR_MFA,
  ACR_WEBAUTHN,
} from '../step-up/step-up.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { ThemeRenderService } from '../theme/theme-render.service.js';

@ApiTags('OAuth')
@Controller('realms/:realmName/protocol/openid-connect')
@UseGuards(RealmGuard)
@Public()
export class OAuthController {
  constructor(
    private readonly oauthService: OAuthService,
    private readonly loginService: LoginService,
    private readonly consentService: ConsentService,
    private readonly stepUpService: StepUpService,
    private readonly crypto: CryptoService,
    private readonly prisma: PrismaService,
    private readonly themeRender: ThemeRenderService,
  ) {}

  @Get('auth')
  @ApiOperation({ summary: 'Authorization endpoint (code flow)' })
  @ApiResponse({
    status: 302,
    description:
      'Redirect to login page or redirect_uri with authorization code',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request — missing or invalid OAuth parameters',
  })
  async authorize(
    @CurrentRealm() realm: Realm,
    @Query() query: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      await this.authorizeInternal(realm, query, req, res);
    } catch (err) {
      // The authorize endpoint is reached by the end-user's browser, so a
      // validation failure (bad client_id / redirect_uri / response_type / PKCE)
      // must render a themed error page rather than leak a raw JSON exception.
      // These failures occur before a trusted redirect_uri is established, so a
      // page (not a redirect) is the safe choice.
      const status = err instanceof HttpException ? err.getStatus() : 400;
      res.status(status);
      this.themeRender.render(
        res,
        realm,
        'login',
        'error',
        {
          pageTitle: 'Request error',
          errorTitle: 'We can’t complete this sign-in request',
          errorMessage: this.describeAuthError(err),
        },
        req,
      );
    }
  }

  private async authorizeInternal(
    realm: Realm,
    query: Record<string, string>,
    req: Request,
    res: Response,
  ) {
    // Validate OAuth params (client_id, redirect_uri, etc.) early
    const client = await this.oauthService.validateAuthRequest(
      realm,
      query as unknown as AuthorizeParams,
    );

    // Check for existing SSO session cookie
    const sessionCookie = (req.cookies as Record<string, string>)?.[
      'IDENPLANE_SESSION'
    ];
    if (sessionCookie) {
      const user = await this.loginService.validateLoginSession(
        realm,
        sessionCookie,
      );
      if (user) {
        const prompt = query['prompt'];

        if (prompt === 'none') {
          return this.handlePromptNone(
            res,
            client.redirectUris[0],
            query['state'],
          );
        }

        if (prompt === 'login') {
          return this.handlePromptLogin(res, realm.name, query);
        }

        // Resolve the ACR actually satisfied by the existing SSO session so it
        // can be reflected in any code issued silently below. Falls back to
        // ACR_PASSWORD when there is no step-up record / login session.
        const loginSession = await this.getLoginSessionByToken(sessionCookie);
        const sessionAcr = loginSession
          ? await this.stepUpService.getSessionAcr(loginSession.id)
          : ACR_PASSWORD;

        // ── Step-up ACR check ────────────────────────────────────────────────
        //
        // Determine the highest required ACR from two sources:
        //   1. The `acr_values` query parameter (client request)
        //   2. The client's `requiredAcr` configuration (server-enforced policy)
        const requestedAcr = query['acr_values']
          ? query['acr_values'].split(' ')[0] // take the highest-preference value
          : null;
        const clientRequiredAcr = client.requiredAcr ?? null;

        // Prefer the stronger of the two requirements
        const requiredAcr = this.resolveRequiredAcr(
          requestedAcr,
          clientRequiredAcr,
        );

        if (requiredAcr) {
          if (loginSession) {
            const stepUpNeeded = !this.stepUpService.satisfiesAcr(
              sessionAcr,
              requiredAcr,
            );

            if (stepUpNeeded) {
              // Redirect to step-up challenge, passing the original OAuth params
              // so the flow can resume after the step-up completes.
              const stepUpParams = new URLSearchParams();
              stepUpParams.set('acr', requiredAcr);
              stepUpParams.set('client_id', client.clientId);
              // session_token is intentionally omitted — the step-up challenge
              // endpoint reads the session from the IDENPLANE_SESSION cookie so
              // the token is never exposed in URLs, server logs, or Referer headers.
              // Encode the original OAuth params as a `continue` parameter so
              // the step-up UI can redirect back after success.
              const continueUrl = `/realms/${realm.name}/protocol/openid-connect/auth?${new URLSearchParams(query).toString()}`;
              stepUpParams.set('continue', continueUrl);

              return res.redirect(
                302,
                `/realms/${realm.name}/step-up/challenge?${stepUpParams.toString()}`,
              );
            }
          }
        }
        // ── End step-up check ────────────────────────────────────────────────

        // Derive the satisfied auth context for any code issued via silent SSO.
        // The session ACR is authoritative; the amr is derived from it: an
        // MFA-or-stronger session implies the second factor was performed.
        const ssoAuthContext = {
          acr: sessionAcr,
          amr: this.amrForSessionAcr(sessionAcr),
        };

        // Check if client requires consent
        if (client.requireConsent) {
          const scopes = (query['scope'] ?? 'openid')
            .split(' ')
            .filter(Boolean);
          const hasConsent = await this.consentService.hasConsent(
            user.id,
            client.id,
            scopes,
          );

          if (!hasConsent) {
            const reqId = await this.consentService.storeConsentRequest({
              userId: user.id,
              clientId: client.id,
              clientName: client.name ?? client.clientId,
              realmName: realm.name,
              scopes,
              oauthParams: query,
              satisfiedAcr: ssoAuthContext.acr,
              amr: ssoAuthContext.amr,
            });
            return res.redirect(
              302,
              `/realms/${realm.name}/consent?req=${reqId}`,
            );
          }
        }

        // SSO: user already logged in and consent is granted, issue code
        // directly — carrying the session's satisfied acr/amr.
        const result = await this.oauthService.authorizeWithUser(
          realm,
          user,
          query as unknown as AuthorizeParams,
          ssoAuthContext,
        );
        return res.redirect(302, result.redirectUrl);
      }
    }

    // No valid session: redirect to login page with OAuth params.
    // Only relay params from the explicit allowlist to prevent open-redirect
    // and parameter-injection attacks via arbitrary query string forwarding.
    const OAUTH_PARAM_ALLOWLIST = new Set([
      'client_id',
      'redirect_uri',
      'response_type',
      'scope',
      'state',
      'nonce',
      'code_challenge',
      'code_challenge_method',
      'prompt',
      'acr_values',
      'login_hint',
    ]);
    const loginParams = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value && OAUTH_PARAM_ALLOWLIST.has(key)) loginParams.set(key, value);
    }
    res.redirect(302, `/realms/${realm.name}/login?${loginParams.toString()}`);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private describeAuthError(err: unknown): string {
    if (err instanceof HttpException) {
      const response = err.getResponse();
      if (typeof response === 'string') {
        return response;
      }
      if (response && typeof response === 'object' && 'message' in response) {
        const message = (response as { message: unknown }).message;
        if (typeof message === 'string') {
          return message;
        }
        if (Array.isArray(message)) {
          return message.join(', ');
        }
      }
      return err.message;
    }
    return 'The sign-in request could not be processed. Please try again.';
  }

  /**
   * Given two optional ACR requirements, returns the one with higher
   * assurance strength, or null if neither is set.
   */
  private resolveRequiredAcr(
    requestedAcr: string | null,
    clientAcr: string | null,
  ): string | null {
    if (!requestedAcr && !clientAcr) return null;
    if (!requestedAcr) return clientAcr;
    if (!clientAcr) return requestedAcr;

    // Both are set — return the stronger one
    const reqStrength = this.stepUpService.getAcrStrength(requestedAcr);
    const clientStrength = this.stepUpService.getAcrStrength(clientAcr);
    return reqStrength >= clientStrength ? requestedAcr : clientAcr;
  }

  /**
   * Derive RFC 8176 `amr` values from a session's satisfied ACR. We can only
   * infer methods from the ACR level (we don't track per-method history on the
   * SSO session), so each level maps to its canonical method set:
   *   - WebAuthn  → ['hwk']        (hardware key; matches the passkey login path)
   *   - MFA       → ['pwd', 'otp'] (password + second factor)
   *   - otherwise → ['pwd']        (password only)
   * Must be checked strongest-first so a WebAuthn session (which also satisfies
   * MFA) is not mislabelled as password+otp.
   */
  private amrForSessionAcr(sessionAcr: string): string[] {
    if (this.stepUpService.satisfiesAcr(sessionAcr, ACR_WEBAUTHN)) {
      return ['hwk'];
    }
    if (this.stepUpService.satisfiesAcr(sessionAcr, ACR_MFA)) {
      return ['pwd', 'otp'];
    }
    return ['pwd'];
  }

  private async getLoginSessionByToken(sessionToken: string) {
    const tokenHash = this.crypto.sha256(sessionToken);
    return this.prisma.loginSession.findUnique({ where: { tokenHash } });
  }

  private redirectWithError(
    res: Response,
    redirectUri: string,
    error: string,
    errorDescription: string,
    state?: string,
  ): void {
    const url = new URL(redirectUri);
    url.searchParams.set('error', error);
    url.searchParams.set('error_description', errorDescription);
    if (state) {
      url.searchParams.set('state', state);
    }
    res.redirect(302, url.toString());
  }

  private handlePromptNone(
    res: Response,
    redirectUri: string,
    state?: string,
  ): void {
    this.redirectWithError(
      res,
      redirectUri,
      'login_required',
      'User is not authenticated',
      state,
    );
  }

  private handlePromptLogin(
    res: Response,
    realm: string,
    query: Record<string, string>,
  ): void {
    const loginParams = new URLSearchParams();
    const allowlist = new Set([
      'client_id',
      'redirect_uri',
      'response_type',
      'scope',
      'state',
      'nonce',
      'code_challenge',
      'code_challenge_method',
      'prompt',
      'acr_values',
      'login_hint',
    ]);
    for (const [key, value] of Object.entries(query)) {
      if (value && allowlist.has(key)) loginParams.set(key, value);
    }
    res.redirect(302, `/realms/${realm}/login?${loginParams.toString()}`);
  }
}
