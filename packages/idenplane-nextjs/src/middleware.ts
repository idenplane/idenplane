/**
 * Next.js middleware factory for AuthMe authentication.
 *
 * Use `createAuthMiddleware` in your `middleware.ts` file to protect routes
 * by checking for a valid auth cookie or Bearer token.
 *
 * @example
 * ```typescript
 * // middleware.ts
 * import { NextResponse } from 'next/server';
 * import { createAuthMiddleware } from '@authme/nextjs/middleware';
 *
 * const authMiddleware = createAuthMiddleware({
 *   serverUrl: 'http://localhost:3000',
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

export interface AuthMiddlewareConfig {
  /** AuthMe server base URL (e.g. "http://localhost:3000") */
  serverUrl: string;
  /** Realm name */
  realm: string;
  /** OAuth2 client ID */
  clientId: string;
  /** Path prefixes that require authentication (default: []) */
  protectedPaths?: string[];
  /** Path to redirect unauthenticated users to (default: "/login") */
  loginPath?: string;
  /** Cookie name that holds the access token (default: "authme_access_token") */
  cookieName?: string;
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
 * Decode a JWT payload without cryptographic signature verification.
 *
 * SECURITY NOTE (#10): This function only checks the token's expiry claim
 * (`exp`) and validates that the token is structurally well-formed (three
 * dot-separated parts, valid base64url encoding).  It does NOT verify the
 * signature.  A tampered or forged token with a future `exp` will pass this
 * check.
 *
 * This is intentional for Edge Middleware: signature verification requires the
 * JWKS public key and an async network fetch, which adds latency on every
 * request.  The authoritative verification MUST be performed server-side via
 * `verifyToken` (JWKS) before acting on any token claims for authorization
 * decisions.  Middleware should only be used as a first-pass redirect guard,
 * not as a security boundary by itself.
 */
function isTokenExpiredLocally(token: string): boolean {
  try {
    const parts = token.split('.');
    // Structural validation: a well-formed JWT has exactly three parts.
    if (parts.length !== 3) return true;

    const [, payloadB64] = parts;
    // Validate the payload segment contains only valid base64url characters.
    if (!/^[A-Za-z0-9_-]+$/.test(payloadB64)) return true;

    const paddedPayload = payloadB64.padEnd(
      payloadB64.length + (4 - (payloadB64.length % 4)) % 4,
      '=',
    );
    const json = atob(paddedPayload.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json) as { exp?: number };
    if (payload.exp === undefined) return true;
    return Date.now() / 1000 > payload.exp;
  } catch {
    return true;
  }
}

/**
 * Create a Next.js Edge-compatible middleware function that checks for a valid
 * auth cookie or Bearer token on protected paths, redirecting to `loginPath`
 * when the user is not authenticated.
 */
export function createAuthMiddleware(config: AuthMiddlewareConfig) {
  const {
    protectedPaths = [],
    loginPath = '/login',
    cookieName = 'authme_access_token',
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
    const authHeader = request.headers.get('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;

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
