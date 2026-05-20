import type { TokenClaims } from './types.js';

/**
 * Parse a JWT token and return the decoded payload.
 * This does NOT verify the signature — that's the server's responsibility.
 */
export function parseJwt(token: string): TokenClaims {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }
  const payload = parts[1];
  const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
  const json = decodeURIComponent(
    atob(padded)
      .split('')
      .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
      .join(''),
  );
  return JSON.parse(json);
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
