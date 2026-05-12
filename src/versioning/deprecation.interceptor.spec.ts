import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';
import { DeprecationInterceptor } from './deprecation.interceptor.js';

function makeContext(path: string): ExecutionContext {
  const mockRequest = { path };
  const mockResponse = {
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
  };
  return {
    switchToHttp: () => ({
      getRequest: () => mockRequest,
      getResponse: () => mockResponse,
    }),
  } as unknown as ExecutionContext;
}

function makeHandler(): {
  handler: CallHandler;
  response$: ReturnType<typeof of>;
} {
  const response$ = of({ ok: true });
  const handler: CallHandler = { handle: () => response$ };
  return { handler, response$ };
}

describe('DeprecationInterceptor', () => {
  let interceptor: DeprecationInterceptor;

  beforeEach(() => {
    interceptor = new DeprecationInterceptor();
  });

  it('should be defined', () => {
    expect(interceptor).toBeDefined();
  });

  describe('unversioned admin routes', () => {
    const unversionedPaths = [
      '/admin/realms',
      '/admin/realms/master/users',
      '/admin',
    ];

    it.each(unversionedPaths)(
      'adds Deprecation, Sunset and Link headers for %s',
      (path) => {
        const ctx = makeContext(path);
        const { handler } = makeHandler();
        const response = ctx.switchToHttp().getResponse();

        interceptor.intercept(ctx, handler).subscribe();

        expect(response.headers['Deprecation']).toBeDefined();
        expect(response.headers['Sunset']).toBeDefined();
        expect(response.headers['Link']).toContain('/api/v1' + path);
        expect(response.headers['Link']).toContain('successor-version');
      },
    );
  });

  describe('versioned admin routes', () => {
    const versionedPaths = [
      '/api/v1/admin/realms',
      '/api/v1/admin/realms/master/users',
      '/api/v2/admin/system/version',
    ];

    it.each(versionedPaths)(
      'does NOT add deprecation headers for versioned path %s',
      (path) => {
        const ctx = makeContext(path);
        const { handler } = makeHandler();
        const response = ctx.switchToHttp().getResponse();

        interceptor.intercept(ctx, handler).subscribe();

        expect(response.headers['Deprecation']).toBeUndefined();
        expect(response.headers['Sunset']).toBeUndefined();
        expect(response.headers['Link']).toBeUndefined();
      },
    );
  });

  describe('non-admin routes', () => {
    const otherPaths = [
      '/health',
      '/health/ready',
      '/.well-known/openid-configuration',
      '/realms/master/protocol/openid-connect/token',
      '/console/',
    ];

    it.each(otherPaths)('does NOT add deprecation headers for %s', (path) => {
      const ctx = makeContext(path);
      const { handler } = makeHandler();
      const response = ctx.switchToHttp().getResponse();

      interceptor.intercept(ctx, handler).subscribe();

      expect(response.headers['Deprecation']).toBeUndefined();
      expect(response.headers['Sunset']).toBeUndefined();
    });
  });

  it('passes the response payload through unchanged', (done) => {
    const ctx = makeContext('/admin/realms');
    const payload = { id: 'abc', name: 'master' };
    const handler: CallHandler = { handle: () => of(payload) };

    interceptor.intercept(ctx, handler).subscribe((result) => {
      expect(result).toEqual(payload);
      done();
    });
  });
});
