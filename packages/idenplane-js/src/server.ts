/**
 * Server-side utilities for AuthMe token validation.
 *
 * Provides:
 * - `verifyToken` — verify a JWT using JWKS
 * - `createAuthmeMiddleware` — Express middleware
 * - `createAuthmeGuard` — NestJS guard factory
 * - `getServerSideAuth` — Next.js getServerSideProps helper
 * - `createNextMiddleware` — Next.js middleware helper
 *
 * @example
 * ```typescript
 * import { createAuthmeMiddleware } from 'authme-sdk/server';
 *
 * app.use('/api', createAuthmeMiddleware({
 *   issuerUrl: 'http://localhost:3000',
 *   realm: 'my-realm',
 * }));
 * ```
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export interface AuthmeServerConfig {
  /** AuthMe server base URL (e.g., 'http://localhost:3000') */
  issuerUrl: string;
  /** Realm name */
  realm: string;
  /** Optional: required roles to access (realm roles) */
  requiredRoles?: string[];
  /** Optional: custom claim to extract roles from (default: 'realm_access.roles') */
  rolesClaimPath?: string;
}

export interface AuthmeTokenPayload extends JWTPayload {
  preferred_username?: string;
  email?: string;
  name?: string;
  realm_access?: { roles: string[] };
  resource_access?: Record<string, { roles: string[] }>;
}

// Cache JWKS instances per issuer with a TTL to support key rotation
const JWKS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const jwksCache = new Map<string, { jwks: ReturnType<typeof createRemoteJWKSet>; cachedAt: number }>();

function getJWKS(issuerUrl: string, realm: string) {
  const url = `${issuerUrl}/realms/${realm}/protocol/openid-connect/certs`;
  const cached = jwksCache.get(url);
  if (!cached || Date.now() - cached.cachedAt > JWKS_CACHE_TTL_MS) {
    jwksCache.set(url, { jwks: createRemoteJWKSet(new URL(url)), cachedAt: Date.now() });
  }
  return jwksCache.get(url)!.jwks;
}

/**
 * Verify an AuthMe JWT access token and return the decoded payload.
 */
export async function verifyToken(
  token: string,
  config: AuthmeServerConfig,
): Promise<AuthmeTokenPayload> {
  const JWKS = getJWKS(config.issuerUrl, config.realm);
  const issuer = `${config.issuerUrl}/realms/${config.realm}`;

  const { payload } = await jwtVerify(token, JWKS, { issuer });
  return payload as AuthmeTokenPayload;
}

/**
 * Extract the Bearer token from an Authorization header value.
 * Returns null if the header is missing or not a Bearer token.
 */
export function extractBearerToken(authHeader: string | string[] | undefined): string | null {
  const header = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7);
}

/**
 * Check if a token payload has the required realm roles.
 */
export function hasRealmRoles(
  payload: AuthmeTokenPayload,
  requiredRoles: string[],
): boolean {
  const userRoles = payload.realm_access?.roles ?? [];
  return requiredRoles.every((role) => userRoles.includes(role));
}

/**
 * Check if a token payload has the required client roles.
 */
export function hasClientRoles(
  payload: AuthmeTokenPayload,
  clientId: string,
  requiredRoles: string[],
): boolean {
  const userRoles = payload.resource_access?.[clientId]?.roles ?? [];
  return requiredRoles.every((role) => userRoles.includes(role));
}

// ─── Express Middleware ────────────────────────────────────

export interface AuthmeRequest {
  user?: AuthmeTokenPayload;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Create an Express middleware that validates AuthMe JWT access tokens.
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { createAuthmeMiddleware } from 'authme-sdk/server';
 *
 * const app = express();
 * const authme = createAuthmeMiddleware({
 *   issuerUrl: 'http://localhost:3000',
 *   realm: 'my-realm',
 * });
 *
 * app.get('/api/profile', authme, (req, res) => {
 *   res.json(req.user);
 * });
 * ```
 */
export function createAuthmeMiddleware(config: AuthmeServerConfig) {
  return async (
    req: AuthmeRequest,
    res: { status: (code: number) => { json: (body: unknown) => void } },
    next: () => void,
  ) => {
    const authHeader = req.headers['authorization'] ?? req.headers['Authorization'];
    const token = extractBearerToken(authHeader);

    if (!token) {
      return res.status(401).json({ error: 'unauthorized', message: 'Missing Bearer token' });
    }

    try {
      const payload = await verifyToken(token, config);

      if (config.requiredRoles?.length) {
        if (!hasRealmRoles(payload, config.requiredRoles)) {
          return res.status(403).json({ error: 'forbidden', message: 'Insufficient roles' });
        }
      }

      req.user = payload;
      next();
    } catch {
      return res.status(401).json({ error: 'unauthorized', message: 'Invalid or expired token' });
    }
  };
}

// ─── NestJS Guard ─────────────────────────────────────────

/**
 * Lightweight HttpException-compatible error that NestJS exception filters
 * recognize without requiring @nestjs/common as a dependency.
 */
class HttpError extends Error {
  constructor(
    private readonly response: string | object,
    private readonly statusCode: number,
  ) {
    super(typeof response === 'string' ? response : JSON.stringify(response));
  }
  getStatus() {
    return this.statusCode;
  }
  getResponse() {
    return this.response;
  }
}

/**
 * NestJS-compatible guard factory for AuthMe token validation.
 *
 * @example
 * ```typescript
 * import { createAuthmeGuard } from 'authme-sdk/server';
 *
 * const AuthmeGuard = createAuthmeGuard({
 *   issuerUrl: 'http://localhost:3000',
 *   realm: 'my-realm',
 * });
 *
 * @Controller('api')
 * export class AppController {
 *   @Get('profile')
 *   @UseGuards(AuthmeGuard)
 *   getProfile(@Req() req) {
 *     return req.user;
 *   }
 * }
 * ```
 */
export function createAuthmeGuard(config: AuthmeServerConfig) {
  return class AuthmeGuard {
    async canActivate(context: {
      switchToHttp: () => { getRequest: () => AuthmeRequest };
    }): Promise<boolean> {
      const request = context.switchToHttp().getRequest();
      const authHeader = request.headers['authorization'] ?? request.headers['Authorization'];
      const token = extractBearerToken(authHeader);

      if (!token) {
        throw new HttpError({ statusCode: 401, message: 'Missing Bearer token', error: 'Unauthorized' }, 401);
      }

      try {
        const payload = await verifyToken(token, config);

        if (config.requiredRoles?.length) {
          if (!hasRealmRoles(payload, config.requiredRoles)) {
            throw new HttpError({ statusCode: 403, message: 'Insufficient roles', error: 'Forbidden' }, 403);
          }
        }

        request.user = payload;
        return true;
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError({ statusCode: 401, message: 'Invalid or expired token', error: 'Unauthorized' }, 401);
      }
    }
  };
}

/**
 * Helper to extract roles from an AuthMe token payload.
 */
export function getRolesFromToken(
  payload: AuthmeTokenPayload,
  clientId?: string,
): string[] {
  if (clientId) {
    return payload.resource_access?.[clientId]?.roles ?? [];
  }
  return payload.realm_access?.roles ?? [];
}

// ─── Next.js Helpers ──────────────────────────────────────

export interface NextRequest {
  headers: {
    get(name: string): string | null;
    [key: string]: unknown;
  };
  cookies?: {
    get(name: string): { value: string } | undefined;
    [key: string]: unknown;
  };
  url?: string;
  nextUrl?: { pathname: string; [key: string]: unknown };
}

export interface ServerSideAuthResult {
  /** The verified token payload, or null if not authenticated */
  user: AuthmeTokenPayload | null;
  /** The raw access token string, or null if not present/invalid */
  accessToken: string | null;
  /** Whether the user is authenticated */
  isAuthenticated: boolean;
}

/**
 * Helper for Next.js API routes and getServerSideProps.
 * Validates the Bearer token from the request and returns auth info.
 *
 * @example
 * ```typescript
 * // pages/api/profile.ts
 * import { getServerSideAuth } from 'authme-sdk/server';
 *
 * export default async function handler(req, res) {
 *   const { user, isAuthenticated } = await getServerSideAuth(req, {
 *     issuerUrl: 'http://localhost:3000',
 *     realm: 'my-realm',
 *   });
 *
 *   if (!isAuthenticated) {
 *     return res.status(401).json({ error: 'Unauthorized' });
 *   }
 *
 *   res.json({ user });
 * }
 * ```
 *
 * Also works in getServerSideProps:
 * ```typescript
 * export const getServerSideProps = async ({ req }) => {
 *   const { user, isAuthenticated } = await getServerSideAuth(req, config);
 *   if (!isAuthenticated) {
 *     return { redirect: { destination: '/login', permanent: false } };
 *   }
 *   return { props: { user } };
 * };
 * ```
 */
export async function getServerSideAuth(
  req: { headers: Record<string, string | string[] | undefined> },
  config: AuthmeServerConfig,
): Promise<ServerSideAuthResult> {
  const authHeader = req.headers['authorization'] ?? req.headers['Authorization'];
  const token = extractBearerToken(authHeader);

  if (!token) {
    return { user: null, accessToken: null, isAuthenticated: false };
  }

  try {
    const user = await verifyToken(token, config);
    return { user, accessToken: token, isAuthenticated: true };
  } catch {
    return { user: null, accessToken: token, isAuthenticated: false };
  }
}

/**
 * Next.js App Router / Edge middleware helper.
 * Returns the verified user payload from the request, or null.
 *
 * Reads the Bearer token from the Authorization header.
 * Designed for use in Next.js middleware (middleware.ts).
 *
 * @example
 * ```typescript
 * // middleware.ts
 * import { NextResponse } from 'next/server';
 * import { createNextMiddleware } from 'authme-sdk/server';
 *
 * const authMiddleware = createNextMiddleware({
 *   issuerUrl: 'http://localhost:3000',
 *   realm: 'my-realm',
 *   protectedPaths: ['/dashboard', '/api/protected'],
 *   loginPath: '/login',
 * });
 *
 * export default authMiddleware;
 *
 * export const config = {
 *   matcher: ['/((?!_next|public).*)'],
 * };
 * ```
 */
export interface NextMiddlewareConfig extends AuthmeServerConfig {
  /** Path prefixes that require authentication */
  protectedPaths?: string[];
  /** Path to redirect unauthenticated users to */
  loginPath?: string;
  /** Path to redirect users with insufficient roles to */
  forbiddenPath?: string;
}

export function createNextMiddleware(middlewareConfig: NextMiddlewareConfig) {
  return async function authMiddleware(request: NextRequest) {
    const { protectedPaths = [], loginPath = '/login', forbiddenPath } = middlewareConfig;
    const pathname = request.nextUrl?.pathname ?? request.url ?? '/';

    // Only protect specified paths
    const isProtected = protectedPaths.some((path) => pathname.startsWith(path));
    if (!isProtected) return null; // Let Next.js continue

    const authHeader = request.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      // Return redirect info — the caller uses NextResponse.redirect
      return { redirect: loginPath, reason: 'unauthenticated' };
    }

    try {
      const payload = await verifyToken(token, middlewareConfig);

      if (middlewareConfig.requiredRoles?.length) {
        if (!hasRealmRoles(payload, middlewareConfig.requiredRoles)) {
          return {
            redirect: forbiddenPath ?? loginPath,
            reason: 'forbidden',
            user: payload,
          };
        }
      }

      return { user: payload, reason: 'authorized' };
    } catch {
      return { redirect: loginPath, reason: 'invalid_token' };
    }
  };
}
