import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { Realm } from '@prisma/client';
import { TokensService } from './tokens.service.js';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import {
  ClientAuthenticator,
  ClientAuthError,
  type ClientAuthFailure,
} from '../client-auth/client-authenticator.js';
import { ClientCertificateSource } from '../mtls/client-certificate.source.js';
import { resolveClientIp } from '../common/utils/proxy-ip.util.js';
import { SESSION_COOKIE } from '../authn-core/cookies.js';
import { RateLimitGuard, RateLimitBy } from '../rate-limit/rate-limit.guard.js';

/**
 * The `error_description` introspection and revocation have always sent for
 * each client authentication failure; the token endpoint words them
 * differently. Failures not listed keep the authenticator's wording.
 */
const CLIENT_AUTH_DESCRIPTIONS: Partial<Record<ClientAuthFailure, string>> = {
  missing_client_id:
    'Client authentication is required. Provide client_id/client_secret or use HTTP Basic.',
  unknown_client: 'Invalid client_id or client is disabled.',
  missing_secret: 'client_secret is required for confidential clients.',
  no_secret_configured: 'Client has no secret configured.',
  invalid_secret: 'Invalid client credentials.',
};

/**
 * The access token of a UserInfo request: `Authorization: Bearer` (any case,
 * RFC 7235) or the form parameter, but not both (RFC 6750 §2).
 */
function bearerToken(req: Request, formToken: string | undefined): string {
  const header = req.headers['authorization'];
  const fromHeader =
    header && /^bearer /i.test(header) ? header.slice(7).trim() : undefined;
  if (fromHeader && formToken) {
    throw new BadRequestException({
      error: 'invalid_request',
      error_description: 'Send the access token in one place only',
    });
  }
  const token = fromHeader || formToken;
  if (!token) {
    throw new UnauthorizedException({
      error: 'invalid_token',
      error_description: 'Missing Bearer token',
    });
  }
  return token;
}

@ApiTags('Tokens')
@Controller('realms/:realmName/protocol/openid-connect')
@SkipThrottle()
@UseGuards(RealmGuard, RateLimitGuard)
@RateLimitBy('ip', 'client')
@Public()
export class TokensController {
  constructor(
    private readonly tokensService: TokensService,
    private readonly clientAuthenticator: ClientAuthenticator,
    private readonly clientCertificates: ClientCertificateSource,
  ) {}

  @Post('token/introspect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Token introspection (RFC 7662)' })
  @ApiResponse({
    status: 200,
    description: 'Token introspection result (active true/false)',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request — missing token parameter',
  })
  @ApiResponse({
    status: 401,
    description: 'invalid_client — client authentication failed',
  })
  async introspect(
    @CurrentRealm() realm: Realm,
    @Body() body: { token: string; client_id?: string; client_secret?: string },
    @Req() req: Request,
  ) {
    const callerClientId = await this.authenticateClient(realm, body, req);
    const result = await this.tokensService.introspect(realm, body.token);

    // If the token is active, verify it was issued to the calling client.
    // The azp (authorized party) claim is the canonical audience for OIDC
    // tokens; fall back to aud when azp is absent (plain OAuth2 access tokens).
    if (result.active) {
      const tokenAzp = (result as Record<string, unknown>)['azp'] as
        string | undefined;
      const tokenAud = (result as Record<string, unknown>)['aud'];
      const audiences: string[] = tokenAzp
        ? [tokenAzp]
        : Array.isArray(tokenAud)
          ? (tokenAud as string[])
          : tokenAud
            ? [tokenAud as string]
            : [];

      if (audiences.length > 0 && !audiences.includes(callerClientId)) {
        // Token does not belong to this client — return inactive to prevent
        // one public client from probing tokens issued to another client.
        return { active: false };
      }
    }

    return result;
  }

  @Post('revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Token revocation (RFC 7009)' })
  @ApiResponse({
    status: 200,
    description: 'Token successfully revoked (or was already invalid)',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request — missing token parameter',
  })
  @ApiResponse({
    status: 401,
    description: 'invalid_client — client authentication failed',
  })
  async revoke(
    @CurrentRealm() realm: Realm,
    @Body()
    body: {
      token: string;
      token_type_hint?: string;
      client_id?: string;
      client_secret?: string;
    },
    @Req() req: Request,
  ) {
    if (
      !body.token ||
      typeof body.token !== 'string' ||
      body.token.trim() === ''
    ) {
      throw new BadRequestException('token is required');
    }
    const callerClientId = await this.authenticateClient(realm, body, req);
    await this.tokensService.assertTokenBelongsToClient(
      realm,
      body.token,
      callerClientId,
      body.token_type_hint,
    );
    return this.tokensService.revoke(realm, body.token, body.token_type_hint);
  }

  /**
   * Authenticates the calling client (RFC 7662 §2.1, RFC 7009 §2.1) through
   * the ClientAuthenticator the token endpoint uses: `client_secret_basic`,
   * `client_secret_post`, or `none` for a public client, which sends only its
   * client_id. Failures keep the wording these endpoints always used.
   *
   * Returns the resolved clientId so callers can enforce token-ownership checks.
   */
  private async authenticateClient(
    realm: Realm,
    body: Record<string, unknown>,
    req: Request,
  ): Promise<string> {
    try {
      const { clientId } = await this.clientAuthenticator.authenticate({
        realm,
        body,
        authorization: req.headers['authorization'],
        clientCert: this.clientCertificates.fromRequest(req),
      });
      return clientId;
    } catch (err) {
      if (err instanceof ClientAuthError && err.code === 'invalid_client') {
        throw new UnauthorizedException({
          error: 'invalid_client',
          error_description:
            CLIENT_AUTH_DESCRIPTIONS[err.reason] ?? err.description,
        });
      }
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'End session / logout (POST)' })
  @ApiResponse({ status: 204, description: 'Session ended successfully' })
  @ApiResponse({
    status: 400,
    description: 'invalid_grant — refresh token not found or already revoked',
  })
  logout(
    @CurrentRealm() realm: Realm,
    @Body() body: { refresh_token?: string } = {},
    @Req() req: Request,
  ) {
    return this.tokensService.logout(
      realm,
      resolveClientIp(req),
      body?.refresh_token,
    );
  }

  @Get('logout')
  @ApiOperation({ summary: 'RP-Initiated Logout (GET, OIDC spec)' })
  @ApiResponse({
    status: 204,
    description: 'Session ended; no post_logout_redirect_uri provided',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirect to post_logout_redirect_uri after session teardown',
  })
  @ApiResponse({
    status: 400,
    description: 'post_logout_redirect_uri does not match any registered URI',
  })
  async logoutGet(
    @CurrentRealm() realm: Realm,
    @Query('id_token_hint') idTokenHint: string | undefined,
    @Query('post_logout_redirect_uri')
    postLogoutRedirectUri: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (postLogoutRedirectUri) {
      // Validate post_logout_redirect_uri against the client's registered URIs
      // *before* any teardown so the endpoint can't be abused as an open
      // redirector. This endpoint is reached by top-level browser navigation,
      // so on failure send the user to the login page (signed out) with the
      // reason rather than dumping a raw JSON error to the browser.
      try {
        await this.tokensService.validatePostLogoutRedirectUri(
          realm,
          postLogoutRedirectUri,
          idTokenHint,
        );
      } catch (err) {
        await this.tokensService
          .logoutByIdToken(realm, resolveClientIp(req), idTokenHint)
          .catch(() => undefined);
        await this.clearBrowserSsoSession(realm, req, res);
        const message =
          err instanceof BadRequestException
            ? this.extractErrorMessage(err)
            : 'Invalid logout request';
        return res.redirect(
          `/realms/${realm.name}/login?error=${encodeURIComponent(message)}`,
        );
      }
    }

    await this.tokensService.logoutByIdToken(
      realm,
      resolveClientIp(req),
      idTokenHint,
    );
    await this.clearBrowserSsoSession(realm, req, res);

    if (postLogoutRedirectUri) {
      const redirectUrl = new URL(postLogoutRedirectUri);
      if (state) {
        redirectUrl.searchParams.set('state', state);
      }
      res.redirect(redirectUrl.toString());
    } else {
      res.status(HttpStatus.NO_CONTENT).send();
    }
  }

  /**
   * Invalidate the browser SSO (login) session and clear the IDENPLANE_SESSION
   * cookie (matching the path it was set with) so RP-initiated logout actually
   * ends the IdP session — otherwise /authorize silently re-authenticates from
   * the surviving cookie on the next sign-in.
   */
  private async clearBrowserSsoSession(
    realm: Realm,
    req: Request,
    res: Response,
  ): Promise<void> {
    const ssoToken = (req.cookies as Record<string, string> | undefined)?.[
      SESSION_COOKIE
    ];
    if (ssoToken) {
      await this.tokensService.invalidateLoginSession(ssoToken);
    }
    res.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: `/realms/${realm.name}`,
    });
  }

  private extractErrorMessage(err: BadRequestException): string {
    const resp = err.getResponse();
    if (typeof resp === 'string') return resp;
    const m = (resp as { message?: string | string[] }).message;
    if (Array.isArray(m)) return m.join(', ');
    return m ?? 'Invalid logout request';
  }

  @Get('userinfo')
  @ApiOperation({ summary: 'Get user info from access token' })
  @ApiResponse({
    status: 200,
    description: 'User claims from the access token',
  })
  @ApiResponse({
    status: 401,
    description: 'invalid_token — missing or invalid Bearer token',
  })
  userinfo(@CurrentRealm() realm: Realm, @Req() req: Request) {
    return this.tokensService.userinfo(realm, bearerToken(req, undefined));
  }

  /**
   * OIDC Core §5.3.1: the UserInfo endpoint MUST support POST too. The token
   * comes in the Authorization header or, RFC 6750 §2.2, as a form
   * `access_token` parameter (never both).
   */
  @Post('userinfo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get user info from access token (POST)' })
  @ApiResponse({
    status: 200,
    description: 'User claims from the access token',
  })
  @ApiResponse({
    status: 401,
    description: 'invalid_token — missing or invalid Bearer token',
  })
  userinfoPost(
    @CurrentRealm() realm: Realm,
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
  ) {
    const formToken =
      typeof body?.['access_token'] === 'string'
        ? body['access_token']
        : undefined;
    return this.tokensService.userinfo(realm, bearerToken(req, formToken));
  }

  @Post('logout/backchannel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Backchannel logout (RFC 7009bis)' })
  @ApiResponse({
    status: 200,
    description: 'Logout token processed successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid logout token' })
  @ApiResponse({ status: 401, description: 'No signing key available' })
  async backchannelLogout(
    @CurrentRealm() realm: Realm,
    @Body() body: { logout_token: string },
  ) {
    if (!body.logout_token || typeof body.logout_token !== 'string') {
      throw new BadRequestException('logout_token is required');
    }
    await this.tokensService.handleBackchannelLogout(realm, body.logout_token);
    return { status: 'ok' };
  }
}
