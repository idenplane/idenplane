import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const isProduction = process.env.NODE_ENV === 'production';

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const isServerError = status >= 500;

    // A throttled request says when to retry (e.g. OAuthTokenError 429).
    const retryAfter = (exception as { retryAfterSeconds?: unknown })
      ?.retryAfterSeconds;
    if (
      status === Number(HttpStatus.TOO_MANY_REQUESTS) &&
      typeof retryAfter === 'number' &&
      Number.isFinite(retryAfter)
    ) {
      response.setHeader('Retry-After', String(Math.ceil(retryAfter)));
    }

    // A refused bearer token carries its RFC 6750 §3 challenge (e.g. a
    // certificate-bound token used without its certificate, RFC 8705 §3).
    const challenge = (exception as { wwwAuthenticate?: unknown })
      ?.wwwAuthenticate;
    if (
      status === Number(HttpStatus.UNAUTHORIZED) &&
      typeof challenge === 'string'
    ) {
      response.setHeader('WWW-Authenticate', challenge);
    }

    // Always log 5xx errors with full details server-side.
    if (isServerError) {
      this.logger.error(
        exception instanceof HttpException
          ? `HttpException ${status}`
          : 'Unhandled exception',
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    // In production, never leak internal details for 5xx responses.
    if (isProduction && isServerError) {
      response.status(status).json({
        statusCode: status,
        message: 'Internal server error',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // For 4xx (or any non-production environment), return the full HttpException payload.
    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    response.status(status).json({
      statusCode: status,
      ...(typeof message === 'string' ? { message } : message),
      timestamp: new Date().toISOString(),
    });
  }
}
