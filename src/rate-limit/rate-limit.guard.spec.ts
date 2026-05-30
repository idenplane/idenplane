import { Reflector } from '@nestjs/core';
import { HttpException, HttpStatus } from '@nestjs/common';
import {
  RateLimitGuard,
  RATE_LIMIT_TYPE_KEY,
  type RateLimitType,
} from './rate-limit.guard.js';

function makeRequest(opts: {
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
  headers?: Record<string, string | undefined>;
  realm?: { id: string };
  params?: Record<string, string>;
  ip?: string;
}) {
  return {
    body: opts.body,
    query: opts.query,
    headers: opts.headers ?? {},
    realm: opts.realm,
    params: opts.params ?? {},
    ip: opts.ip ?? '203.0.113.4',
    socket: { remoteAddress: opts.ip ?? '203.0.113.4' },
  } as never;
}

function makeContext(req: ReturnType<typeof makeRequest>, res?: object) {
  const response = res ?? { setHeader: jest.fn() };
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => response,
    }),
  } as never;
}

describe('RateLimitGuard', () => {
  let reflector: Reflector;
  let rateLimitService: {
    checkIpLimit: jest.Mock;
    checkClientLimit: jest.Mock;
    checkUserLimit: jest.Mock;
    computeHeaders: jest.Mock;
  };
  let metricsService: { rateLimitHitsTotal: { inc: jest.Mock } };
  let guard: RateLimitGuard;

  beforeEach(() => {
    reflector = new Reflector();
    rateLimitService = {
      checkIpLimit: jest.fn(),
      checkClientLimit: jest.fn(),
      checkUserLimit: jest.fn(),
      computeHeaders: jest.fn(() => ({})),
    };
    metricsService = { rateLimitHitsTotal: { inc: jest.fn() } };
    guard = new RateLimitGuard(
      rateLimitService as never,
      metricsService as never,
      reflector,
    );
  });

  function setTypes(types: RateLimitType[] | string | undefined) {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(types as never);
  }

  it('skips when no rate-limit metadata is configured', async () => {
    setTypes(undefined);
    const ctx = makeContext(makeRequest({ realm: { id: 'r1' } }));
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(rateLimitService.checkIpLimit).not.toHaveBeenCalled();
  });

  it('still accepts legacy single-string metadata', async () => {
    setTypes('ip');
    rateLimitService.checkIpLimit.mockResolvedValue({
      allowed: true,
      limit: 100,
      remaining: 99,
      resetAt: 0,
    });
    const ctx = makeContext(makeRequest({ realm: { id: 'r1' } }));
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(rateLimitService.checkIpLimit).toHaveBeenCalledWith(
      expect.any(String),
      'r1',
    );
  });

  it('runs all configured limiters in order; throws on the first denial', async () => {
    setTypes(['ip', 'client']);
    rateLimitService.checkIpLimit.mockResolvedValue({
      allowed: true,
      limit: 100,
      remaining: 99,
      resetAt: 0,
    });
    rateLimitService.checkClientLimit.mockResolvedValue({
      allowed: false,
      limit: 5,
      remaining: 0,
      resetAt: 0,
    });
    const ctx = makeContext(
      makeRequest({
        realm: { id: 'r1' },
        body: { client_id: 'web-app' },
      }),
    );

    await expect(guard.canActivate(ctx)).rejects.toThrow(HttpException);
    try {
      await guard.canActivate(ctx);
    } catch (err) {
      expect((err as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    expect(rateLimitService.checkClientLimit).toHaveBeenCalledWith(
      'web-app',
      'r1',
    );
    expect(metricsService.rateLimitHitsTotal.inc).toHaveBeenCalledWith({
      type: 'client',
      realm: 'r1',
    });
  });

  it('allows when every configured limiter allows', async () => {
    setTypes(['ip', 'client']);
    rateLimitService.checkIpLimit.mockResolvedValue({
      allowed: true,
      limit: 100,
      remaining: 99,
      resetAt: 0,
    });
    rateLimitService.checkClientLimit.mockResolvedValue({
      allowed: true,
      limit: 60,
      remaining: 59,
      resetAt: 0,
    });
    const ctx = makeContext(
      makeRequest({
        realm: { id: 'r1' },
        body: { client_id: 'web-app' },
      }),
    );

    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('skips per-client check when client_id cannot be resolved', async () => {
    setTypes(['ip', 'client']);
    rateLimitService.checkIpLimit.mockResolvedValue({
      allowed: true,
      limit: 100,
      remaining: 99,
      resetAt: 0,
    });
    const ctx = makeContext(makeRequest({ realm: { id: 'r1' } }));
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(rateLimitService.checkClientLimit).not.toHaveBeenCalled();
  });

  it('decodes Basic auth so confidential clients hit the per-client limiter', async () => {
    setTypes(['client']);
    rateLimitService.checkClientLimit.mockResolvedValue({
      allowed: true,
      limit: 60,
      remaining: 59,
      resetAt: 0,
    });
    // RFC 6749 §2.3.1 Basic: base64('confidential-bot:s3cr3t')
    const basic = Buffer.from('confidential-bot:s3cr3t').toString('base64');
    const ctx = makeContext(
      makeRequest({
        realm: { id: 'r1' },
        headers: { authorization: `Basic ${basic}` },
      }),
    );

    await guard.canActivate(ctx);
    expect(rateLimitService.checkClientLimit).toHaveBeenCalledWith(
      'confidential-bot',
      'r1',
    );
  });

  it('decodes Basic auth even when client_id contains percent-encoded chars', async () => {
    setTypes(['client']);
    rateLimitService.checkClientLimit.mockResolvedValue({
      allowed: true,
      limit: 60,
      remaining: 59,
      resetAt: 0,
    });
    // client_id 'my client' percent-encoded as 'my%20client' per the spec
    const basic = Buffer.from('my%20client:pw').toString('base64');
    const ctx = makeContext(
      makeRequest({
        realm: { id: 'r1' },
        headers: { authorization: `Basic ${basic}` },
      }),
    );

    await guard.canActivate(ctx);
    expect(rateLimitService.checkClientLimit).toHaveBeenCalledWith(
      'my client',
      'r1',
    );
  });

  it('tolerates malformed Basic auth without throwing', async () => {
    setTypes(['client']);
    const ctx = makeContext(
      makeRequest({
        realm: { id: 'r1' },
        headers: { authorization: 'Basic ###not-base64###' },
      }),
    );
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(rateLimitService.checkClientLimit).not.toHaveBeenCalled();
  });

  it('prefers body.client_id over the Basic header when both are present', async () => {
    setTypes(['client']);
    rateLimitService.checkClientLimit.mockResolvedValue({
      allowed: true,
      limit: 60,
      remaining: 59,
      resetAt: 0,
    });
    const basic = Buffer.from('basic-id:pw').toString('base64');
    const ctx = makeContext(
      makeRequest({
        realm: { id: 'r1' },
        body: { client_id: 'body-id' },
        headers: { authorization: `Basic ${basic}` },
      }),
    );

    await guard.canActivate(ctx);
    expect(rateLimitService.checkClientLimit).toHaveBeenCalledWith(
      'body-id',
      'r1',
    );
  });

  it('uses metadata key constant (smoke check for reflector wiring)', () => {
    // Regression guard: if someone renames the key elsewhere the
    // reflector lookup silently returns undefined and the guard no-ops.
    expect(RATE_LIMIT_TYPE_KEY).toBe('rateLimitType');
  });
});
