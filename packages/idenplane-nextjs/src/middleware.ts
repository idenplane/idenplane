/**
 * Next.js middleware factory for Idenplane authentication.
 *
 * Use `createAuthMiddleware` in your `middleware.ts` file to protect routes
 * by checking for a valid auth cookie or Bearer token.
 *
 * @example
 * ```typescript
 * // middleware.ts
 * import { NextResponse } from 'next/server';
 * import { createAuthMiddleware } from '@idenplane/nextjs/middleware';
 *
 * const authMiddleware = createAuthMiddleware({
 *   serverUrl: 'https://auth.example.com',
 *   realm: 'my-realm',
 *   clientId: 'my-app',
 *   protectedPaths: ['/dashboard', '/api/protected'],
 *   loginPath: '/login',
 * });
 *
 * export default function middleware(request: NextRequest) {
 *   return authMiddleware(request, NextResponse);
 * }
 *
 * export const config = {
 *   matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
 * };
 * ```
 */

import { decodeJwtPayload, extractBearerToken } from 'idenplane-sdk/token';
import { assertSecureServerUrl } from './internal/url-validation.js';

export interface AuthMiddlewareConfig {
  /** Idenplane server base URL (e.g. "https://auth.example.com") */
  serverUrl: string;
  /** Realm name */
  realm: string;
  /** OAuth2 client ID */
  clientId: string;
  /** Path prefixes that require authentication (default: []) */
  protectedPaths?: string[];
  /** Path to redirect unauthenticated users to (default: "/login") */
  loginPath?: string;
  /** Cookie name that holds the access token (default: "idenplane_access_token") */
  cookieName?: string;
  /**
   * Allow `serverUrl` to use `http://` for a non-loopback host (default: false).
   * See {@link assertSecureServerUrl}.
   */
  allowInsecureHttp?: boolean;
}

/**
 * Minimal shape of the Next.js NextRequest we depend on.
 * Using a structural type so we don't require `next` at compile time
 * when this module is tested in isolation.
 */
interface IncomingRequest {
  nextUrl: { pathname: string; searchParams: URLSearchParams };
  url: string;
  headers: { get(name: string): string | null };
  cookies: { get(name: string): { value: string } | undefined };
}

/**
 * Minimal shape of NextResponse that we return from the factory.
 * The actual `NextResponse` is injected at call time so this package
 * stays free of a hard `next` dependency at import time.
 */
interface NextResponseStatic {
  redirect(url: URL | string, init?: { status?: number }): Response;
  next(): Response;
}

/**
 * Check whether a token is expired, without cryptographic signature
 * verification.
 *
 * SECURITY NOTE (#10): This only checks the token's expiry claim (`exp`) via
 * `decodeJwtPayload` from `idenplane-sdk/token` (a structural decode — three
 * dot-separated parts, valid base64url encoding, valid JSON). It does NOT
 * verify the signature. A tampered or forged token with a future `exp` will
 * pass this check.
 *
 * This is intentional for Edge Middleware: signature verification requires the
 * JWKS public key and an async network fetch, which adds latency on every
 * request. The authoritative verification MUST be performed server-side via
 * `verifyToken` (JWKS) before acting on any token claims for authorization
 * decisions. Middleware should only be used as a first-pass redirect guard,
 * not as a security boundary by itself.
 *
 * `idenplane-sdk/token` has zero runtime dependencies (no `jose`), so
 * importing it here doesn't add anything to the Edge Middleware bundle.
 */
function isTokenExpiredLocally(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload['exp'] !== 'number') return true;
  return Date.now() / 1000 > payload['exp'];
}

/**
 * Create a Next.js Edge-compatible middleware function that checks for a valid
 * auth cookie or Bearer token on protected paths, redirecting to `loginPath`
 * when the user is not authenticated.
 */
export function createAuthMiddleware(config: AuthMiddlewareConfig) {
  assertSecureServerUrl(config.serverUrl, config.allowInsecureHttp);

  const {
    protectedPaths = [],
    loginPath = '/login',
    cookieName = 'idenplane_access_token',
  } = config;

  return async function authMiddleware(
    request: IncomingRequest,
    NextResponse: NextResponseStatic,
  ): Promise<Response> {
    const pathname = request.nextUrl.pathname;

    // Skip non-protected paths
    const isProtected = protectedPaths.some(
      (path) => pathname === path || pathname.startsWith(path + '/'),
    );
    if (!isProtected) return NextResponse.next();

    // Don't redirect if we're already on the login path
    if (pathname.startsWith(loginPath)) return NextResponse.next();

    // 1. Try Authorization header (Bearer token)
    const bearerToken = extractBearerToken(request.headers.get('authorization'));

    if (bearerToken && !isTokenExpiredLocally(bearerToken)) {
      return NextResponse.next();
    }

    // 2. Try auth cookie
    const cookieToken = request.cookies.get(cookieName)?.value;
    if (cookieToken && !isTokenExpiredLocally(cookieToken)) {
      return NextResponse.next();
    }

    // Not authenticated — redirect to login with the original URL as a `next` param
    const loginUrl = new URL(loginPath, request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  };
}
