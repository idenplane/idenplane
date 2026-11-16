import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';

/** Nested objects deeper than this are not walked (and not plausible input). */
const MAX_DEPTH = 32;

/**
 * Global pipe, registered first, that makes two kinds of malformed request a
 * client error (400) instead of a crash (500), before any handler or the
 * ValidationPipe sees them:
 *
 * - **No body.** Express 5 leaves `req.body` undefined when a request has no
 *   body, or one whose content type no parser handles. A whole-body `@Body()`
 *   then arrives as `undefined`, the ValidationPipe skips it, and handlers
 *   that read `body.x` threw a TypeError (found by the OWASP ZAP API scan:
 *   revoke, back-channel logout, device, step-up, risk policies, SCIM
 *   mappings, protocol mappers). It is now `{}`, so DTO validation and the
 *   handlers' own "x is required" checks answer 400.
 * - **NUL characters.** PostgreSQL cannot store U+0000 in text, so a NUL in
 *   any body, query or path value failed deep in a query with SQLSTATE 22021
 *   (500). No identifier, name or credential legitimately contains one.
 */
@Injectable()
export class RequestInputPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (
      metadata.type !== 'body' &&
      metadata.type !== 'query' &&
      metadata.type !== 'param'
    ) {
      return value;
    }
    if (metadata.type === 'body' && !metadata.data && value === undefined) {
      return {};
    }
    if (containsNul(value, 0)) {
      throw new BadRequestException(
        'Request contains a NUL character, which is not allowed in any field',
      );
    }
    return value;
  }
}

function containsNul(value: unknown, depth: number): boolean {
  if (typeof value === 'string') return value.includes('\u0000');
  if (depth >= MAX_DEPTH || value === null || typeof value !== 'object') {
    return false;
  }
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return false;
  if (Array.isArray(value)) {
    return value.some((v) => containsNul(v, depth + 1));
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k.includes('\u0000') || containsNul(v, depth + 1)) return true;
  }
  return false;
}
