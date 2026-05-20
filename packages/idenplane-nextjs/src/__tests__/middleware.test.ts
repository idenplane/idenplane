import { describe, it, expect, vi } from 'vitest';
import { createAuthMiddleware } from '../middleware.js';

// ── Helpers ──────────────────────────────────────────────────────

/** Build a minimal JWT with the given `exp` (unix seconds). */
function makeToken(exp: number): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const payload = btoa(JSON.stringify({ sub: 'user-1', exp }))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${header}.${payload}.sig`;
}

const FUTURE_TOKEN = makeToken(Math.floor(Date.now() / 1000) + 3600);
const EXPIRED_TOKEN = makeToken(Math.floor(Date.now() / 1000) - 3600);

function makeRequest(overrides: {
  pathname?: string;
  authHeader?: string | null;
  cookieValue?: string | null;
}) {
  const pathname = overrides.pathname ?? '/dashboard';
  return {
    nextUrl: { pathname, searchParams: new URLSearchParams() },
    url: `http://localhost${pathname}`,
    headers: {
      get: (name: string) =>
        name === 'authorization' ? (overrides.authHeader ?? null) : null,
    },
    cookies: {
      get: (name: string) =>
        overrides.cookieValue && name === 'authme_access_token'
          ? { value: overrides.cookieValue }
          : undefined,
    },
  };
}

function makeNextResponse() {
  const redirectUrls: string[] = [];

  const NextResponse = {
    redirect: vi.fn((url: URL | string) => {
      redirectUrls.push(url.toString());
      return new Response(null, { status: 302, headers: { Location: url.toString() } });
    }),
    next: vi.fn(() => {
      return new Response(null, { status: 200 });
    }),
    get redirectUrls() {
      return redirectUrls;
    },
  };

  return NextResponse;
}

// ── Tests ─────────────────────────────────────────────────────────

describe('createAuthMiddleware', () => {
  const config = {
    serverUrl: 'http://localhost:3000',
    realm: 'test',
    clientId: 'test-app',
    protectedPaths: ['/dashboard', '/api/protected'],
    loginPath: '/login',
  };

  it('passes through non-protected paths without checking tokens', async () => {
    const middleware = createAuthMiddleware(config);
    const req = makeRequest({ pathname: '/about', authHeader: null, cookieValue: null });
    const NR = makeNextResponse();

    await middleware(req as never, NR);

    expect(NR.next).toHaveBeenCalled();
    expect(NR.redirect).not.toHaveBeenCalled();
  });

  it('passes through the login path itself', async () => {
    const middleware = createAuthMiddleware(config);
    const req = makeRequest({ pathname: '/login', authHeader: null, cookieValue: null });
    const NR = makeNextResponse();

    await middleware(req as never, NR);

    expect(NR.next).toHaveBeenCalled();
  });

  it('redirects to login when no token is present on a protected path', async () => {
    const middleware = createAuthMiddleware(config);
    const req = makeRequest({ pathname: '/dashboard', authHeader: null, cookieValue: null });
    const NR = makeNextResponse();

    await middleware(req as never, NR);

    expect(NR.redirect).toHaveBeenCalled();
    const redirectUrl = NR.redirectUrls[0];
    expect(redirectUrl).toContain('/login');
    expect(redirectUrl).toContain('next=%2Fdashboard');
  });

  it('allows a request with a valid Bearer token', async () => {
    const middleware = createAuthMiddleware(config);
    const req = makeRequest({
      pathname: '/dashboard',
      authHeader: `Bearer ${FUTURE_TOKEN}`,
      cookieValue: null,
    });
    const NR = makeNextResponse();

    await middleware(req as never, NR);

    expect(NR.next).toHaveBeenCalled();
    expect(NR.redirect).not.toHaveBeenCalled();
  });

  it('redirects when Bearer token is expired', async () => {
    const middleware = createAuthMiddleware(config);
    const req = makeRequest({
      pathname: '/dashboard',
      authHeader: `Bearer ${EXPIRED_TOKEN}`,
      cookieValue: null,
    });
    const NR = makeNextResponse();

    await middleware(req as never, NR);

    expect(NR.redirect).toHaveBeenCalled();
  });

  it('allows a request with a valid auth cookie', async () => {
    const middleware = createAuthMiddleware(config);
    const req = makeRequest({
      pathname: '/api/protected/data',
      authHeader: null,
      cookieValue: FUTURE_TOKEN,
    });
    const NR = makeNextResponse();

    await middleware(req as never, NR);

    expect(NR.next).toHaveBeenCalled();
  });

  it('redirects when the auth cookie is expired', async () => {
    const middleware = createAuthMiddleware(config);
    const req = makeRequest({
      pathname: '/dashboard',
      authHeader: null,
      cookieValue: EXPIRED_TOKEN,
    });
    const NR = makeNextResponse();

    await middleware(req as never, NR);

    expect(NR.redirect).toHaveBeenCalled();
  });

  it('respects a custom cookie name', async () => {
    const middleware = createAuthMiddleware({ ...config, cookieName: 'my_token' });
    const req = {
      nextUrl: { pathname: '/dashboard', searchParams: new URLSearchParams() },
      url: 'http://localhost/dashboard',
      headers: { get: () => null },
      cookies: {
        get: (name: string) =>
          name === 'my_token' ? { value: FUTURE_TOKEN } : undefined,
      },
    };
    const NR = makeNextResponse();

    await middleware(req as never, NR);

    expect(NR.next).toHaveBeenCalled();
  });
});
