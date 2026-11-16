/**
 * Server Component helpers for Next.js App Router.
 *
 * Read the signed-in user in React Server Components, `generateMetadata` and
 * route handlers from the HttpOnly access-token cookie that the
 * `idenplane-nextjs/session` route handler sets after sign-in. The token is
 * verified (signature against the realm JWKS, issuer, audience, expiry and
 * `typ: "Bearer"`) with `verifyToken` from `idenplane-sdk/server` before any
 * claim is returned.
 *
 * @example
 * ```typescript
 * // app/dashboard/page.tsx
 * import { cookies } from 'next/headers';
 * import { getServerUser } from 'idenplane-nextjs/server';
 * import { redirect } from 'next/navigation';
 *
 * export default async function DashboardPage() {
 *   const user = await getServerUser(await cookies(), {
 *     serverUrl: 'https://auth.example.com',
 *     realm: 'my-realm',
 *     audience: 'my-app',
 *   });
 *
 *   if (!user) redirect('/login');
 *   return <div>Hello, {user.name}</div>;
 * }
 * ```
 */

import { assertSecureServerUrl } from './internal/url-validation.js';
import { assertAudience } from './internal/audience.js';

// ── Shared types ─────────────────────────────────────────────────

/** Default name of the access-token cookie. */
export const DEFAULT_ACCESS_TOKEN_COOKIE = 'idenplane_access_token';

export interface ServerAuthConfig {
  /** Idenplane server base URL */
  serverUrl: string;
  /** Realm name */
  realm: string;
  /**
   * The client ID (or IDs) whose access tokens are accepted, checked against
   * the token's `aud`. Required: usually your app's own client ID.
   */
  audience: string | string[];
  /** Cookie name holding the access token (default: "idenplane_access_token") */
  cookieName?: string;
  /**
   * Allow `serverUrl` to use `http://` for a non-loopback host (default: false).
   */
  allowInsecureHttp?: boolean;
}

export interface AuthSession {
  /** Raw access token string */
  accessToken: string;
  /** Verified JWT payload */
  payload: TokenPayload;
  /** Whether the session is authenticated */
  isAuthenticated: true;
}

export interface User {
  sub: string;
  preferred_username?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  email_verified?: boolean;
  realm_access?: { roles: string[] };
  resource_access?: Record<string, { roles: string[] }>;
  [key: string]: unknown;
}

export interface TokenPayload extends User {
  iss: string;
  aud: string | string[];
  exp: number;
  iat: number;
  azp?: string;
  sid?: string;
  scope?: string;
}

/**
 * Minimal ReadonlyRequestCookies interface — matches the shape returned by
 * `await cookies()` from `next/headers` without a hard import.
 */
export interface ReadonlyRequestCookies {
  get(name: string): { name: string; value: string } | undefined;
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Read and verify the access-token cookie.
 *
 * Returns `null` when there is no cookie or when the token fails
 * verification (bad signature, another realm or audience, expired, or not an
 * access token). Throws a configuration error if `audience` is missing.
 *
 * The JWKS is fetched by `idenplane-sdk/server` (needs `jose`) and cached for
 * ten minutes, so this runs in the Node.js runtime, not Edge middleware.
 */
export async function getServerAuth(
  cookies: ReadonlyRequestCookies,
  config: ServerAuthConfig,
): Promise<AuthSession | null> {
  if (!config) {
    throw new TypeError('Idenplane: getServerAuth requires { serverUrl, realm, audience }');
  }
  assertSecureServerUrl(config.serverUrl, config.allowInsecureHttp);
  assertAudience(config.audience, 'getServerAuth');

  const accessToken = cookies.get(config.cookieName ?? DEFAULT_ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) return null;

  // Deferred so that importing this module doesn't pull `jose` in.
  const { verifyToken } = await import('idenplane-sdk/server');
  try {
    const payload = (await verifyToken(accessToken, {
      issuerUrl: config.serverUrl,
      realm: config.realm,
      audience: config.audience,
    })) as TokenPayload;
    return { accessToken, payload, isAuthenticated: true };
  } catch {
    return null;
  }
}

/**
 * Convenience wrapper that returns just the `User` object from the verified
 * session, or `null` if the user is not authenticated.
 */
export async function getServerUser(
  cookies: ReadonlyRequestCookies,
  config: ServerAuthConfig,
): Promise<User | null> {
  const session = await getServerAuth(cookies, config);
  if (!session) return null;

  const { payload } = session;
  if (!payload.sub) return null;
  return {
    sub: payload.sub,
    preferred_username: payload.preferred_username,
    name: payload.name,
    given_name: payload.given_name,
    family_name: payload.family_name,
    email: payload.email,
    email_verified: payload.email_verified,
    realm_access: payload.realm_access,
    resource_access: payload.resource_access,
  };
}
