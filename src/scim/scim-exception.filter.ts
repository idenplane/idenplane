import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  Logger,
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import { SCIM_CONTENT_TYPE } from './types/scim.types.js';
import { toScimError } from './scim-errors.js';

/**
 * Answers every error of a SCIM endpoint, including the auth guard's, with
 * the RFC 7644 §3.12 error body as `application/scim+json`. Bound to the
 * SCIM controller, so it takes precedence over the global filter there.
 */
@Catch()
export class ScimExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ScimExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const body = toScimError(exception);
    const status = Number(body.status);
    if (status >= 500) {
      this.logger.error(
        'Unhandled SCIM exception',
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    response.status(status).type(SCIM_CONTENT_TYPE).send(JSON.stringify(body));
  }
}

/**
 * Sends SCIM responses as `application/scim+json` (RFC 7644 §3.1). Express
 * keeps a Content-Type that is already set when it serialises the body.
 */
@Injectable()
export class ScimContentTypeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Content-Type', `${SCIM_CONTENT_TYPE}; charset=utf-8`);
    return next.handle();
  }
}
