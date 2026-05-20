import { describe, it, expect, vi } from 'vitest';

// ── We test interceptor logic without Angular HttpClient machinery ─

// Minimal stub types
interface FakeRequest {
  headers: Record<string, string>;
  clone(opts: { setHeaders: Record<string, string> }): FakeRequest;
}

interface FakeHandler {
  handle(req: FakeRequest): { req: FakeRequest };
}

function makeRequest(headers: Record<string, string> = {}): FakeRequest {
  return {
    headers,
    clone(opts) {
      return { ...this, headers: { ...this.headers, ...opts.setHeaders } };
    },
  };
}

function makeHandler(): FakeHandler & { lastReq: FakeRequest | null } {
  let lastReq: FakeRequest | null = null;
  return {
    get lastReq() {
      return lastReq;
    },
    handle(req: FakeRequest) {
      lastReq = req;
      return { req };
    },
  };
}

// ── Interceptor logic (extracted, no Angular DI) ───────────────────

function applyInterceptorLogic(
  getToken: () => string | null,
  req: FakeRequest,
  handler: FakeHandler,
) {
  const token = getToken();
  if (!token) return handler.handle(req);
  const authReq = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  return handler.handle(authReq);
}

// ── Tests ─────────────────────────────────────────────────────────

describe('AuthInterceptor (logic)', () => {
  it('passes request through when no token is available', () => {
    const getToken = vi.fn(() => null);
    const req = makeRequest();
    const handler = makeHandler();

    applyInterceptorLogic(getToken, req, handler);

    expect(handler.lastReq?.headers['Authorization']).toBeUndefined();
  });

  it('attaches Bearer token header when token is available', () => {
    const getToken = vi.fn(() => 'my-access-token');
    const req = makeRequest();
    const handler = makeHandler();

    applyInterceptorLogic(getToken, req, handler);

    expect(handler.lastReq?.headers['Authorization']).toBe('Bearer my-access-token');
  });

  it('does not mutate the original request', () => {
    const getToken = vi.fn(() => 'tok');
    const req = makeRequest();
    const handler = makeHandler();

    applyInterceptorLogic(getToken, req, handler);

    // The original req should not have the header
    expect(req.headers['Authorization']).toBeUndefined();
    // The cloned req passed to handler should have it
    expect(handler.lastReq?.headers['Authorization']).toBe('Bearer tok');
  });
});
