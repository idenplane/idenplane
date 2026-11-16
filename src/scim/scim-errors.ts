/**
 * SCIM errors (RFC 7644 §3.12).
 *
 * A `ScimException` carries the RFC's `scimType` keyword next to the HTTP
 * status. `ScimExceptionFilter` turns it, and any other exception thrown
 * while serving a SCIM request, into the RFC's error body.
 */

import { HttpException } from '@nestjs/common';
import { SCIM_SCHEMAS } from './types/scim.types.js';
import type { ScimError } from './types/scim.types.js';

/** The `scimType` keywords of RFC 7644 §3.12, Table 9. */
export type ScimErrorType =
  | 'invalidFilter'
  | 'tooMany'
  | 'uniqueness'
  | 'mutability'
  | 'invalidSyntax'
  | 'invalidPath'
  | 'noTarget'
  | 'invalidValue'
  | 'invalidVers'
  | 'sensitive';

export class ScimException extends HttpException {
  constructor(
    status: number,
    readonly scimType: ScimErrorType | undefined,
    detail: string,
  ) {
    super(scimErrorBody(status, detail, scimType), status);
    this.message = detail;
  }
}

export function scimErrorBody(
  status: number,
  detail: string,
  scimType?: string,
): ScimError {
  return {
    schemas: [SCIM_SCHEMAS.ERROR],
    status: String(status),
    ...(scimType ? { scimType } : {}),
    detail,
  };
}

export const scimBadRequest = (scimType: ScimErrorType, detail: string) =>
  new ScimException(400, scimType, detail);

export const scimConflict = (detail: string) =>
  new ScimException(409, 'uniqueness', detail);

/** Prisma's unique-constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

/**
 * The SCIM error body for any exception thrown while serving a SCIM
 * request. 5xx details are hidden in production.
 */
export function toScimError(exception: unknown): ScimError {
  const body = describe(exception);
  if (Number(body.status) >= 500 && process.env.NODE_ENV === 'production') {
    // As the global filter does: never leak a 5xx's detail in production.
    return scimErrorBody(Number(body.status), 'Internal server error');
  }
  return body;
}

function describe(exception: unknown): ScimError {
  if (exception instanceof ScimException) {
    return exception.getResponse() as ScimError;
  }
  if (isUniqueViolation(exception)) {
    return scimErrorBody(409, 'The resource already exists', 'uniqueness');
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const body = exception.getResponse();
    const message =
      typeof body === 'string' ? body : (body as { message?: unknown }).message;
    const detail = Array.isArray(message)
      ? message.join('; ')
      : typeof message === 'string'
        ? message
        : exception.message;
    return scimErrorBody(
      status,
      detail,
      status === 409 ? 'uniqueness' : undefined,
    );
  }
  return scimErrorBody(
    500,
    exception instanceof Error ? exception.message : 'Internal server error',
  );
}
