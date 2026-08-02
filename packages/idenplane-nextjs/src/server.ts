/**
 * Server Component helpers for Next.js App Router.
 *
 * Use these in React Server Components (or `generateMetadata`, route handlers)
 * to read the current auth session from cookies without a client-side round-trip.
 *
 * @example
 * ```typescript
 * // app/dashboard/page.tsx
 * import { cookies } from 'next/headers';
 * import { getServerAuth, getServerUser } from '@idenplane/nextjs/server';
 * import { redirect } from 'next/navigation';
 *
 * export default async function DashboardPage() {
 *   const cookieStore = cookies();
 *   const user = await getServerUser(cookieStore, {
 *     serverUrl: 'http://localhost:3000',
 *     realm: 'my-realm',
 *   });
 *
 *   if (!user) redirect('/login');
 *   return <div>Hello, {user.name}</div>;
 * }
 * ```
 */

import { decodeJwtPayload as decodeJwtPayloadCore } from 'idenplane-sdk/token';

// ── Shared types ─────────────────────────────────────────────────

export interface ServerAuthConfig {
  /** Idenplane server base URL */
  serverUrl: string;
  /** Realm name */
  realm: string;
  /** Cookie name holding the access token (default: "idenplane_access_token") */
  cookieName?: string;
}

export interface AuthSession {
  /** Raw access token string */
  accessToken: string;
  /** Decoded JWT payload */
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
 * `cookies()` from `next/headers` without a hard import.
 */
export interface ReadonlyRequestCookies {
  get(name: string): { name: string; value: string } | undefined;
}

// ── JWT decode (no verification — use verifyToken from idenplane-sdk/server for full JWKS validation) ──
// Bug #438-3 acknowledged: cookie-based auth in this module performs no
// cryptographic signature verification.  This is a known, documented
// limitation.  The security warnings in getServerAuth() JSDoc are intentional.
// Consumers who need cryptographic assurance MUST call verifyToken() from
// idenplane-sdk/server before trusting any claim from the decoded payload.

/**
 * Decode a JWT payload WITHOUT cryptographic signature verification.
 *
 * SECURITY NOTE: This function decodes the payload segment of a JWT by
 * base64url-decoding it.  It does NOT validate the signature, issuer (`iss`),
 * audience (`aud`), or any other security-relevant claims beyond expiry.
 * The decoded claims must NOT be trusted for authorization decisions.
 *
 * Intended use — convenience reading in Server Components where the token has
 * already been cryptographically verified by a trusted upstream layer (e.g.
 * your API gateway, the Idenplane Edge middleware backed by JWKS verification, or
 * a call to `verifyToken` from `idenplane-sdk/server`).
 *
 * If you are making access-control decisions based on the returned claims,
 * you MUST verify the token first with `verifyToken` from `idenplane-sdk/server`
 * (which performs full JWKS signature verification).
 *
 * Delegates to `idenplane-sdk/token`'s `decodeJwtPayload` (the shared,
 * dependency-free implementation also used by `@idenplane/nextjs/middleware`)
 * rather than maintaining a separate base64url decode here.
 */
function decodeJwtPayload(token: string): TokenPayload | null {
  return decodeJwtPayloadCore(token) as TokenPayload | null;
}

function isExpired(payload: TokenPayload): boolean {
  return Date.now() / 1000 > payload.exp;
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Read and decode the auth session from request cookies (Next.js Server Components).
 *
 * WARNING (#11): This function decodes the JWT locally WITHOUT verifying its
 * cryptographic signature.  It is provided for convenience when reading user
 * identity in Server Components where an upstream layer has already verified
 * the token (e.g. middleware + JWKS).
 *
 * DO NOT use the returned `payload` for authorization decisions (role checks,
 * permission gates, data access) without first verifying the token with
 * `verifyToken` from `idenplane-sdk/server`.  An attacker who can set an
 * arbitrary cookie value could otherwise forge any claims returned here.
 *
 * Returns `AuthSession | null`.  The token is decoded locally (no JWKS call).
 * Call `verifyToken` from `idenplane-sdk/server` if you need cryptographic validation.
 */
export async function getServerAuth(
  cookies: ReadonlyRequestCookies,
  config?: ServerAuthConfig,
): Promise<AuthSession | null> {
  const cookieName = config?.cookieName ?? 'idenplane_access_token';
  const accessToken = cookies.get(cookieName)?.value;

  if (!accessToken) return null;

  const payload = decodeJwtPayload(accessToken);
  if (!payload || isExpired(payload)) return null;

  return { accessToken, payload, isAuthenticated: true };
}

/**
 * Convenience wrapper that returns just the `User` object from the session,
 * or `null` if the user is not authenticated.
 */
export async function getServerUser(
  cookies: ReadonlyRequestCookies,
  config?: ServerAuthConfig,
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
