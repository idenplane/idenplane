import type { TokenClaims } from './types.js';

/**
 * Decode a base64url string (no padding required) to a UTF-8 string.
 * `atob` follows the WHATWG forgiving-base64 algorithm, which tolerates
 * missing `=` padding, so no manual padding step is needed here.
 */
function base64UrlToUtf8(base64url: string): string {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Parse a JWT token and return the decoded payload.
 * This does NOT verify the signature — that's the server's responsibility.
 *
 * @throws {Error} If `token` is not a well-formed JWT (not three dot-separated parts).
 */
export function parseJwt(token: string): TokenClaims {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }
  return JSON.parse(base64UrlToUtf8(parts[1]));
}

/**
 * Decode a JWT's payload without verifying its signature, returning `null`
 * instead of throwing if `token` is malformed. Prefer {@link parseJwt} when
 * a malformed token should be treated as an error rather than "no claims".
 *
 * SECURITY NOTE: this does not validate the signature, issuer, audience, or
 * any other security-relevant claim. Do not use the returned payload for
 * authorization decisions unless the token was already cryptographically
 * verified (e.g. via `verifyToken` in `idenplane-sdk/server`) by a trusted
 * upstream layer.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(base64UrlToUtf8(parts[1]));
  } catch {
    return null;
  }
}

/**
 * Extract the Bearer token from an Authorization header value.
 * Returns `null` if the header is missing, empty, or not a Bearer token.
 */
export function extractBearerToken(
  authHeader: string | string[] | undefined | null,
): string | null {
  const header = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7);
}

/** Check if a token is expired, with an optional clock skew buffer in seconds. */
export function isTokenExpired(claims: TokenClaims, clockSkew = 0): boolean {
  const now = Math.floor(Date.now() / 1000);
  return claims.exp <= now + clockSkew;
}

/** Get the number of seconds until a token expires. Returns 0 if already expired. */
export function getTokenExpiresIn(claims: TokenClaims): number {
  const now = Math.floor(Date.now() / 1000);
  return Math.max(0, claims.exp - now);
}

/**
 * Minimal claim shape needed to resolve realm/client roles from a decoded
 * token payload. Both `idenplane-js`'s `TokenClaims` and the server-side
 * `IdenplaneTokenPayload` (in `server.ts`) are structurally compatible with
 * this — role resolution only ever needs these two fields.
 */
export interface RoleClaims {
  realm_access?: { roles: string[] };
  resource_access?: Record<string, { roles: string[] }>;
}

/**
 * Get the roles granted by a token payload: client roles for `clientId` if
 * given, otherwise realm roles. Returns an empty array if the payload has
 * no roles for the requested scope.
 */
export function getRolesFromToken(
  claims: RoleClaims | null | undefined,
  clientId?: string,
): string[] {
  if (clientId) {
    return claims?.resource_access?.[clientId]?.roles ?? [];
  }
  return claims?.realm_access?.roles ?? [];
}
