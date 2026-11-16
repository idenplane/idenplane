/**
 * Route handlers that put the access token in an HttpOnly cookie, so that
 * `createAuthMiddleware` (`idenplane-nextjs/middleware`) and
 * `getServerAuth` / `getServerUser` (`idenplane-nextjs/server`) can see the
 * signed-in user on the server.
 *
 * The browser SDK keeps tokens in JavaScript; nothing sends them to your
 * Next.js server on navigation. Mount these handlers on a route, and call
 * `syncSessionCookie(client)` from `idenplane-nextjs` in the browser: it
 * POSTs the access token here after sign-in and after every refresh, and
 * DELETEs the cookie on sign-out.
 *
 * @example
 * ```typescript
 * // app/api/auth/session/route.ts
 * import { createSessionCookieHandlers } from 'idenplane-nextjs/session';
 *
 * export const { POST, DELETE } = createSessionCookieHandlers({
 *   serverUrl: process.env.IDENPLANE_URL!,
 *   realm: 'my-realm',
 *   audience: 'my-app',
 * });
 * ```
 *
 * POST verifies the token (signature, issuer, audience, expiry and
 * `typ: "Bearer"`) before setting the cookie, and refuses cross-site
 * requests, so another site cannot plant its own token in a user's browser
 * (login CSRF). The cookie is `HttpOnly; Secure; SameSite=Lax; Path=/` and
 * expires with the token.
 */

import { extractBearerToken } from 'idenplane-sdk/token';
import { assertSecureServerUrl } from './internal/url-validation.js';
import { assertAudience } from './internal/audience.js';
import { DEFAULT_ACCESS_TOKEN_COOKIE } from './server.js';

export interface SessionCookieConfig {
  /** Idenplane server base URL */
  serverUrl: string;
  /** Realm name */
  realm: string;
  /**
   * The client ID (or IDs) whose access tokens may be stored, checked
   * against the token's `aud`. Required: your app's own client ID.
   */
  audience: string | string[];
  /** Cookie name (default: "idenplane_access_token") */
  cookieName?: string;
  /**
   * Set the `Secure` attribute (default: true). Browsers accept Secure
   * cookies from `http://localhost`, so leave this on in development too.
   */
  secure?: boolean;
  /**
   * Public origins to accept from browsers that do not send
   * `Sec-Fetch-Site`, when the app is reached under an origin other than the
   * one Next.js sees in `request.url` (behind a reverse proxy or TLS
   * terminator). Browsers that send Fetch Metadata need no configuration.
   * Default: the request's own origin only.
   */
  allowedOrigins?: string[];
  /** Allow `serverUrl` to use `http://` for a non-loopback host (default: false). */
  allowInsecureHttp?: boolean;
}

const COOKIE_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const TOKEN_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** Serialise the access-token cookie. Exported for tests and custom handlers. */
export function serializeAccessTokenCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
  secure = true,
): string {
  return [
    `${name}=${value}`,
    'Path=/',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    'HttpOnly',
    ...(secure ? ['Secure'] : []),
    'SameSite=Lax',
  ].join('; ');
}

/**
 * True when the request comes from the app's own pages.
 *
 * Browsers that send Fetch Metadata are judged by `Sec-Fetch-Site` alone: a
 * page cannot set that header, and it stays `same-origin` behind a reverse
 * proxy or TLS terminator, where the origin Next.js sees in `request.url`
 * (an internal host, `http://`) differs from the public one. Older browsers
 * are judged by `Origin`, which must be the request's own origin or one of
 * `allowedOrigins`. A request with neither header is refused.
 */
export function isSameOriginRequest(request: Request, allowedOrigins: readonly string[] = []): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site !== null) return site === 'same-origin';

  const origin = request.headers.get('origin');
  if (origin === null) return false;
  const own = new URL(request.url).origin;
  const allowed = new Set([own, ...allowedOrigins.map((o) => new URL(o).origin)]);
  return allowed.has(origin);
}

/**
 * Create `POST` (store the access token) and `DELETE` (clear it) handlers for
 * an App Router route.
 */
export function createSessionCookieHandlers(config: SessionCookieConfig): {
  POST: (request: Request) => Promise<Response>;
  DELETE: (request: Request) => Promise<Response>;
} {
  assertSecureServerUrl(config.serverUrl, config.allowInsecureHttp);
  assertAudience(config.audience, 'createSessionCookieHandlers');
  const cookieName = config.cookieName ?? DEFAULT_ACCESS_TOKEN_COOKIE;
  if (!COOKIE_NAME_RE.test(cookieName)) {
    throw new TypeError(`Idenplane: invalid cookie name "${cookieName}"`);
  }
  const secure = config.secure ?? true;
  const allowedOrigins = config.allowedOrigins ?? [];
  allowedOrigins.forEach((o) => new URL(o)); // fail at startup on a bad entry

  const noStore = { 'Cache-Control': 'no-store' };
  const clear = () => serializeAccessTokenCookie(cookieName, '', 0, secure);
  const reply = (status: number, body: unknown, setCookie?: string) => {
    const headers = new Headers(noStore);
    if (setCookie) headers.append('Set-Cookie', setCookie);
    if (body === null) return new Response(null, { status, headers });
    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify(body), { status, headers });
  };

  async function POST(request: Request): Promise<Response> {
    if (!isSameOriginRequest(request, allowedOrigins)) {
      return reply(403, { error: 'forbidden', message: 'Cross-site request refused' });
    }
    const token = extractBearerToken(request.headers.get('authorization'));
    if (!token || !TOKEN_RE.test(token)) {
      return reply(401, { error: 'unauthorized', message: 'Missing Bearer token' }, clear());
    }

    const { verifyToken } = await import('idenplane-sdk/server');
    let exp: number | undefined;
    try {
      const payload = await verifyToken(token, {
        issuerUrl: config.serverUrl,
        realm: config.realm,
        audience: config.audience,
      });
      exp = payload.exp;
    } catch {
      return reply(401, { error: 'unauthorized', message: 'Invalid or expired token' }, clear());
    }

    const maxAge = (exp ?? 0) - Math.floor(Date.now() / 1000);
    if (maxAge <= 0) {
      return reply(401, { error: 'unauthorized', message: 'Invalid or expired token' }, clear());
    }
    return reply(204, null, serializeAccessTokenCookie(cookieName, token, maxAge, secure));
  }

  async function DELETE(request: Request): Promise<Response> {
    if (!isSameOriginRequest(request, allowedOrigins)) {
      return reply(403, { error: 'forbidden', message: 'Cross-site request refused' });
    }
    return reply(204, null, clear());
  }

  return { POST, DELETE };
}
