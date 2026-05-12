import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request, Response } from 'express';

/**
 * DeprecationInterceptor
 *
 * Attaches RFC 8594 `Deprecation` and `Sunset` headers to any response whose
 * request path matches a deprecated (unversioned) URL pattern — i.e. any
 * `/admin/*` route that is NOT already prefixed with `/api/v`.
 *
 * The versioned equivalents live under `/api/v1/admin/*`.
 */
@Injectable()
export class DeprecationInterceptor implements NestInterceptor {
  /** ISO-8601 date after which unversioned routes are considered sunset. */
  private static readonly SUNSET_DATE = 'Sat, 01 Jan 2028 00:00:00 GMT';

  /** Human-readable date used in the Deprecation header value. */
  private static readonly DEPRECATION_DATE = 'Tue, 01 Jan 2027 00:00:00 GMT';

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const path: string = request.path ?? '';

    // Only annotate unversioned admin routes (not /api/v1/... paths)
    const isUnversioned =
      (path.startsWith('/admin/') || path === '/admin') &&
      !path.startsWith('/api/v');

    if (!isUnversioned) {
      return next.handle();
    }

    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      tap(() => {
        // Skip header injection when the response has already been committed
        // (e.g. streaming / CSV export endpoints that write directly to res).
        // Calling setHeader() after headers are sent causes ERR_HTTP_HEADERS_SENT.
        if (response.headersSent) {
          return;
        }
        response.setHeader(
          'Deprecation',
          DeprecationInterceptor.DEPRECATION_DATE,
        );
        response.setHeader('Sunset', DeprecationInterceptor.SUNSET_DATE);
        response.setHeader('Link', `</api/v1${path}>; rel="successor-version"`);
      }),
    );
  }
}
