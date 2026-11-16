import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * A database error that the request itself caused, as an HTTP client error.
 *
 * Unvalidated input that reaches Prisma (an unparseable date or number in a
 * query string, a value too long for its column, a duplicate unique key)
 * used to surface as a 500 with Prisma's message logged as an unhandled
 * crash; the OWASP ZAP API scan found a dozen such endpoints. The mapped
 * response never carries Prisma's message, which quotes the query.
 *
 * Prisma's classes are matched by name, not instanceof, so this works for
 * every generated client and in tests that construct a plain Error.
 */
export function prismaClientError(
  exception: unknown,
): { status: number; message: string } | null {
  if (!(exception instanceof Error)) return null;
  if (exception.name === 'PrismaClientValidationError') {
    return {
      status: HttpStatus.BAD_REQUEST,
      message: 'The request contains a value of the wrong type or format',
    };
  }
  if (exception.name !== 'PrismaClientKnownRequestError') return null;
  const code = (exception as { code?: unknown }).code;
  switch (code) {
    case 'P2002':
      return {
        status: HttpStatus.CONFLICT,
        message: 'A resource with these values already exists',
      };
    case 'P2003':
    case 'P2014':
      return {
        status: HttpStatus.CONFLICT,
        message: 'The request conflicts with related resources',
      };
    case 'P2025':
    case 'P2015':
      return { status: HttpStatus.NOT_FOUND, message: 'Resource not found' };
    case 'P2000':
    case 'P2005':
    case 'P2006':
    case 'P2007':
    case 'P2009':
    case 'P2011':
    case 'P2012':
    case 'P2013':
    case 'P2019':
    case 'P2020':
    case 'P2023':
      return {
        status: HttpStatus.BAD_REQUEST,
        message: 'The request contains an invalid value',
      };
  }
  // Errors the driver adapter passes through with the PostgreSQL SQLSTATE in
  // the message ("Database error. Code: `22021`"). Class 22 is "data
  // exception": invalid text encoding, numeric out of range, bad datetime.
  if (/Code: `22[0-9A-Z]{3}`/.test(exception.message)) {
    return {
      status: HttpStatus.BAD_REQUEST,
      message: 'The request contains an invalid value',
    };
  }
  return null;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const isProduction = process.env.NODE_ENV === 'production';

    const clientError = prismaClientError(exception);
    if (clientError) {
      // Still worth seeing: it is usually a missing validation.
      const err = exception as Error & { code?: unknown };
      const where = err.stack
        ?.split('\n')
        .find((l) => l.includes('/src/') || l.includes('/dist/'));
      const code = typeof err.code === 'string' ? ` ${err.code}` : '';
      this.logger.warn(
        `Database rejected request input: ${err.name}${code} -> ${clientError.status}${where ? ` (${where.trim()})` : ''}`,
      );
      response.status(clientError.status).json({
        statusCode: clientError.status,
        message: clientError.message,
        timestamp: new Date().toISOString(),
      });
      return;
    }

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
