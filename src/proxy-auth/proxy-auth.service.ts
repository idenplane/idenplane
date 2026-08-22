import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import type { ProxyApplication, Realm, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { matchesRedirectUri } from '../common/redirect-uri.utils.js';

/**
 * Cookie carrying the proxy session. Deliberately NOT `IDENPLANE_SESSION`:
 * that cookie is pinned to `path=/realms/<realm>` with `SameSite=Strict` and is
 * read by OAuth, SAML, MFA, step-up, WebAuthn and the account console. A
 * forward-auth cookie has to reach a different host on a shared parent domain,
 * so it needs `Domain=.example.com`, `path=/` and `SameSite=Lax` — widening the
 * SSO cookie to match would loosen every one of those flows at once.
 */
export const PROXY_SESSION_COOKIE = 'IDENPLANE_PROXY_SESSION';

/** How long a `start` handshake may sit unfinished before its state expires. */
const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Opaque, tamper-proof handshake state. Encrypted with AES-256-GCM by
 * CryptoService, so a forged or edited state fails the auth tag rather than
 * being trusted — which is why this needs no table of its own.
 */
interface ProxyAuthState {
  /** ProxyApplication.id the handshake belongs to. */
  a: string;
  /** Already-allowlisted URL to return the browser to. */
  r: string;
  /** Expiry, epoch ms. */
  e: number;
}

export interface ProxyIdentityHeaders {
  [header: string]: string;
}

@Injectable()
export class ProxyAuthService {
  private readonly logger = new Logger(ProxyAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async findBySlug(
    realm: Realm,
    slug: string,
  ): Promise<(ProxyApplication & { client: { clientId: string } }) | null> {
    return this.prisma.proxyApplication.findUnique({
      where: { realmId_slug: { realmId: realm.id, slug } },
      include: { client: { select: { clientId: true } } },
    });
  }

  // ─── Original request reconstruction ──────────────────────

  /**
   * Rebuild the URL the browser actually asked for, from the headers the proxy
   * sets when it calls us.
   *
   * Traefik `forwardAuth` and Caddy `forward_auth` both send
   * `X-Forwarded-Proto` / `X-Forwarded-Host` / `X-Forwarded-Uri`. nginx
   * `auth_request` sends nothing by default, so its documented config sets
   * `X-Original-URL` (absolute) instead.
   *
   * These headers are client-controllable if the proxy fails to strip them,
   * and this deliberately does NOT try to detect that. The value is only ever
   * used as a redirect target, and every redirect target goes through
   * {@link resolveReturnUrl}, which rejects anything outside the application's
   * allowlist. A forged host therefore buys an attacker a 400, not a redirect.
   */
  reconstructOriginalUrl(req: Request): string | null {
    const original = this.header(req, 'x-original-url');
    if (original) return original;

    const proto = this.header(req, 'x-forwarded-proto');
    const host = this.header(req, 'x-forwarded-host');
    if (!proto || !host) return null;

    const uri = this.header(req, 'x-forwarded-uri') ?? '/';
    return `${proto}://${host}${uri.startsWith('/') ? uri : `/${uri}`}`;
  }

  /**
   * Validate a candidate return URL against the application's allowlist.
   * Returns the URL when it is allowed, `null` otherwise.
   *
   * Uses the same matcher as OAuth `redirect_uri` (wildcards included) rather
   * than a second, subtly different implementation — one allowlist rule for
   * the whole product is easier to reason about than two.
   */
  resolveReturnUrl(
    app: ProxyApplication,
    candidate: string | null,
  ): string | null {
    if (!candidate) return null;

    // Reject anything that isn't an absolute http(s) URL before matching, so a
    // pattern ending in `/*` can never be satisfied by `javascript:` or a
    // protocol-relative `//evil.test` value.
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      return null;

    return matchesRedirectUri(candidate, app.allowedRedirectUris)
      ? candidate
      : null;
  }

  /**
   * The callback URL for an application — the value registered on its OAuth
   * client, sent as `redirect_uri` on the authorize hop, and sent again on the
   * token exchange.
   *
   * Built from BASE_URL (the convention already used by auth, broker and
   * admin-auth) rather than from the incoming request. Two reasons, both
   * load-bearing: the token grant compares `redirect_uri` between authorize
   * and exchange, so it has to be byte-identical across two separate requests
   * that may not even carry the same Host; and an admin needs to know the URL
   * up front to register it on the client, which they cannot do if it depends
   * on runtime headers.
   */
  callbackUrl(realmName: string, slug: string): string {
    const configured = process.env['BASE_URL'] ?? 'http://localhost:3000';
    let baseUrl = configured;
    while (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
    return `${baseUrl}/realms/${realmName}/proxy/${slug}/callback`;
  }

  // ─── Handshake state ──────────────────────────────────────

  encodeState(app: ProxyApplication, returnUrl: string): string {
    const state: ProxyAuthState = {
      a: app.id,
      r: returnUrl,
      e: Date.now() + STATE_TTL_MS,
    };
    return this.crypto.encrypt(JSON.stringify(state));
  }

  /**
   * Decode a state produced by {@link encodeState}, rejecting anything that
   * fails the GCM auth tag, has expired, or belongs to a different application.
   * The return URL is re-checked against the allowlist on the way out: the
   * allowlist may have been tightened while the handshake was in flight.
   */
  decodeState(app: ProxyApplication, raw: string | undefined): string | null {
    if (!raw) return null;

    let state: ProxyAuthState;
    try {
      state = JSON.parse(this.crypto.decrypt(raw)) as ProxyAuthState;
    } catch {
      return null;
    }

    if (state.a !== app.id) return null;
    if (typeof state.e !== 'number' || state.e < Date.now()) return null;

    return this.resolveReturnUrl(app, state.r);
  }

  // ─── Session lifecycle ────────────────────────────────────

  /**
   * Issue a proxy session and return the raw cookie value. Only the SHA-256 of
   * the token is persisted, mirroring how LoginSession stores its own.
   */
  async createSession(
    app: ProxyApplication,
    user: User,
    ip?: string,
    userAgent?: string,
  ): Promise<string> {
    const token = this.crypto.generateSecret(32);

    await this.prisma.proxySession.create({
      data: {
        proxyApplicationId: app.id,
        userId: user.id,
        tokenHash: this.crypto.sha256(token),
        ipAddress: ip,
        userAgent,
        expiresAt: new Date(Date.now() + app.cookieTtl * 1000),
      },
    });

    return token;
  }

  /**
   * Resolve a cookie value to its user, or `null` when the session is unknown,
   * expired, belongs to a different application, or the user has since been
   * disabled.
   *
   * The application check is what stops a session minted for one proxied app
   * from authenticating a request to another.
   */
  async validateSession(
    app: ProxyApplication,
    token: string | undefined,
  ): Promise<User | null> {
    if (!token) return null;

    const session = await this.prisma.proxySession.findUnique({
      where: { tokenHash: this.crypto.sha256(token) },
      include: { user: true },
    });

    if (!session) return null;
    if (session.proxyApplicationId !== app.id) return null;
    if (session.expiresAt < new Date()) return null;
    if (!session.user.enabled) return null;

    return session.user;
  }

  async revokeSession(token: string | undefined): Promise<void> {
    if (!token) return;

    await this.prisma.proxySession
      .delete({ where: { tokenHash: this.crypto.sha256(token) } })
      .catch(() => {
        // Already gone or expired — signing out is idempotent.
      });
  }

  /** Drop expired proxy sessions. Called by the sessions cleanup job. */
  async deleteExpiredSessions(): Promise<number> {
    const { count } = await this.prisma.proxySession.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return count;
  }

  // ─── Identity headers ─────────────────────────────────────

  /**
   * Build the headers handed to the upstream application on a successful
   * verify.
   *
   * Every configured header is emitted on every 200, even when the underlying
   * value is empty. Omitting one would let a value the proxy copied from an
   * earlier request — or one the client sent itself, on a misconfigured proxy —
   * survive into the upstream. An explicit empty header overwrites it.
   */
  async buildIdentityHeaders(
    app: ProxyApplication,
    user: User,
  ): Promise<ProxyIdentityHeaders> {
    const groups = await this.prisma.userGroup.findMany({
      where: { userId: user.id },
      select: { group: { select: { name: true } } },
    });

    return {
      [app.userHeader]: this.sanitize(user.username),
      [app.emailHeader]: this.sanitize(user.email ?? ''),
      [app.nameHeader]: this.sanitize(
        [user.firstName, user.lastName].filter(Boolean).join(' ') ||
          user.username,
      ),
      [app.groupsHeader]: this.sanitize(
        groups.map((g) => g.group.name).join(','),
      ),
    };
  }

  /**
   * Strip anything that could break out of a header value.
   *
   * These values originate in user-editable profile fields, so a username
   * containing CR/LF would otherwise let a user inject arbitrary headers into
   * the request the proxy forwards upstream — response splitting, one hop
   * removed. Node rejects some of this at `setHeader`, but a 500 on every
   * request for that user is its own outage, so the value is cleaned here and
   * the request still succeeds.
   */
  private sanitize(value: string): string {
    // Written as an explicit scan rather than a regex so the range being
    // stripped is legible: C0 (which is where CR and LF, the actual injection
    // vector, live), DEL, and C1. Ordinary spaces are legal in a header value
    // and must survive, or every "John Doe" reaches the upstream as "JohnDoe".
    let out = '';
    for (const ch of value) {
      const code = ch.codePointAt(0) ?? 0;
      const isC0OrDel = code < 0x20 || code === 0x7f;
      const isC1 = code >= 0x80 && code <= 0x9f;
      if (isC0OrDel || isC1) continue;
      out += ch;
    }
    return out.trim();
  }

  private header(req: Request, name: string): string | null {
    const raw = req.headers[name];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value && value.length > 0 ? value : null;
  }
}
