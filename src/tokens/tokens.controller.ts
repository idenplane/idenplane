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
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { resolveClientIp } from '../common/utils/proxy-ip.util.js';
import { RateLimitGuard, RateLimitBy } from '../rate-limit/rate-limit.guard.js';

@ApiTags('Tokens')
@Controller('realms/:realmName/protocol/openid-connect')
@SkipThrottle()
@UseGuards(RealmGuard, RateLimitGuard)
@RateLimitBy('ip', 'client')
@Public()
export class TokensController {
  constructor(
    private readonly tokensService: TokensService,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
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
    const callerClientId = await this.authenticateClient(
      realm,
      body.client_id,
      body.client_secret,
      req,
    );
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
    const callerClientId = await this.authenticateClient(
      realm,
      body.client_id,
      body.client_secret,
      req,
    );
    await this.tokensService.assertTokenBelongsToClient(
      realm,
      body.token,
      callerClientId,
      body.token_type_hint,
    );
    return this.tokensService.revoke(realm, body.token, body.token_type_hint);
  }

  /**
   * Authenticate the calling client via client_id/client_secret in the body
   * or via HTTP Basic Authentication (RFC 6749 §2.3.1).
   * Public clients are allowed with only client_id (no secret required).
   *
   * Returns the resolved clientId so callers can enforce token-ownership checks.
   */
  private async authenticateClient(
    realm: Realm,
    clientId?: string,
    clientSecret?: string,
    req?: Request,
  ): Promise<string> {
    let cId = clientId;
    let cSecret = clientSecret;

    // Fall back to HTTP Basic Authentication
    if (!cId && req) {
      const authHeader = req.headers['authorization'];
      if (authHeader?.startsWith('Basic ')) {
        try {
          const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
          const colonIdx = decoded.indexOf(':');
          if (colonIdx > 0) {
            cId = decodeURIComponent(decoded.slice(0, colonIdx));
            cSecret = decodeURIComponent(decoded.slice(colonIdx + 1));
          }
        } catch {
          // Malformed Basic auth - ignore
        }
      }
    }

    if (!cId) {
      throw new UnauthorizedException({
        error: 'invalid_client',
        error_description:
          'Client authentication is required. Provide client_id/client_secret or use HTTP Basic.',
      });
    }

    const client = await this.prisma.client.findUnique({
      where: { realmId_clientId: { realmId: realm.id, clientId: cId } },
    });

    if (!client || !client.enabled) {
      throw new UnauthorizedException({
        error: 'invalid_client',
        error_description: 'Invalid client_id or client is disabled.',
      });
    }

    // Confidential clients must provide a valid secret
    if (client.clientType === 'CONFIDENTIAL') {
      if (!cSecret) {
        throw new UnauthorizedException({
          error: 'invalid_client',
          error_description:
            'client_secret is required for confidential clients.',
        });
      }
      if (!client.clientSecret) {
        throw new UnauthorizedException({
          error: 'invalid_client',
          error_description: 'Client has no secret configured.',
        });
      }
      const valid = await this.crypto.verifyPassword(
        client.clientSecret,
        cSecret,
      );
      if (!valid) {
        throw new UnauthorizedException({
          error: 'invalid_client',
          error_description: 'Invalid client credentials.',
        });
      }
    }

    return cId;
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
      'IDENPLANE_SESSION'
    ];
    if (ssoToken) {
      await this.tokensService.invalidateLoginSession(ssoToken);
    }
    res.clearCookie('IDENPLANE_SESSION', {
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
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        error: 'invalid_token',
        error_description: 'Missing Bearer token',
      });
    }
    const token = authHeader.slice(7);
    return this.tokensService.userinfo(realm, token);
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
