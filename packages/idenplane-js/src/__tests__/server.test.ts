import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractBearerToken,
  hasRealmRoles,
  hasClientRoles,
  getRolesFromToken,
  getServerSideAuth,
  createNextMiddleware,
  type AuthmeTokenPayload,
  type AuthmeServerConfig,
} from '../server.js';

// ── Mocks ──────────────────────────────────────────────────────

vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => 'mocked-jwks'),
  jwtVerify: vi.fn(),
}));

const { jwtVerify } = await import('jose');

const SERVER_CONFIG: AuthmeServerConfig = {
  issuerUrl: 'http://localhost:3000',
  realm: 'test',
};

function makePayload(overrides: Partial<AuthmeTokenPayload> = {}): AuthmeTokenPayload {
  return {
    sub: 'user-123',
    iss: 'http://localhost:3000/realms/test',
    aud: 'test-client',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    realm_access: { roles: ['user', 'admin'] },
    resource_access: { 'test-client': { roles: ['read', 'write'] } },
    preferred_username: 'testuser',
    email: 'test@example.com',
    ...overrides,
  };
}

// ── extractBearerToken ────────────────────────────────────────

describe('extractBearerToken', () => {
  it('extracts token from a valid Bearer header', () => {
    expect(extractBearerToken('Bearer my-token-123')).toBe('my-token-123');
  });

  it('returns null for missing header', () => {
    expect(extractBearerToken(undefined)).toBeNull();
  });

  it('returns null for non-Bearer header', () => {
    expect(extractBearerToken('Basic dXNlcjpwYXNz')).toBeNull();
  });

  it('handles array headers by using the first value', () => {
    expect(extractBearerToken(['Bearer token-a', 'Bearer token-b'])).toBe('token-a');
  });
});

// ── hasRealmRoles ─────────────────────────────────────────────

describe('hasRealmRoles', () => {
  const payload = makePayload();

  it('returns true when user has all required roles', () => {
    expect(hasRealmRoles(payload, ['user'])).toBe(true);
    expect(hasRealmRoles(payload, ['user', 'admin'])).toBe(true);
  });

  it('returns false when user is missing a required role', () => {
    expect(hasRealmRoles(payload, ['superuser'])).toBe(false);
    expect(hasRealmRoles(payload, ['user', 'superuser'])).toBe(false);
  });

  it('returns true for empty required roles', () => {
    expect(hasRealmRoles(payload, [])).toBe(true);
  });

  it('handles missing realm_access gracefully', () => {
    const noRoles = makePayload({ realm_access: undefined });
    expect(hasRealmRoles(noRoles, ['user'])).toBe(false);
  });
});

// ── hasClientRoles ────────────────────────────────────────────

describe('hasClientRoles', () => {
  const payload = makePayload();

  it('returns true when user has client role', () => {
    expect(hasClientRoles(payload, 'test-client', ['read'])).toBe(true);
  });

  it('returns false when user lacks client role', () => {
    expect(hasClientRoles(payload, 'test-client', ['delete'])).toBe(false);
  });

  it('returns false for unknown client', () => {
    expect(hasClientRoles(payload, 'other-client', ['read'])).toBe(false);
  });
});

// ── getRolesFromToken ─────────────────────────────────────────

describe('getRolesFromToken', () => {
  const payload = makePayload();

  it('returns realm roles when no clientId is provided', () => {
    expect(getRolesFromToken(payload)).toEqual(['user', 'admin']);
  });

  it('returns client roles when clientId is provided', () => {
    expect(getRolesFromToken(payload, 'test-client')).toEqual(['read', 'write']);
  });

  it('returns empty array for unknown client', () => {
    expect(getRolesFromToken(payload, 'unknown-client')).toEqual([]);
  });
});

// ── getServerSideAuth ─────────────────────────────────────────

describe('getServerSideAuth', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns unauthenticated when no Authorization header', async () => {
    const req = { headers: {} };
    const result = await getServerSideAuth(req, SERVER_CONFIG);
    expect(result.isAuthenticated).toBe(false);
    expect(result.user).toBeNull();
    expect(result.accessToken).toBeNull();
  });

  it('returns authenticated when token is valid', async () => {
    const payload = makePayload();
    vi.mocked(jwtVerify).mockResolvedValue({ payload } as any);

    const req = { headers: { authorization: 'Bearer valid-token' } };
    const result = await getServerSideAuth(req, SERVER_CONFIG);

    expect(result.isAuthenticated).toBe(true);
    expect(result.user).toEqual(payload);
    expect(result.accessToken).toBe('valid-token');
  });

  it('returns unauthenticated when token verification fails', async () => {
    vi.mocked(jwtVerify).mockRejectedValue(new Error('Invalid token'));

    const req = { headers: { authorization: 'Bearer invalid-token' } };
    const result = await getServerSideAuth(req, SERVER_CONFIG);

    expect(result.isAuthenticated).toBe(false);
    expect(result.user).toBeNull();
    // accessToken is still set (the raw token string)
    expect(result.accessToken).toBe('invalid-token');
  });

  it('works with uppercase Authorization header', async () => {
    const payload = makePayload();
    vi.mocked(jwtVerify).mockResolvedValue({ payload } as any);

    const req = { headers: { Authorization: 'Bearer valid-token' } };
    const result = await getServerSideAuth(req, SERVER_CONFIG);

    expect(result.isAuthenticated).toBe(true);
  });
});

// ── createNextMiddleware ──────────────────────────────────────

describe('createNextMiddleware', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  function makeNextRequest(path: string, token?: string) {
    return {
      headers: {
        get: (name: string) => {
          if (name === 'authorization' && token) return `Bearer ${token}`;
          return null;
        },
      },
      nextUrl: { pathname: path },
      url: `http://localhost${path}`,
    };
  }

  it('returns null for non-protected paths', async () => {
    const middleware = createNextMiddleware({
      ...SERVER_CONFIG,
      protectedPaths: ['/dashboard'],
    });
    const result = await middleware(makeNextRequest('/public'));
    expect(result).toBeNull();
  });

  it('redirects unauthenticated requests on protected paths', async () => {
    const middleware = createNextMiddleware({
      ...SERVER_CONFIG,
      protectedPaths: ['/dashboard'],
      loginPath: '/login',
    });
    const result = await middleware(makeNextRequest('/dashboard'));
    expect(result).toMatchObject({ redirect: '/login', reason: 'unauthenticated' });
  });

  it('returns authorized result for valid token', async () => {
    const payload = makePayload();
    vi.mocked(jwtVerify).mockResolvedValue({ payload } as any);

    const middleware = createNextMiddleware({
      ...SERVER_CONFIG,
      protectedPaths: ['/dashboard'],
    });
    const result = await middleware(makeNextRequest('/dashboard', 'valid-token'));
    expect(result).toMatchObject({ reason: 'authorized', user: payload });
  });

  it('redirects when token is invalid', async () => {
    vi.mocked(jwtVerify).mockRejectedValue(new Error('Invalid token'));

    const middleware = createNextMiddleware({
      ...SERVER_CONFIG,
      protectedPaths: ['/dashboard'],
      loginPath: '/login',
    });
    const result = await middleware(makeNextRequest('/dashboard', 'bad-token'));
    expect(result).toMatchObject({ redirect: '/login', reason: 'invalid_token' });
  });

  it('returns forbidden when required roles are missing', async () => {
    const payload = makePayload({ realm_access: { roles: ['user'] } });
    vi.mocked(jwtVerify).mockResolvedValue({ payload } as any);

    const middleware = createNextMiddleware({
      ...SERVER_CONFIG,
      protectedPaths: ['/admin'],
      requiredRoles: ['admin'],
      forbiddenPath: '/403',
    });
    const result = await middleware(makeNextRequest('/admin', 'valid-token'));
    expect(result).toMatchObject({ redirect: '/403', reason: 'forbidden' });
  });

  it('allows access when user has required roles', async () => {
    const payload = makePayload({ realm_access: { roles: ['user', 'admin'] } });
    vi.mocked(jwtVerify).mockResolvedValue({ payload } as any);

    const middleware = createNextMiddleware({
      ...SERVER_CONFIG,
      protectedPaths: ['/admin'],
      requiredRoles: ['admin'],
    });
    const result = await middleware(makeNextRequest('/admin', 'valid-token'));
    expect(result).toMatchObject({ reason: 'authorized' });
  });
});
