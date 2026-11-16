import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('idenplane-sdk/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('idenplane-sdk/server')>();
  return { ...actual, verifyToken: vi.fn() };
});

const { verifyToken } = await import('idenplane-sdk/server');
const { withAuth, withAuthHandler } = await import('../api.js');

describe('withAuth / withAuthHandler config validation', () => {
  const base = { realm: 'test', audience: 'demo-app' };
  const handler = () => {};
  const appRouterHandler = () => Response.json({});

  it('allows http:// for localhost', () => {
    expect(() => withAuth({ ...base, serverUrl: 'http://localhost:3000' }, handler)).not.toThrow();
    expect(() =>
      withAuthHandler({ ...base, serverUrl: 'http://localhost:3000' }, appRouterHandler),
    ).not.toThrow();
  });

  it('accepts https:// URLs', () => {
    expect(() => withAuth({ ...base, serverUrl: 'https://auth.example.com' }, handler)).not.toThrow();
  });

  it('rejects http:// for a non-loopback host', () => {
    expect(() => withAuth({ ...base, serverUrl: 'http://auth.example.com' }, handler)).toThrow(/insecure/i);
    expect(() =>
      withAuthHandler({ ...base, serverUrl: 'http://auth.example.com' }, appRouterHandler),
    ).toThrow(/insecure/i);
  });

  it('allows http:// for a non-loopback host with allowInsecureHttp: true', () => {
    expect(() =>
      withAuth({ ...base, serverUrl: 'http://auth.example.com', allowInsecureHttp: true }, handler),
    ).not.toThrow();
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['an empty list', []],
  ])('requires audience (%s)', (_l, audience) => {
    const cfg = { realm: 'test', serverUrl: 'https://auth.example.com', audience } as never;
    expect(() => withAuth(cfg, handler)).toThrow(/audience/);
    expect(() => withAuthHandler(cfg, appRouterHandler)).toThrow(/audience/);
  });
});

describe('withAuthHandler token verification', () => {
  const config = { serverUrl: 'https://auth.example.com', realm: 'demo', audience: 'demo-app' };

  beforeEach(() => {
    vi.mocked(verifyToken).mockReset();
  });

  it('passes the audience to verifyToken and calls the handler with the payload', async () => {
    const payload = { sub: 'user-1', typ: 'Bearer', aud: 'demo-app' };
    vi.mocked(verifyToken).mockResolvedValue(payload as never);
    const inner = vi.fn((_req: Request, user: unknown) => Response.json({ user }));
    const route = withAuthHandler(config, inner);

    const res = await route(
      new Request('https://app.example.com/api/me', {
        headers: { authorization: 'Bearer placeholder.access.token' },
      }),
    );
    expect(res.status).toBe(200);
    expect(verifyToken).toHaveBeenCalledWith('placeholder.access.token', {
      issuerUrl: 'https://auth.example.com',
      realm: 'demo',
      audience: 'demo-app',
    });
    expect(inner).toHaveBeenCalledOnce();
  });

  it('answers 401 when verification fails (e.g. an ID token or another audience)', async () => {
    vi.mocked(verifyToken).mockImplementation(async () => {
      throw new Error('unexpected "typ"');
    });
    const inner = vi.fn(() => Response.json({}));
    const res = await withAuthHandler(config, inner)(
      new Request('https://app.example.com/api/me', {
        headers: { authorization: 'Bearer placeholder.id.token' },
      }),
    );
    expect(res.status).toBe(401);
    expect(inner).not.toHaveBeenCalled();
  });
});
