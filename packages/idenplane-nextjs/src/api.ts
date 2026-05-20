/**
 * API route helpers for Next.js (both Pages Router and App Router).
 *
 * @example
 * ```typescript
 * // pages/api/profile.ts  (Pages Router)
 * import { withAuth } from '@authme/nextjs/api';
 *
 * export default withAuth(
 *   { serverUrl: 'http://localhost:3000', realm: 'my-realm' },
 *   (req, res) => {
 *     res.json({ user: req.authUser });
 *   },
 * );
 * ```
 *
 * @example
 * ```typescript
 * // app/api/profile/route.ts  (App Router)
 * import { withAuthHandler } from '@authme/nextjs/api';
 *
 * export const GET = withAuthHandler(
 *   { serverUrl: 'http://localhost:3000', realm: 'my-realm' },
 *   (req, user) => Response.json({ user }),
 * );
 * ```
 */

import type { TokenPayload } from './server.js';

// ── Shared types ─────────────────────────────────────────────────

export interface ApiAuthConfig {
  /** AuthMe server base URL */
  serverUrl: string;
  /** Realm name */
  realm: string;
  /** Required realm roles (user must have ALL of them) */
  requiredRoles?: string[];
}

// ── Pages Router ─────────────────────────────────────────────────

export interface AuthenticatedNextApiRequest {
  headers: Record<string, string | string[] | undefined>;
  method?: string;
  body?: unknown;
  query?: Record<string, string | string[]>;
  /** The verified token payload — set by `withAuth` */
  authUser: TokenPayload;
}

export interface NextApiResponse {
  status(code: number): NextApiResponse;
  json(body: unknown): void;
  end(): void;
}

export type AuthenticatedHandler = (
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse,
) => void | Promise<void>;

export type NextApiHandler = (
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse,
) => void | Promise<void>;

/**
 * Verify a Bearer token via authme-sdk/server (JWKS).
 */
async function verifyBearerToken(
  token: string,
  config: ApiAuthConfig,
): Promise<TokenPayload> {
  const { verifyToken } = await import('authme-sdk/server');
  return verifyToken(token, {
    issuerUrl: config.serverUrl,
    realm: config.realm,
  }) as Promise<TokenPayload>;
}

function extractBearer(headers: Record<string, string | string[] | undefined>): string | null {
  const raw = headers['authorization'] ?? headers['Authorization'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7);
}

/**
 * Wrap a Next.js Pages Router API handler with AuthMe token validation.
 * Responds with 401 if no token or invalid, 403 if roles are insufficient.
 */
export function withAuth(
  config: ApiAuthConfig,
  handler: AuthenticatedHandler,
): NextApiHandler {
  return async (req, res) => {
    const token = extractBearer(req.headers);

    if (!token) {
      return res.status(401).json({ error: 'unauthorized', message: 'Missing Bearer token' });
    }

    let payload: TokenPayload;
    try {
      payload = await verifyBearerToken(token, config);
    } catch {
      return res.status(401).json({ error: 'unauthorized', message: 'Invalid or expired token' });
    }

    if (config.requiredRoles?.length) {
      const userRoles = payload.realm_access?.roles ?? [];
      const hasAll = config.requiredRoles.every((r) => userRoles.includes(r));
      if (!hasAll) {
        return res.status(403).json({ error: 'forbidden', message: 'Insufficient roles' });
      }
    }

    req.authUser = payload;
    return handler(req, res);
  };
}

// ── App Router (Route Handlers) ───────────────────────────────────

export type AppRouterHandler = (
  req: Request,
  user: TokenPayload,
) => Response | Promise<Response>;

/**
 * Wrap a Next.js App Router Route Handler with AuthMe token validation.
 * Returns a standard `Response` with 401/403 on failure.
 */
export function withAuthHandler(
  config: ApiAuthConfig,
  handler: AppRouterHandler,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return Response.json(
        { error: 'unauthorized', message: 'Missing Bearer token' },
        { status: 401 },
      );
    }

    let payload: TokenPayload;
    try {
      payload = await verifyBearerToken(token, config);
    } catch {
      return Response.json(
        { error: 'unauthorized', message: 'Invalid or expired token' },
        { status: 401 },
      );
    }

    if (config.requiredRoles?.length) {
      const userRoles = payload.realm_access?.roles ?? [];
      const hasAll = config.requiredRoles.every((r) => userRoles.includes(r));
      if (!hasAll) {
        return Response.json(
          { error: 'forbidden', message: 'Insufficient roles' },
          { status: 403 },
        );
      }
    }

    return handler(req, payload);
  };
}
