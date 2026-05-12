import { of, throwError } from 'rxjs';
import { MetricsInterceptor } from './metrics.interceptor.js';

describe('MetricsInterceptor', () => {
  let interceptor: MetricsInterceptor;
  let metricsService: {
    httpRequestsTotal: { inc: jest.Mock };
    httpRequestDuration: { observe: jest.Mock };
  };

  beforeEach(() => {
    metricsService = {
      httpRequestsTotal: { inc: jest.fn() },
      httpRequestDuration: { observe: jest.fn() },
    };
    interceptor = new MetricsInterceptor(metricsService as any);
  });

  function createContext(method: string, path: string, statusCode = 200) {
    return {
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({ method, path }),
        getResponse: jest.fn().mockReturnValue({ statusCode }),
      }),
    };
  }

  describe('intercept', () => {
    it('should record metrics on successful response', (done) => {
      const context = createContext('GET', '/api/users', 200);
      const next = { handle: () => of('result') };

      interceptor.intercept(context as any, next).subscribe({
        complete: () => {
          expect(metricsService.httpRequestsTotal.inc).toHaveBeenCalledWith({
            method: 'GET',
            path: '/api/users',
            status: '200',
          });
          expect(
            metricsService.httpRequestDuration.observe,
          ).toHaveBeenCalledWith(
            { method: 'GET', path: '/api/users' },
            expect.any(Number),
          );
          done();
        },
      });
    });

    it('should record metrics on error response', (done) => {
      const context = createContext('POST', '/api/users', 200);
      const error = { status: 400 };
      const next = { handle: () => throwError(() => error) };

      interceptor.intercept(context as any, next).subscribe({
        error: () => {
          expect(metricsService.httpRequestsTotal.inc).toHaveBeenCalledWith({
            method: 'POST',
            path: '/api/users',
            status: '400',
          });
          done();
        },
      });
    });

    it('should use getStatus() if status property is missing', (done) => {
      const context = createContext('GET', '/test', 200);
      const error = { getStatus: () => 404 };
      const next = { handle: () => throwError(() => error) };

      interceptor.intercept(context as any, next).subscribe({
        error: () => {
          expect(metricsService.httpRequestsTotal.inc).toHaveBeenCalledWith(
            expect.objectContaining({ status: '404' }),
          );
          done();
        },
      });
    });

    it('should default to 500 if error has no status', (done) => {
      const context = createContext('GET', '/test', 200);
      const error = new Error('unexpected');
      const next = { handle: () => throwError(() => error) };

      interceptor.intercept(context as any, next).subscribe({
        error: () => {
          expect(metricsService.httpRequestsTotal.inc).toHaveBeenCalledWith(
            expect.objectContaining({ status: '500' }),
          );
          done();
        },
      });
    });

    it('should normalize UUIDs in path to :id', (done) => {
      const uuidPath =
        '/api/users/550e8400-e29b-41d4-a716-446655440000/sessions';
      const context = createContext('GET', uuidPath, 200);
      const next = { handle: () => of('result') };

      interceptor.intercept(context as any, next).subscribe({
        complete: () => {
          expect(metricsService.httpRequestsTotal.inc).toHaveBeenCalledWith(
            expect.objectContaining({
              path: '/api/users/:id/sessions',
            }),
          );
          done();
        },
      });
    });

    it('should normalize multiple UUIDs in path', (done) => {
      const path =
        '/api/realms/11111111-2222-3333-4444-555555555555/users/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      const context = createContext('DELETE', path, 204);
      const next = { handle: () => of(undefined) };

      interceptor.intercept(context as any, next).subscribe({
        complete: () => {
          expect(metricsService.httpRequestsTotal.inc).toHaveBeenCalledWith(
            expect.objectContaining({
              path: '/api/realms/:id/users/:id',
            }),
          );
          done();
        },
      });
    });

    it('should record positive duration', (done) => {
      const context = createContext('GET', '/health', 200);
      const next = { handle: () => of('ok') };

      interceptor.intercept(context as any, next).subscribe({
        complete: () => {
          const duration =
            metricsService.httpRequestDuration.observe.mock.calls[0][1];
          expect(duration).toBeGreaterThanOrEqual(0);
          done();
        },
      });
    });
  });
});
