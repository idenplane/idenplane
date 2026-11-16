/**
 * Angular HTTP interceptor that adds the access token to requests for trusted
 * origins only: the Idenplane server and the origins listed in
 * `bearerTokenOrigins`. Requests to any other origin are passed through
 * untouched, so the token never leaks to third-party hosts.
 *
 * @example
 * ```typescript
 * // app.config.ts  (Angular 15+ standalone)
 * import { provideHttpClient, withInterceptors } from '@angular/common/http';
 * import { authInterceptor, IDENPLANE_CONFIG } from 'idenplane-angular';
 *
 * export const appConfig: ApplicationConfig = {
 *   providers: [
 *     {
 *       provide: IDENPLANE_CONFIG,
 *       useValue: {
 *         url: 'https://auth.example.com',
 *         realm: 'my-realm',
 *         clientId: 'my-app',
 *         redirectUri: 'https://app.example.com/callback',
 *         bearerTokenOrigins: ['https://api.example.com'],
 *       },
 *     },
 *     provideHttpClient(withInterceptors([authInterceptor])),
 *   ],
 * };
 * ```
 *
 * Or with the class-based interceptor (NgModule style), which
 * `IdenplaneModule.forRoot()` registers for you:
 * ```typescript
 * @NgModule({
 *   providers: [
 *     { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
 *   ],
 * })
 * ```
 */

import { Injectable } from '@angular/core';
import type {
  HttpInterceptor,
  HttpRequest,
  HttpHandler,
  HttpEvent,
  HttpInterceptorFn,
} from '@angular/common/http';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, from, throwError } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { inject } from '@angular/core';
import { AuthService } from './auth.service.js';
import { shouldAttachToken } from './bearer-origins.js';

/** The parts of `AuthService` the interceptor uses. */
type InterceptorAuth = Pick<AuthService, 'getToken' | 'bearerTokenOrigins'> & {
  client: Pick<AuthService['client'], 'refreshTokens'>;
};

/** Attach a Bearer token to a request clone, if the token is non-null. */
function attachToken<T>(req: HttpRequest<T>, token: string | null): HttpRequest<T> {
  if (!token) return req;
  return req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
}

/**
 * Shared logic of both interceptors. Requests for an untrusted origin are
 * forwarded unchanged, and their 401 responses do not trigger a token
 * refresh. For a trusted origin the token is attached and, on a 401, the
 * tokens are refreshed once and the request retried once (#458).
 */
function intercept(
  req: HttpRequest<unknown>,
  next: (req: HttpRequest<unknown>) => Observable<HttpEvent<unknown>>,
  auth: InterceptorAuth,
): Observable<HttpEvent<unknown>> {
  if (!shouldAttachToken(req.url, auth.bearerTokenOrigins)) {
    return next(req);
  }

  return next(attachToken(req, auth.getToken())).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 401) {
        return from(auth.client.refreshTokens()).pipe(
          switchMap(() => next(attachToken(req, auth.getToken()))),
          catchError((refreshErr: unknown) => throwError(() => refreshErr)),
        );
      }
      return throwError(() => err);
    }),
  );
}

/**
 * Class-based HTTP interceptor (NgModule-compatible).
 * Attaches the current access token as `Authorization: Bearer ...` to
 * requests for the Idenplane server and `bearerTokenOrigins` only.
 */
@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  constructor(private readonly auth: AuthService) {}

  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    return intercept(req, (r) => next.handle(r), this.auth);
  }
}

/**
 * Functional HTTP interceptor for use with `provideHttpClient(withInterceptors([...]))`.
 * (Angular 15+). Same origin rules as {@link AuthInterceptor}.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  return intercept(req, next, auth);
};
