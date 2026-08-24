import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { Realm, User } from '@prisma/client';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import {
  RateLimitGuard,
  RateLimitByIp,
} from '../rate-limit/rate-limit.guard.js';
import { AuthService } from '../auth/auth.service.js';
import { TokensService } from '../tokens/tokens.service.js';
import { resolveClientIp } from '../common/utils/proxy-ip.util.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  ProxyAuthService,
  PROXY_SESSION_COOKIE,
  type ProxyApplicationWithClient,
} from './proxy-auth.service.js';

/**
 * Forward-auth endpoints — the reverse proxy's side of #1314.
 *
 * Excluded from Swagger: these are called by Traefik / nginx / Caddy, not by
 * API consumers, and their contract is the proxy's, not ours.
 *
 * Authentication is NOT reimplemented here. `start` hands the browser to the
 * ordinary OAuth authorize endpoint and `callback` redeems the resulting code
 * through the ordinary token grant, so MFA, step-up, SSO, consent, brute-force
 * protection and risk assessment all apply exactly as they do for any other
 * client — without this module knowing they exist.
 *
 * Rate limiting is applied PER METHOD, not on the class, and `verify` is
 * deliberately left out of it.
 *
 * `verify` is called by the proxy on every single request to the protected
 * application, and the IP the guard sees is the proxy's — with TRUSTED_PROXIES
 * unset, resolveClientIp returns the socket address, which is the same for all
 * of that traffic. ipRateLimitPerMinute defaults to 20, so a class-level
 * @RateLimitByIp() would throttle the entire protected application to 20
 * requests a minute: an outage, not a defence. Loading one dashboard makes more
 * requests than that.
 *
 * The login-flow endpoints are a different shape — a handful of requests per
 * user per session — so they keep the per-IP limit. Volume control for `verify`
 * belongs at the proxy, which is the only layer that still sees real client IPs.
 */
@ApiExcludeController()
@Controller('realms/:realmName/proxy/:slug')
@UseGuards(RealmGuard, RateLimitGuard)
export class ProxyAuthController {
  private readonly logger = new Logger(ProxyAuthController.name);

  constructor(
    private readonly proxyAuth: ProxyAuthService,
    private readonly authService: AuthService,
    private readonly tokensService: TokensService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * The endpoint the proxy calls before every request.
   *
   * 200 — session valid; identity is in the configured headers.
   * 302 — browser navigation with no session; sends the user into login.
   * 401 — everything else with no session (XHR, fetch, API clients), so a
   *       background request gets a status its caller can act on instead of
   *       an HTML login page.
   */
  @Get('verify')
  @Public()
  async verify(
    @CurrentRealm() realm: Realm,
    @Param('slug') slug: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const app = await this.requireApp(realm, slug);

    const token = req.cookies?.[PROXY_SESSION_COOKIE] as string | undefined;
    const user = await this.proxyAuth.validateSession(app, token);

    if (user) {
      const headers = await this.proxyAuth.buildIdentityHeaders(app, user);
      for (const [name, value] of Object.entries(headers)) {
        res.setHeader(name, value);
      }
      res.status(200).end();
      return;
    }

    if (!this.wantsHtml(req)) {
      res.status(401).end();
      return;
    }

    const original = this.proxyAuth.reconstructOriginalUrl(req);
    const startUrl = `/realms/${realm.name}/proxy/${app.slug}/start`;
    res.redirect(
      302,
      original ? `${startUrl}?rd=${encodeURIComponent(original)}` : startUrl,
    );
  }

  /**
   * Begin the handshake: remember where to go back to, then hand off to the
   * normal authorize endpoint.
   */
  @Get('start')
  @Public()
  @RateLimitByIp()
  async start(
    @CurrentRealm() realm: Realm,
    @Param('slug') slug: string,
    @Query('rd') rd: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const app = await this.requireApp(realm, slug);

    // `rd` arrives from a header the proxy set, which a client can forge if the
    // proxy does not strip it. The allowlist is what makes that harmless, so a
    // miss is a hard failure rather than a silent fallback to some default.
    const returnUrl = this.proxyAuth.resolveReturnUrl(
      app,
      rd ?? this.proxyAuth.reconstructOriginalUrl(req),
    );

    if (!returnUrl) {
      throw new BadRequestException(
        "The requested URL is not in this proxy application's allowed redirect URIs",
      );
    }

    const params = new URLSearchParams({
      client_id: app.client.clientId,
      redirect_uri: this.proxyAuth.callbackUrl(realm.name, app.slug),
      response_type: 'code',
      scope: 'openid profile email',
      state: this.proxyAuth.encodeState(app, returnUrl),
    });

    res.redirect(302, `/realms/${realm.name}/oauth/authorize?${params}`);
  }

  /**
   * Finish the handshake: redeem the code, mint the proxy session, and put the
   * browser back where it started.
   */
  @Get('callback')
  @Public()
  @RateLimitByIp()
  async callback(
    @CurrentRealm() realm: Realm,
    @Param('slug') slug: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const app = await this.requireApp(realm, slug);

    // State first: it is the CSRF and open-redirect defence, and checking it
    // before spending the single-use code means a replayed callback cannot
    // burn a legitimate code.
    const returnUrl = this.proxyAuth.decodeState(app, state);
    if (!returnUrl) {
      throw new BadRequestException('Invalid or expired proxy login state');
    }
    if (!code) {
      throw new BadRequestException('Missing authorization code');
    }

    const ip = resolveClientIp(req);
    const userAgent = req.headers['user-agent'];

    // Redeem through the ordinary token grant so the code's single-use,
    // PKCE and expiry handling stay in one place.
    const tokens = await this.authService.handleTokenRequest(
      realm,
      {
        grant_type: 'authorization_code',
        code,
        client_id: app.client.clientId,
        ...(app.client.clientSecret
          ? { client_secret: app.client.clientSecret }
          : {}),
        redirect_uri: this.proxyAuth.callbackUrl(realm.name, app.slug),
      },
      ip,
      userAgent,
    );

    const user = await this.resolveUserFromAccessToken(
      realm,
      tokens.access_token,
    );
    if (!user) {
      throw new BadRequestException('Could not resolve the authenticated user');
    }

    const sessionToken = await this.proxyAuth.createSession(
      app,
      user,
      ip,
      userAgent,
    );

    res.cookie(PROXY_SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      secure: true,
      // Lax, not Strict: the browser arrives here via a cross-site redirect
      // from the proxied application, and Strict would withhold the cookie on
      // that first navigation — producing an endless login loop.
      sameSite: 'lax',
      domain: app.cookieDomain,
      path: '/',
      maxAge: app.cookieTtl * 1000,
    });

    res.redirect(302, returnUrl);
  }

  /**
   * Drop the proxy session. Does not touch the SSO session.
   *
   * Takes no return-URL parameter on purpose: see
   * ProxyAuthService.signOutDestination. Nothing from the request reaches the
   * redirect.
   */
  @Get('sign-out')
  @Public()
  @RateLimitByIp()
  async signOut(
    @CurrentRealm() realm: Realm,
    @Param('slug') slug: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const app = await this.requireApp(realm, slug);

    await this.proxyAuth.revokeSession(
      req.cookies?.[PROXY_SESSION_COOKIE] as string | undefined,
    );

    res.clearCookie(PROXY_SESSION_COOKIE, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      domain: app.cookieDomain,
      path: '/',
    });

    res.redirect(302, this.proxyAuth.signOutDestination(realm, app));
  }

  // ─── helpers ──────────────────────────────────────────────

  private async requireApp(
    realm: Realm,
    slug: string,
  ): Promise<ProxyApplicationWithClient> {
    const app = await this.proxyAuth.findBySlug(realm, slug);
    if (!app || !app.enabled) {
      throw new NotFoundException(`Proxy application '${slug}' not found`);
    }
    return app;
  }

  /**
   * A browser navigation gets a redirect; anything else gets a 401. Keyed on
   * `Accept` because that is the only signal a proxy reliably forwards — an
   * XHR asking for JSON should not be answered with a login page.
   */
  private wantsHtml(req: Request): boolean {
    const accept = req.headers['accept'];
    return typeof accept === 'string' && accept.includes('text/html');
  }

  /**
   * Resolve the freshly issued access token back to its user.
   *
   * Goes through the ordinary introspection path rather than decoding the JWT
   * here: that path already verifies the signature, honours the revocation
   * blacklist, checks the session still exists and rejects disabled users. A
   * local decode would quietly skip all four.
   */
  private async resolveUserFromAccessToken(
    realm: Realm,
    accessToken: string,
  ): Promise<User | null> {
    const introspection = await this.tokensService.introspect(
      realm,
      accessToken,
    );

    const sub =
      introspection.active && typeof introspection.sub === 'string'
        ? introspection.sub
        : null;
    if (!sub) return null;

    return this.prisma.user.findFirst({
      where: { id: sub, realmId: realm.id },
    });
  }
}
