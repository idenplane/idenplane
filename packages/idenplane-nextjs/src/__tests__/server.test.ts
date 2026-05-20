import { describe, it, expect } from 'vitest';
import { getServerAuth, getServerUser } from '../server.js';

// ── Helpers ──────────────────────────────────────────────────────

function buildJwt(payload: Record<string, unknown>): string {
  const encode = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

  const header = encode({ alg: 'RS256', typ: 'JWT' });
  const body = encode(payload);
  return `${header}.${body}.fake-signature`;
}

function makeCookies(token: string | null, cookieName = 'authme_access_token') {
  return {
    get: (name: string) =>
      name === cookieName && token ? { name, value: token } : undefined,
  };
}

const now = Math.floor(Date.now() / 1000);

const VALID_TOKEN = buildJwt({
  sub: 'user-1',
  exp: now + 3600,
  iat: now,
  iss: 'http://localhost:3000/realms/test',
  aud: 'test-app',
  preferred_username: 'alice',
  name: 'Alice Smith',
  email: 'alice@example.com',
  email_verified: true,
  realm_access: { roles: ['admin', 'user'] },
});

const EXPIRED_TOKEN = buildJwt({
  sub: 'user-2',
  exp: now - 3600,
  iat: now - 7200,
  iss: 'http://localhost:3000/realms/test',
  aud: 'test-app',
});

// ── getServerAuth ─────────────────────────────────────────────────

describe('getServerAuth', () => {
  it('returns null when no cookie is set', async () => {
    const cookies = makeCookies(null);
    const result = await getServerAuth(cookies);
    expect(result).toBeNull();
  });

  it('returns null for an expired token', async () => {
    const cookies = makeCookies(EXPIRED_TOKEN);
    const result = await getServerAuth(cookies);
    expect(result).toBeNull();
  });

  it('returns a session for a valid token', async () => {
    const cookies = makeCookies(VALID_TOKEN);
    const result = await getServerAuth(cookies);
    expect(result).not.toBeNull();
    expect(result?.isAuthenticated).toBe(true);
    expect(result?.payload.sub).toBe('user-1');
    expect(result?.payload.preferred_username).toBe('alice');
    expect(result?.accessToken).toBe(VALID_TOKEN);
  });

  it('uses a custom cookie name when configured', async () => {
    const cookies = makeCookies(VALID_TOKEN, 'my_auth_token');
    const result = await getServerAuth(cookies, {
      serverUrl: '',
      realm: '',
      cookieName: 'my_auth_token',
    });
    expect(result?.payload.sub).toBe('user-1');
  });

  it('returns null when cookie exists under a different name', async () => {
    const cookies = makeCookies(VALID_TOKEN, 'other_token');
    const result = await getServerAuth(cookies); // default name
    expect(result).toBeNull();
  });
});

// ── getServerUser ─────────────────────────────────────────────────

describe('getServerUser', () => {
  it('returns null when not authenticated', async () => {
    const cookies = makeCookies(null);
    const user = await getServerUser(cookies);
    expect(user).toBeNull();
  });

  it('returns user fields from a valid token', async () => {
    const cookies = makeCookies(VALID_TOKEN);
    const user = await getServerUser(cookies);
    expect(user).not.toBeNull();
    expect(user?.sub).toBe('user-1');
    expect(user?.name).toBe('Alice Smith');
    expect(user?.email).toBe('alice@example.com');
    expect(user?.email_verified).toBe(true);
    expect(user?.realm_access?.roles).toContain('admin');
  });
});
