import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('idenplane-sdk/server', () => ({ verifyToken: vi.fn() }));

const { verifyToken } = await import('idenplane-sdk/server');
const { createSessionCookieHandlers, isSameOriginRequest, serializeAccessTokenCookie } = await import(
  '../session.js'
);
const { syncSessionCookie } = await import('../session-client.js');

const APP = 'https://app.example.com';
const ENDPOINT = `${APP}/api/auth/session`;
const CONFIG = { serverUrl: 'https://idp.example.com', realm: 'demo', audience: 'demo-app' };
const TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.placeholder-signature';

function request(
  method: string,
  headers: Record<string, string> = { origin: APP, 'sec-fetch-site': 'same-origin' },
  token: string | null = TOKEN,
) {
  return new Request(ENDPOINT, {
    method,
    headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
}

beforeEach(() => {
  vi.mocked(verifyToken).mockReset();
  vi.mocked(verifyToken).mockResolvedValue({
    sub: 'user-1',
    typ: 'Bearer',
    exp: Math.floor(Date.now() / 1000) + 300,
  } as never);
});

describe('createSessionCookieHandlers POST', () => {
  it('verifies the token and sets an HttpOnly, Secure, SameSite=Lax cookie that expires with it', async () => {
    const { POST } = createSessionCookieHandlers(CONFIG);
    const res = await POST(request('POST'));

    expect(res.status).toBe(204);
    expect(verifyToken).toHaveBeenCalledWith(TOKEN, {
      issuerUrl: 'https://idp.example.com',
      realm: 'demo',
      audience: 'demo-app',
    });
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(new RegExp(`^idenplane_access_token=${TOKEN.replace(/\./g, '\\.')}; `));
    expect(cookie).toContain('; Path=/');
    expect(cookie).toContain('; HttpOnly');
    expect(cookie).toContain('; Secure');
    expect(cookie).toContain('; SameSite=Lax');
    const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)?.[1]);
    expect(maxAge).toBeGreaterThan(290);
    expect(maxAge).toBeLessThanOrEqual(300);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('refuses a token that fails verification and clears the cookie', async () => {
    vi.mocked(verifyToken).mockRejectedValue(new Error('unexpected "typ" (ID token)'));
    const res = await createSessionCookieHandlers(CONFIG).POST(request('POST'));
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toMatch(/^idenplane_access_token=; Path=\/; Max-Age=0; HttpOnly/);
  });

  it('refuses a request without a Bearer token', async () => {
    const res = await createSessionCookieHandlers(CONFIG).POST(request('POST', undefined, null));
    expect(res.status).toBe(401);
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it('refuses a malformed token without verifying it', async () => {
    const res = await createSessionCookieHandlers(CONFIG).POST(
      request('POST', undefined, 'not-a-jwt;Domain=evil.example'),
    );
    expect(res.status).toBe(401);
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it.each([
    ['cross-site Fetch Metadata', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }],
    ['same-site Fetch Metadata', { origin: 'https://other.example.com', 'sec-fetch-site': 'same-site' }],
    ['a foreign Origin without Fetch Metadata', { origin: 'https://evil.example' }],
    ['a look-alike Origin', { origin: 'https://app.example.com.evil.example' }],
    ['neither header', {}],
  ])('refuses %s (login CSRF)', async (_l, headers) => {
    const res = await createSessionCookieHandlers(CONFIG).POST(request('POST', headers));
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it('refuses an already expired token', async () => {
    vi.mocked(verifyToken).mockResolvedValue({ sub: 'u', exp: Math.floor(Date.now() / 1000) - 1 } as never);
    expect((await createSessionCookieHandlers(CONFIG).POST(request('POST'))).status).toBe(401);
  });

  it('honours cookieName and secure: false', async () => {
    const res = await createSessionCookieHandlers({ ...CONFIG, cookieName: 'demo_at', secure: false }).POST(
      request('POST'),
    );
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie.startsWith('demo_at=')).toBe(true);
    expect(cookie).not.toContain('Secure');
  });
});

describe('createSessionCookieHandlers DELETE', () => {
  it('clears the cookie for a same-origin request', async () => {
    const res = await createSessionCookieHandlers(CONFIG).DELETE(request('DELETE', undefined, null));
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toBe(
      'idenplane_access_token=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
    );
  });

  it('refuses a cross-site request', async () => {
    const res = await createSessionCookieHandlers(CONFIG).DELETE(
      request('DELETE', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }, null),
    );
    expect(res.status).toBe(403);
  });
});

describe('createSessionCookieHandlers configuration', () => {
  it.each([
    ['missing audience', { serverUrl: CONFIG.serverUrl, realm: 'demo' }, /audience/],
    ['empty audience', { ...CONFIG, audience: '' }, /audience/],
    ['insecure server URL', { ...CONFIG, serverUrl: 'http://idp.example.com' }, /insecure/i],
    ['bad cookie name', { ...CONFIG, cookieName: 'a b' }, /cookie name/],
    ['bad allowed origin', { ...CONFIG, allowedOrigins: ['not a url'] }, /Invalid URL/i],
  ])('throws on %s', (_l, cfg, message) => {
    expect(() => createSessionCookieHandlers(cfg as never)).toThrow(message);
  });
});

describe('isSameOriginRequest', () => {
  const req = (headers: Record<string, string>) => new Request(ENDPOINT, { method: 'POST', headers });

  it('accepts the app origin and configured proxy origins', () => {
    expect(isSameOriginRequest(req({ origin: APP }))).toBe(true);
    expect(isSameOriginRequest(req({ 'sec-fetch-site': 'same-origin' }))).toBe(true);
    expect(
      isSameOriginRequest(req({ origin: 'https://www.example.com', 'sec-fetch-site': 'same-origin' }), [
        'https://www.example.com',
      ]),
    ).toBe(true);
  });

  it('refuses other ports and schemes of the same host', () => {
    expect(isSameOriginRequest(req({ origin: 'https://app.example.com:8443' }))).toBe(false);
    expect(isSameOriginRequest(req({ origin: 'http://app.example.com' }))).toBe(false);
  });
});

describe('serializeAccessTokenCookie', () => {
  it('never produces a negative Max-Age', () => {
    expect(serializeAccessTokenCookie('n', 'v', -5)).toBe('n=v; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
  });
});

// ── Browser side ─────────────────────────────────────────────────

function fakeClient(authenticated = false) {
  const handlers: Record<string, Array<(arg?: unknown) => void>> = {};
  let token: string | null = authenticated ? 'placeholder.access.one' : null;
  return {
    on: vi.fn((event: string, h: (arg?: unknown) => void) => {
      (handlers[event] ??= []).push(h);
      return () => {
        handlers[event] = handlers[event].filter((x) => x !== h);
      };
    }),
    getAccessToken: vi.fn(() => token),
    isAuthenticated: vi.fn(() => token !== null),
    emit(event: string, arg?: unknown) {
      handlers[event]?.forEach((h) => h(arg));
    },
    setToken(t: string | null) {
      token = t;
    },
  };
}

describe('syncSessionCookie', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('POSTs the token on login, refresh and restored sessions, and DELETEs on logout, in order', async () => {
    const calls: Array<{ method: string; auth: string | null }> = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      calls.push({
        method: init.method ?? 'GET',
        auth: new Headers(init.headers).get('authorization'),
      });
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = fakeClient();
    const stop = syncSessionCookie(client as never, { endpoint: '/api/auth/session' });
    expect(fetchMock).not.toHaveBeenCalled();

    client.setToken('placeholder.access.one');
    client.emit('login', {});
    client.setToken('placeholder.access.two');
    client.emit('tokenRefresh', {});
    client.emit('ready', true);
    client.setToken(null);
    client.emit('logout');
    await flush();

    expect(calls).toEqual([
      { method: 'POST', auth: 'Bearer placeholder.access.one' },
      { method: 'POST', auth: 'Bearer placeholder.access.two' },
      { method: 'POST', auth: 'Bearer placeholder.access.two' },
      { method: 'DELETE', auth: null },
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/session');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store' });

    stop();
    client.emit('login', {});
    await flush();
    expect(calls).toHaveLength(4);
    vi.unstubAllGlobals();
  });

  it('stores the token at once when the client is already signed in', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    syncSessionCookie(fakeClient(true) as never);
    await flush();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/session', expect.objectContaining({ method: 'POST' }));
    vi.unstubAllGlobals();
  });

  it('reports failures through onError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    const onError = vi.fn();
    syncSessionCookie(fakeClient(true) as never, { onError });
    await flush();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('401') }));
    vi.unstubAllGlobals();
  });
});
