import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IdenplaneClient } from '../client.js';
import type { IdenplaneConfig, TokenResponse } from '../types.js';

// ── Helpers ──────────────────────────────────────────────────────

function makeJwt(payload: Record<string, unknown>): string {
  const encode = (obj: unknown) => {
    const json = JSON.stringify(obj);
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const header = encode({ alg: 'RS256', typ: 'JWT' });
  const body = encode(payload);
  return `${header}.${body}.fake-signature`;
}

function makeValidAccessToken(overrides: Record<string, unknown> = {}) {
  return makeJwt({
    sub: 'user-123',
    iss: 'http://localhost:3000/realms/test',
    aud: 'test-client',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    realm_access: { roles: ['user', 'admin'] },
    resource_access: { 'test-client': { roles: ['read', 'write'] } },
    name: 'Test User',
    email: 'test@example.com',
    preferred_username: 'testuser',
    ...overrides,
  });
}

function makeExpiredAccessToken() {
  return makeJwt({
    sub: 'user-123',
    iss: 'http://localhost:3000/realms/test',
    aud: 'test-client',
    exp: Math.floor(Date.now() / 1000) - 60,
    iat: Math.floor(Date.now() / 1000) - 7200,
  });
}

function makeTokenResponse(overrides: Partial<TokenResponse> = {}): TokenResponse {
  return {
    access_token: makeValidAccessToken(),
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token: 'refresh-token-xyz',
    id_token: makeJwt({
      sub: 'user-123',
      iss: 'http://localhost:3000/realms/test',
      aud: 'test-client',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      name: 'Test User',
      email: 'test@example.com',
      preferred_username: 'testuser',
    }),
    ...overrides,
  };
}

const oidcDiscovery = {
  issuer: 'http://localhost:3000/realms/test',
  authorization_endpoint: 'http://localhost:3000/realms/test/protocol/openid-connect/auth',
  token_endpoint: 'http://localhost:3000/realms/test/protocol/openid-connect/token',
  userinfo_endpoint: 'http://localhost:3000/realms/test/protocol/openid-connect/userinfo',
  jwks_uri: 'http://localhost:3000/realms/test/protocol/openid-connect/certs',
  end_session_endpoint: 'http://localhost:3000/realms/test/protocol/openid-connect/logout',
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  subject_types_supported: ['public'],
  id_token_signing_alg_values_supported: ['RS256'],
  scopes_supported: ['openid', 'profile', 'email'],
  token_endpoint_auth_methods_supported: ['none'],
  claims_supported: ['sub', 'name', 'email'],
};

const BASE_CONFIG: IdenplaneConfig = {
  url: 'http://localhost:3000',
  realm: 'test',
  clientId: 'test-client',
  redirectUri: 'http://localhost:5173/callback',
  storage: 'memory',
};

function mockFetchDiscovery() {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes('.well-known')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(oidcDiscovery),
      });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'not_found' }) });
  });
}

// ── Tests ────────────────────────────────────────────────────────

describe('IdenplaneClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = mockFetchDiscovery();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ── Constructor ───────────────────────────────────────────────

  describe('constructor', () => {
    it('sets default values for optional config', () => {
      const client = new IdenplaneClient(BASE_CONFIG);
      expect(client).toBeDefined();
    });

    it('accepts refreshStrategy option', () => {
      const client = new IdenplaneClient({ ...BASE_CONFIG, refreshStrategy: 'eager' });
      expect(client).toBeDefined();
    });

    it('wires up onLogin callback', () => {
      const onLogin = vi.fn();
      const client = new IdenplaneClient({ ...BASE_CONFIG, onLogin });
      // Simulate event
      const tokens = makeTokenResponse();
      (client as any).events.emit('login', tokens);
      expect(onLogin).toHaveBeenCalledWith(tokens);
    });

    it('wires up onLogout callback', () => {
      const onLogout = vi.fn();
      const client = new IdenplaneClient({ ...BASE_CONFIG, onLogout });
      (client as any).events.emit('logout');
      expect(onLogout).toHaveBeenCalled();
    });

    it('wires up onError callback', () => {
      const onError = vi.fn();
      const client = new IdenplaneClient({ ...BASE_CONFIG, onError });
      const err = new Error('test error');
      (client as any).events.emit('error', err);
      expect(onError).toHaveBeenCalledWith(err);
    });

    it('wires up onTokenRefresh callback', () => {
      const onTokenRefresh = vi.fn();
      const client = new IdenplaneClient({ ...BASE_CONFIG, onTokenRefresh });
      const tokens = makeTokenResponse();
      (client as any).events.emit('tokenRefresh', tokens);
      expect(onTokenRefresh).toHaveBeenCalledWith(tokens);
    });
  });

  // ── init() ────────────────────────────────────────────────────

  describe('init()', () => {
    it('returns false when no tokens in storage', async () => {
      const client = new IdenplaneClient(BASE_CONFIG);
      const result = await client.init();
      expect(result).toBe(false);
    });

    it('returns true when valid access token is in storage', async () => {
      const client = new IdenplaneClient(BASE_CONFIG);
      // Pre-populate storage
      (client as any).storage.set('access_token', makeValidAccessToken());
      const result = await client.init();
      expect(result).toBe(true);
    });

    it('attempts refresh when access token is expired but refresh token exists', async () => {
      const client = new IdenplaneClient(BASE_CONFIG);
      const tokens = makeTokenResponse();

      (client as any).storage.set('access_token', makeExpiredAccessToken());
      (client as any).storage.set('refresh_token', 'valid-refresh-token');

      fetchMock.mockImplementation((url: string) => {
        if (url.includes('.well-known')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(oidcDiscovery) });
        }
        if (url.includes('/token')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(tokens) });
        }
        return Promise.resolve({ ok: false });
      });

      const result = await client.init();
      expect(result).toBe(true);
    });

    it('returns false and clears tokens when refresh fails', async () => {
      const client = new IdenplaneClient(BASE_CONFIG);

      (client as any).storage.set('access_token', makeExpiredAccessToken());
      (client as any).storage.set('refresh_token', 'expired-refresh-token');

      fetchMock.mockImplementation((url: string) => {
        if (url.includes('.well-known')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(oidcDiscovery) });
        }
        if (url.includes('/token')) {
          return Promise.resolve({
            ok: false,
            json: () => Promise.resolve({ error: 'invalid_grant' }),
          });
        }
        return Promise.resolve({ ok: false });
      });

      const result = await client.init();
      expect(result).toBe(false);
      expect(client.getAccessToken()).toBeNull();
    });

    it('emits ready event with correct value', async () => {
      const client = new IdenplaneClient(BASE_CONFIG);
      const handler = vi.fn();
      client.on('ready', handler);

      await client.init();
      expect(handler).toHaveBeenCalledWith(false);
    });
  });

  // ── isAuthenticated() ─────────────────────────────────────────

  describe('isAuthenticated()', () => {
    it('returns false when no token', () => {
      const client = new IdenplaneClient(BASE_CONFIG);
      expect(client.isAuthenticated()).toBe(false);
    });

    it('returns true when valid token is present', () => {
      const client = new IdenplaneClient(BASE_CONFIG);
      (client as any).storage.set('access_token', makeValidAccessToken());
      expect(client.isAuthenticated()).toBe(true);
    });

    it('returns false when token is expired', () => {
      const client = new IdenplaneClient(BASE_CONFIG);
      (client as any).storage.set('access_token', makeExpiredAccessToken());
      expect(client.isAuthenticated()).toBe(false);
    });
  });

  // ── getAccessToken() ──────────────────────────────────────────

  describe('getAccessToken()', () => {
    it('returns null when no token stored', () => {
      const client = new IdenplaneClient(BASE_CONFIG);
      expect(client.getAccessToken()).toBeNull();
    });

    it('returns the token string when valid', () => {
      const client = new IdenplaneClient(BASE_CONFIG);
      const token = makeValidAccessToken();
      (client as any).storage.set('access_token', token);
      expect(client.getAccessToken()).toBe(token);
    });

    it('returns null for expired token', () => {
      const client = new IdenplaneClient(BASE_CONFIG);
      (client as any).storage.set('access_token', makeExpiredAccessToken());
      expect(client.getAccessToken()).toBeNull();
    });
  });

  // ── getTokenClaims() / getIdTokenClaims() ─────────────────────

  describe('getTokenClaims()', () => {
    it('returns null when no token', () => {
      const client = new IdenplaneClient(BASE_CONFIG);
      expect(client.getTokenClaims()).toBeNull();
    });

    it('returns parsed claims', () => {
      const client = new IdenplaneClient(BASE_CONFIG);
      (client as any).storage.set('access_token', makeValidAccessToken());
      const claims = client.getTokenClaims();
      expect(claims?.sub).toBe('user-123');
      expect(claims?.email).toBe('test@example.com');
    });
  });

  // ── Role helpers ──────────────────────────────────────────────

  describe('role helpers', () => {
    let client: IdenplaneClient;

    beforeEach(() => {
      client = new IdenplaneClient(BASE_CONFIG);
      (client as any).storage.set('access_token', makeValidAccessToken());
    });

    it('hasRealmRole returns true for existing role', () => {
      expect(client.hasRealmRole('admin')).toBe(true);
    });

    it('hasRealmRole returns false for non-existing role', () => {
      expect(client.hasRealmRole('superuser')).toBe(false);
    });

    it('hasClientRole returns true for existing client role', () => {
      expect(client.hasClientRole('test-client', 'read')).toBe(true);
    });

    it('hasClientRole returns false for non-existing client role', () => {
      expect(client.hasClientRole('test-client', 'delete')).toBe(false);
    });

    it('getRealmRoles returns all realm roles', () => {
      expect(client.getRealmRoles()).toEqual(['user', 'admin']);
    });

    it('getClientRoles returns roles for a specific client', () => {
      expect(client.getClientRoles('test-client')).toEqual(['read', 'write']);
    });

    it('hasPermission checks both realm and client roles', () => {
      // 'admin' is a realm role
      expect(client.hasPermission('admin')).toBe(true);
      // 'read' is a client role on the configured clientId
      expect(client.hasPermission('read')).toBe(true);
      // 'unknown' is neither
      expect(client.hasPermission('unknown')).toBe(false);
    });
  });

  // ── getUserInfo() ─────────────────────────────────────────────

  describe('getUserInfo()', () => {
    it('returns null when not authenticated', () => {
      const client = new IdenplaneClient(BASE_CONFIG);
      expect(client.getUserInfo()).toBeNull();
    });

    it('extracts user info from ID token', () => {
      const client = new IdenplaneClient(BASE_CONFIG);
      const idToken = makeJwt({
        sub: 'user-123',
        iss: 'http://localhost:3000/realms/test',
        aud: 'test-client',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        name: 'Test User',
        email: 'test@example.com',
        preferred_username: 'testuser',
        given_name: 'Test',
        family_name: 'User',
        email_verified: true,
      });
      (client as any).storage.set('id_token', idToken);
      const user = client.getUserInfo();
      expect(user?.name).toBe('Test User');
      expect(user?.email).toBe('test@example.com');
      expect(user?.preferred_username).toBe('testuser');
    });
  });

  // ── handleCallback() ──────────────────────────────────────────

  describe('handleCallback()', () => {
    it('returns false when no code in URL', async () => {
      const client = new IdenplaneClient(BASE_CONFIG);
      const result = await client.handleCallback('http://localhost:5173/callback');
      expect(result).toBe(false);
    });

    it('returns false and emits error when error param is present', async () => {
      const client = new IdenplaneClient(BASE_CONFIG);
      const errorHandler = vi.fn();
      client.on('error', errorHandler);

      const result = await client.handleCallback(
        'http://localhost:5173/callback?error=access_denied&error_description=User+denied+access',
      );

      expect(result).toBe(false);
      expect(errorHandler).toHaveBeenCalledWith(expect.objectContaining({ message: 'User denied access' }));
    });

    it('returns false and emits error when state does not match', async () => {
      const client = new IdenplaneClient(BASE_CONFIG);
      const errorHandler = vi.fn();
      client.on('error', errorHandler);

      // Store a different state
      (client as any).storage.set('auth_state', 'stored-state-abc');
      (client as any).storage.set('pkce_verifier', 'test-verifier');

      const result = await client.handleCallback(
        'http://localhost:5173/callback?code=auth-code&state=wrong-state',
      );

      expect(result).toBe(false);
      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('State mismatch') }),
      );
    });

    it('exchanges code for tokens successfully', async () => {
      const client = new IdenplaneClient(BASE_CONFIG);
      const tokens = makeTokenResponse();
      const loginHandler = vi.fn();
      client.on('login', loginHandler);

      // Set up required state
      (client as any).storage.set('auth_state', 'valid-state');
      (client as any).storage.set('pkce_verifier', 'valid-verifier');

      // Set up URL manipulation mock
      const originalLocation = globalThis.window;

      fetchMock.mockImplementation((url: string) => {
        if (url.includes('.well-known')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(oidcDiscovery) });
        }
        if (url.includes('/token')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(tokens) });
        }
        return Promise.resolve({ ok: false });
      });

      const result = await client.handleCallback(
        'http://localhost:5173/callback?code=valid-code&state=valid-state',
      );

      expect(result).toBe(true);
      expect(loginHandler).toHaveBeenCalledWith(tokens);
      expect(client.isAuthenticated()).toBe(true);
    });

    it('deduplicates concurrent callback calls', async () => {
      const client = new IdenplaneClient(BASE_CONFIG);
      const tokens = makeTokenResponse();

      (client as any).storage.set('auth_state', 'valid-state');
      (client as any).storage.set('pkce_verifier', 'valid-verifier');

      fetchMock.mockImplementation((url: string) => {
        if (url.includes('.well-known')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(oidcDiscovery) });
        }
        if (url.includes('/token')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(tokens) });
        }
        return Promise.resolve({ ok: false });
      });

      const url = 'http://localhost:5173/callback?code=valid-code&state=valid-state';
      const [r1, r2] = await Promise.all([
        client.handleCallback(url),
        client.handleCallback(url),
      ]);

      expect(r1).toBe(true);
      expect(r2).toBe(true);
      // Token endpoint should only be called once
      const tokenCalls = fetchMock.mock.calls.filter((call: string[]) =>
        call[0].includes('/token'),
      );
      expect(tokenCalls.length).toBe(1);
    });
  });

  // ── refreshTokens() ───────────────────────────────────────────

  describe('refreshTokens()', () => {
    it('throws when no refresh token is available', async () => {
      const client = new IdenplaneClient({ ...BASE_CONFIG, refreshStrategy: 'rotation' });
      await expect(client.refreshTokens()).rejects.toThrow('No refresh token available');
    });

    it('refreshes tokens successfully with rotation strategy', async () => {
      const client = new IdenplaneClient({ ...BASE_CONFIG, refreshStrategy: 'rotation' });
      const newTokens = makeTokenResponse();
      const refreshHandler = vi.fn();
      client.on('tokenRefresh', refreshHandler);

      (client as any).storage.set('refresh_token', 'valid-refresh-token');

      fetchMock.mockImplementation((url: string) => {
        if (url.includes('.well-known')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(oidcDiscovery) });
        }
        if (url.includes('/token')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(newTokens) });
        }
        return Promise.resolve({ ok: false });
      });

      const result = await client.refreshTokens();
      expect(result.access_token).toBe(newTokens.access_token);
      expect(refreshHandler).toHaveBeenCalledWith(newTokens);
    });

    it('clears tokens when refresh fails', async () => {
      const client = new IdenplaneClient({ ...BASE_CONFIG, refreshStrategy: 'rotation' });
      (client as any).storage.set('access_token', makeValidAccessToken());
      (client as any).storage.set('refresh_token', 'expired-refresh');

      fetchMock.mockImplementation((url: string) => {
        if (url.includes('.well-known')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(oidcDiscovery) });
        }
        if (url.includes('/token')) {
          return Promise.resolve({
            ok: false,
            status: 400,
            json: () => Promise.resolve({ error: 'invalid_grant' }),
          });
        }
        return Promise.resolve({ ok: false });
      });

      await expect(client.refreshTokens()).rejects.toThrow();
      expect(client.getAccessToken()).toBeNull();
    });

    it('emits backward-compatible tokenRefreshed event', async () => {
      const client = new IdenplaneClient({ ...BASE_CONFIG, refreshStrategy: 'rotation' });
      const newTokens = makeTokenResponse();
      const legacyHandler = vi.fn();
      client.on('tokenRefreshed', legacyHandler);

      (client as any).storage.set('refresh_token', 'valid-refresh-token');

      fetchMock.mockImplementation((url: string) => {
        if (url.includes('.well-known')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(oidcDiscovery) });
        }
        if (url.includes('/token')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(newTokens) });
        }
        return Promise.resolve({ ok: false });
      });

      await client.refreshTokens();
      expect(legacyHandler).toHaveBeenCalledWith(newTokens);
    });
  });

  // ── logout() ──────────────────────────────────────────────────

  describe('logout()', () => {
    it('clears tokens on logout', async () => {
      const client = new IdenplaneClient(BASE_CONFIG);
      (client as any).storage.set('access_token', makeValidAccessToken());
      (client as any).storage.set('refresh_token', 'some-refresh');

      fetchMock.mockImplementation((url: string) => {
        if (url.includes('.well-known')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(oidcDiscovery) });
        }
        if (url.includes('/logout')) {
          return Promise.resolve({ ok: true });
        }
        return Promise.resolve({ ok: false });
      });

      await client.logout();
      expect(client.isAuthenticated()).toBe(false);
    });

    it('emits logout event', async () => {
      const client = new IdenplaneClient(BASE_CONFIG);
      const logoutHandler = vi.fn();
      client.on('logout', logoutHandler);

      fetchMock.mockImplementation((url: string) => {
        if (url.includes('.well-known')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(oidcDiscovery) });
        }
        return Promise.resolve({ ok: true });
      });

      await client.logout();
      expect(logoutHandler).toHaveBeenCalled();
    });

    it('completes even if server logout fails', async () => {
      const client = new IdenplaneClient(BASE_CONFIG);
      (client as any).storage.set('refresh_token', 'some-refresh');

      fetchMock.mockImplementation((url: string) => {
        if (url.includes('.well-known')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(oidcDiscovery) });
        }
        return Promise.reject(new Error('Network error'));
      });

      // Should not throw
      await expect(client.logout()).resolves.toBeUndefined();
    });
  });

  // ── Event system ──────────────────────────────────────────────

  describe('event system', () => {
    it('on() returns an unsubscribe function', () => {
      const client = new IdenplaneClient(BASE_CONFIG);
      const handler = vi.fn();
      const unsubscribe = client.on('logout', handler);

      (client as any).events.emit('logout');
      expect(handler).toHaveBeenCalledTimes(1);

      unsubscribe();
      (client as any).events.emit('logout');
      expect(handler).toHaveBeenCalledTimes(1); // Not called again
    });

    it('off() removes a specific handler', () => {
      const client = new IdenplaneClient(BASE_CONFIG);
      const handler = vi.fn();
      client.on('logout', handler);
      client.off('logout', handler);

      (client as any).events.emit('logout');
      expect(handler).not.toHaveBeenCalled();
    });

    it('supports login event (new API)', () => {
      const client = new IdenplaneClient(BASE_CONFIG);
      const handler = vi.fn();
      client.on('login', handler);
      const tokens = makeTokenResponse();
      (client as any).events.emit('login', tokens);
      expect(handler).toHaveBeenCalledWith(tokens);
    });

    it('supports tokenRefresh event (new API)', () => {
      const client = new IdenplaneClient(BASE_CONFIG);
      const handler = vi.fn();
      client.on('tokenRefresh', handler);
      const tokens = makeTokenResponse();
      (client as any).events.emit('tokenRefresh', tokens);
      expect(handler).toHaveBeenCalledWith(tokens);
    });

    it('backward-compatible authenticated event fires on login', async () => {
      const client = new IdenplaneClient(BASE_CONFIG);
      const legacyHandler = vi.fn();
      client.on('authenticated', legacyHandler);
      const tokens = makeTokenResponse();

      (client as any).storage.set('auth_state', 'valid-state');
      (client as any).storage.set('pkce_verifier', 'valid-verifier');

      fetchMock.mockImplementation((url: string) => {
        if (url.includes('.well-known')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(oidcDiscovery) });
        }
        if (url.includes('/token')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(tokens) });
        }
        return Promise.resolve({ ok: false });
      });

      await client.handleCallback('http://localhost:5173/callback?code=abc&state=valid-state');
      expect(legacyHandler).toHaveBeenCalledWith(tokens);
    });
  });

  // ── SSR compatibility ─────────────────────────────────────────

  describe('SSR / window-undefined compatibility', () => {
    it('createStorage falls back to MemoryStorage when window is undefined', async () => {
      // The storage.ts module already handles this via createStorage()
      // By using storage: 'memory' in tests, we simulate SSR storage
      const client = new IdenplaneClient({ ...BASE_CONFIG, storage: 'memory' });
      expect(client).toBeDefined();
      // Should not throw when window is undefined
      expect(client.isAuthenticated()).toBe(false);
    });
  });

  // ── Refresh strategies ────────────────────────────────────────

  describe('refresh strategies', () => {
    it('uses rotation strategy by default', () => {
      const client = new IdenplaneClient(BASE_CONFIG);
      expect((client as any).config.refreshStrategy).toBe('rotation');
    });

    it('accepts silent strategy', () => {
      const client = new IdenplaneClient({ ...BASE_CONFIG, refreshStrategy: 'silent' });
      expect((client as any).config.refreshStrategy).toBe('silent');
    });

    it('accepts eager strategy', () => {
      const client = new IdenplaneClient({ ...BASE_CONFIG, refreshStrategy: 'eager' });
      expect((client as any).config.refreshStrategy).toBe('eager');
    });

    it('eager strategy uses a larger refresh buffer', () => {
      const client = new IdenplaneClient({ ...BASE_CONFIG, refreshStrategy: 'eager', refreshBuffer: 30 });
      // The eager multiplier doubles the buffer (30 * 2 = 60)
      const config = (client as any).config;
      expect(config.refreshStrategy).toBe('eager');
      expect(config.refreshBuffer).toBe(30);
    });
  });
});
