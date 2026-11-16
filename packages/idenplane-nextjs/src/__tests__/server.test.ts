import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('idenplane-sdk/server', () => ({ verifyToken: vi.fn() }));

const { verifyToken } = await import('idenplane-sdk/server');
const { getServerAuth, getServerUser } = await import('../server.js');

const CONFIG = { serverUrl: 'https://idp.example.com', realm: 'demo', audience: 'demo-app' };
const TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.placeholder-signature';

const now = Math.floor(Date.now() / 1000);
const PAYLOAD = {
  sub: 'user-1',
  typ: 'Bearer',
  exp: now + 3600,
  iat: now,
  iss: 'https://idp.example.com/realms/demo',
  aud: 'demo-app',
  preferred_username: 'alice',
  name: 'Alice Smith',
  email: 'alice@example.com',
  email_verified: true,
  realm_access: { roles: ['admin', 'user'] },
};

function makeCookies(token: string | null, cookieName = 'idenplane_access_token') {
  return {
    get: (name: string) => (name === cookieName && token ? { name, value: token } : undefined),
  };
}

beforeEach(() => {
  vi.mocked(verifyToken).mockReset();
  vi.mocked(verifyToken).mockResolvedValue(PAYLOAD as never);
});

describe('getServerAuth', () => {
  it('returns null when no cookie is set, without verifying anything', async () => {
    expect(await getServerAuth(makeCookies(null), CONFIG)).toBeNull();
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it('verifies the cookie with issuer, realm and audience before returning claims', async () => {
    const result = await getServerAuth(makeCookies(TOKEN), CONFIG);
    expect(verifyToken).toHaveBeenCalledWith(TOKEN, {
      issuerUrl: 'https://idp.example.com',
      realm: 'demo',
      audience: 'demo-app',
    });
    expect(result).toEqual({ accessToken: TOKEN, payload: PAYLOAD, isAuthenticated: true });
  });

  it('returns null when verification fails (forged, expired, ID token, other audience)', async () => {
    vi.mocked(verifyToken).mockRejectedValue(new Error('invalid'));
    expect(await getServerAuth(makeCookies(TOKEN), CONFIG)).toBeNull();
  });

  it('uses a custom cookie name when configured', async () => {
    const cookies = makeCookies(TOKEN, 'my_auth_token');
    expect(await getServerAuth(cookies, CONFIG)).toBeNull();
    expect((await getServerAuth(cookies, { ...CONFIG, cookieName: 'my_auth_token' }))?.payload.sub).toBe(
      'user-1',
    );
  });

  it.each([
    ['missing', { serverUrl: CONFIG.serverUrl, realm: 'demo' }],
    ['empty', { ...CONFIG, audience: '' }],
    ['empty list', { ...CONFIG, audience: [] }],
  ])('throws a configuration error when audience is %s', async (_l, cfg) => {
    await expect(getServerAuth(makeCookies(TOKEN), cfg as never)).rejects.toThrow(/audience/);
  });

  it('throws without a configuration', async () => {
    await expect(getServerAuth(makeCookies(TOKEN), undefined as never)).rejects.toThrow(/audience/);
  });

  it('refuses an insecure non-loopback server URL', async () => {
    await expect(
      getServerAuth(makeCookies(TOKEN), { ...CONFIG, serverUrl: 'http://idp.example.com' }),
    ).rejects.toThrow(/insecure/i);
  });
});

describe('getServerUser', () => {
  it('returns null when not authenticated', async () => {
    expect(await getServerUser(makeCookies(null), CONFIG)).toBeNull();
  });

  it('returns user fields from a verified token', async () => {
    const user = await getServerUser(makeCookies(TOKEN), CONFIG);
    expect(user?.sub).toBe('user-1');
    expect(user?.name).toBe('Alice Smith');
    expect(user?.email).toBe('alice@example.com');
    expect(user?.email_verified).toBe(true);
    expect(user?.realm_access?.roles).toContain('admin');
  });

  it('returns null for a token that fails verification', async () => {
    vi.mocked(verifyToken).mockRejectedValue(new Error('aud mismatch'));
    expect(await getServerUser(makeCookies(TOKEN), CONFIG)).toBeNull();
  });
});
