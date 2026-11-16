import '@angular/compiler'; // JIT compiler for the partially compiled @angular/common services
import { describe, it, expect, vi } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { HttpErrorResponse, HttpRequest, HttpResponse } from '@angular/common/http';
import type { HttpEvent, HttpHandler } from '@angular/common/http';
import { firstValueFrom, of, throwError, type Observable } from 'rxjs';
import { AuthInterceptor, authInterceptor } from '../auth.interceptor.js';
import { AuthService } from '../auth.service.js';
import {
  normalizeOrigin,
  resolveBearerTokenOrigins,
  shouldAttachToken,
} from '../bearer-origins.js';

const IDP = 'https://idp.example.com';
const API = 'https://api.example.com';
const APP_PAGE = 'https://app.example.com/dashboard';

// ── shouldAttachToken / resolveBearerTokenOrigins ─────────────────

describe('origin matching', () => {
  const allowed = resolveBearerTokenOrigins({ url: `${IDP}/`, bearerTokenOrigins: [API] });

  it.each([
    [`${IDP}/realms/demo/protocol/openid-connect/userinfo`],
    [`${API}/v1/orders`],
    [`${API}`],
    [`${API}:443/v1/orders`], // explicit default port is the same origin
    ['HTTPS://API.EXAMPLE.COM/v1/orders'], // scheme and host are case-insensitive
    [`${API}/v1/orders?q=1#frag`],
  ])('attaches to %s', (url) => {
    expect(shouldAttachToken(url, allowed, APP_PAGE)).toBe(true);
  });

  it.each([
    ['https://api.example.com.evil.com/steal', 'suffix look-alike host'],
    ['https://evilapi.example.com/x', 'prefix look-alike host'],
    ['https://api.example.co/x', 'truncated host'],
    ['https://api.example.com@evil.com/x', 'allowed origin as userinfo'],
    ['https://evil.com/https://api.example.com/x', 'allowed origin in the path'],
    ['https://evil.com/?next=https://api.example.com', 'allowed origin in the query'],
    ['http://api.example.com/x', 'http instead of https'],
    ['https://api.example.com:8443/x', 'different port'],
    ['https://sub.api.example.com/x', 'subdomain'],
    ['//evil.com/x', 'protocol-relative URL to another host'],
    ['https://third-party.example.net/x', 'unrelated host'],
    ['data:text/plain,hello', 'data: URL'],
    ['blob:https://api.example.com/0f0e', 'blob: URL'],
    ['ws://api.example.com/socket', 'other scheme'],
    ['/api/orders', 'relative URL while the app origin is not listed'],
  ])('does not attach to %s (%s)', (url) => {
    expect(shouldAttachToken(url, allowed, APP_PAGE)).toBe(false);
  });

  it('attaches to relative URLs only when the app origin is listed', () => {
    const withApp = resolveBearerTokenOrigins({
      url: IDP,
      bearerTokenOrigins: ['https://app.example.com'],
    });
    expect(shouldAttachToken('/api/orders', withApp, APP_PAGE)).toBe(true);
    expect(shouldAttachToken('api/orders', withApp, APP_PAGE)).toBe(true);
    expect(shouldAttachToken('//evil.com/api', withApp, APP_PAGE)).toBe(false);
  });

  it('never attaches to a relative URL without a page to resolve it against (SSR)', () => {
    const withApp = resolveBearerTokenOrigins({ url: IDP, bearerTokenOrigins: ['https://app.example.com'] });
    expect(shouldAttachToken('/api/orders', withApp, undefined)).toBe(false);
  });

  it('defaults to the Idenplane server origin only', () => {
    const only = resolveBearerTokenOrigins({ url: `${IDP}/some/path` });
    expect([...only]).toEqual([IDP]);
    expect(shouldAttachToken(`${API}/x`, only, APP_PAGE)).toBe(false);
    expect(shouldAttachToken(`${IDP}/realms/demo`, only, APP_PAGE)).toBe(true);
  });

  it('keeps a non-default port of the Idenplane URL', () => {
    const local = resolveBearerTokenOrigins({ url: 'http://localhost:3000' });
    expect(shouldAttachToken('http://localhost:3000/realms/x', local, APP_PAGE)).toBe(true);
    expect(shouldAttachToken('http://localhost:4200/api', local, APP_PAGE)).toBe(false);
    expect(shouldAttachToken('http://localhost/realms/x', local, APP_PAGE)).toBe(false);
  });
});

describe('normalizeOrigin', () => {
  it.each([
    ['https://api.example.com', 'https://api.example.com'],
    ['https://api.example.com/', 'https://api.example.com'],
    ['https://API.Example.com:443', 'https://api.example.com'],
    ['http://localhost:8080', 'http://localhost:8080'],
  ])('normalises %s', (input, expected) => {
    expect(normalizeOrigin(input)).toBe(expected);
  });

  it.each([
    ['https://*.example.com'],
    ['*'],
    ['api.example.com'],
    ['https://api.example.com/v1'],
    ['https://api.example.com/?x=1'],
    ['https://api.example.com/#x'],
    ['https://user:pw@api.example.com'],
    ['ftp://api.example.com'],
    ['file:///etc/passwd'],
    [''],
  ])('rejects %j', (entry) => {
    expect(() => normalizeOrigin(entry)).toThrow(/Idenplane/);
  });

  it('makes resolveBearerTokenOrigins fail on a bad entry', () => {
    expect(() =>
      resolveBearerTokenOrigins({ url: IDP, bearerTokenOrigins: ['https://api.example.com/v1'] }),
    ).toThrow(/origins only/);
  });
});

// ── The real interceptors ─────────────────────────────────────────

function fakeAuth(opts: { token?: string; refreshed?: string; origins?: string[] } = {}) {
  let token: string | null = opts.token ?? 'placeholder-access-token';
  return {
    bearerTokenOrigins: resolveBearerTokenOrigins({ url: IDP, bearerTokenOrigins: opts.origins ?? [API] }),
    getToken: vi.fn(() => token),
    client: {
      refreshTokens: vi.fn(async () => {
        token = opts.refreshed ?? 'placeholder-refreshed-token';
        return { access_token: token, token_type: 'Bearer', expires_in: 60 };
      }),
    },
  };
}

/** A handler that records requests and answers from a script of responses. */
function recordingNext(responses: Array<'ok' | 401> = ['ok']) {
  const seen: HttpRequest<unknown>[] = [];
  const next = (req: HttpRequest<unknown>): Observable<HttpEvent<unknown>> => {
    seen.push(req);
    const r = responses[Math.min(seen.length - 1, responses.length - 1)];
    return r === 401
      ? throwError(() => new HttpErrorResponse({ status: 401, url: req.url }))
      : of(new HttpResponse({ status: 200, url: req.url }));
  };
  return { seen, next };
}

type Runner = (
  auth: ReturnType<typeof fakeAuth>,
  req: HttpRequest<unknown>,
  next: (req: HttpRequest<unknown>) => Observable<HttpEvent<unknown>>,
) => Observable<HttpEvent<unknown>>;

const runClass: Runner = (auth, req, next) => {
  const handler: HttpHandler = { handle: next };
  return new AuthInterceptor(auth as unknown as AuthService).intercept(req, handler);
};

const runFunctional: Runner = (auth, req, next) => {
  const injector = Injector.create({ providers: [{ provide: AuthService, useValue: auth }] });
  return runInInjectionContext(injector, () => authInterceptor(req, next));
};

describe.each([
  ['AuthInterceptor (class)', runClass],
  ['authInterceptor (functional)', runFunctional],
])('%s', (_name, run) => {
  it('attaches the token to the Idenplane server', async () => {
    const auth = fakeAuth();
    const { seen, next } = recordingNext();
    await firstValueFrom(run(auth, new HttpRequest('GET', `${IDP}/realms/demo/account`), next));
    expect(seen[0].headers.get('Authorization')).toBe('Bearer placeholder-access-token');
  });

  it('attaches the token to a listed API origin', async () => {
    const auth = fakeAuth();
    const { seen, next } = recordingNext();
    await firstValueFrom(run(auth, new HttpRequest('GET', `${API}/v1/orders`), next));
    expect(seen[0].headers.get('Authorization')).toBe('Bearer placeholder-access-token');
  });

  it.each([
    'https://api.example.com.evil.com/x',
    'https://api.example.com@evil.com/x',
    'http://api.example.com/x',
    'https://api.example.com:8443/x',
    'https://cdn.third-party.example.net/lib.js',
  ])('does not send the token to %s', async (url) => {
    const auth = fakeAuth();
    const { seen, next } = recordingNext();
    const req = new HttpRequest('GET', url);
    await firstValueFrom(run(auth, req, next));
    expect(seen[0]).toBe(req); // forwarded untouched
    expect(seen[0].headers.has('Authorization')).toBe(false);
    expect(auth.getToken).not.toHaveBeenCalled();
  });

  it('does not mutate the original request', async () => {
    const auth = fakeAuth();
    const { seen, next } = recordingNext();
    const req = new HttpRequest('GET', `${API}/v1/orders`);
    await firstValueFrom(run(auth, req, next));
    expect(req.headers.has('Authorization')).toBe(false);
    expect(seen[0]).not.toBe(req);
  });

  it('passes the request through when there is no token', async () => {
    const auth = fakeAuth();
    auth.getToken.mockReturnValue(null);
    const { seen, next } = recordingNext();
    await firstValueFrom(run(auth, new HttpRequest('GET', `${API}/v1/orders`), next));
    expect(seen[0].headers.has('Authorization')).toBe(false);
  });

  it('refreshes once and retries a trusted request that got 401', async () => {
    const auth = fakeAuth();
    const { seen, next } = recordingNext([401, 'ok']);
    await firstValueFrom(run(auth, new HttpRequest('GET', `${API}/v1/orders`), next));
    expect(auth.client.refreshTokens).toHaveBeenCalledOnce();
    expect(seen).toHaveLength(2);
    expect(seen[1].headers.get('Authorization')).toBe('Bearer placeholder-refreshed-token');
  });

  it('neither refreshes nor retries when an untrusted origin answers 401', async () => {
    const auth = fakeAuth();
    const { seen, next } = recordingNext([401]);
    await expect(
      firstValueFrom(run(auth, new HttpRequest('GET', 'https://evil.example.org/x'), next)),
    ).rejects.toBeInstanceOf(HttpErrorResponse);
    expect(auth.client.refreshTokens).not.toHaveBeenCalled();
    expect(seen).toHaveLength(1);
    expect(seen[0].headers.has('Authorization')).toBe(false);
  });
});
