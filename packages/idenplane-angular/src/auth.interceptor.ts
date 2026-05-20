/**
 * Angular HTTP interceptor that adds the Bearer token to outgoing requests.
 *
 * @example
 * ```typescript
 * // app.config.ts  (Angular 15+ standalone)
 * import { provideHttpClient, withInterceptors } from '@angular/common/http';
 * import { authInterceptor } from '@authme/angular';
 *
 * export const appConfig: ApplicationConfig = {
 *   providers: [
 *     provideHttpClient(withInterceptors([authInterceptor])),
 *   ],
 * };
 * ```
 *
 * Or with the class-based interceptor (NgModule style):
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
  HttpHandlerFn,
} from '@angular/common/http';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, from, throwError } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { inject } from '@angular/core';
import { AuthService } from './auth.service.js';

/** Attach a Bearer token to a request clone, if the token is non-null. */
function attachToken<T>(req: HttpRequest<T>, token: string | null): HttpRequest<T> {
  if (!token) return req;
  return req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
}

/**
 * Class-based HTTP interceptor (NgModule-compatible).
 * Attaches the current AuthMe access token as a `Authorization: Bearer ...`
 * header when one is available.
 *
 * Issue #458: on a 401 response the interceptor now attempts a single token
 * refresh and retries the original request once before propagating the error.
 */
@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  constructor(private readonly auth: AuthService) {}

  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    const token = this.auth.getToken();
    const authReq = attachToken(req, token);

    return next.handle(authReq).pipe(
      catchError((err: unknown) => {
        if (err instanceof HttpErrorResponse && err.status === 401) {
          // Attempt a single token refresh and retry the request once.
          return from(this.auth.client.refreshTokens()).pipe(
            switchMap(() => {
              const newToken = this.auth.getToken();
              return next.handle(attachToken(req, newToken));
            }),
            catchError((refreshErr: unknown) => throwError(() => refreshErr)),
          );
        }
        return throwError(() => err);
      }),
    );
  }
}

/**
 * Functional HTTP interceptor for use with `provideHttpClient(withInterceptors([...]))`.
 * (Angular 15+)
 *
 * Issue #458: on a 401 response the interceptor attempts a single token
 * refresh and retries the original request once before propagating the error.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.getToken();

  return next(attachToken(req, token)).pipe(
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
};
