import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * An RFC 6749 §5.2 compliant token-endpoint error.
 *
 * The JSON body produced by {@link getResponse} is `{ error, error_description? }`
 * where `error` is a standard OAuth error CODE (e.g. `invalid_grant`,
 * `invalid_client`, `unsupported_grant_type`) rather than a free-form message.
 *
 * The HTTP status is carried separately so the controller can branch — most
 * errors are 400, but `invalid_client` is 401 and must additionally send a
 * `WWW-Authenticate` header.
 */
export class OAuthTokenError extends HttpException {
  /** The OAuth error code, e.g. `invalid_grant`. */
  readonly code: string;
  /** The human-readable `error_description`, when one is supplied. */
  readonly description?: string;

  constructor(
    code: string,
    description?: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super(
      {
        error: code,
        ...(description ? { error_description: description } : {}),
      },
      status,
    );
    this.code = code;
    this.description = description;
    // Preserve a meaningful `message` so string-based assertions (and the
    // device-code RFC 8628 codes that double as messages) keep matching.
    // Without this, NestJS derives `message` from the class name.
    this.message = description ?? code;
  }

  /** The HTTP status code to respond with. */
  get httpStatus(): number {
    return this.getStatus();
  }
}
