import { Injectable } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'crypto';

/**
 * CSRF protection via the double-submit cookie pattern.
 *
 * On each GET request that renders a form:
 *   1. A random token is generated (32 bytes → 64 hex chars).
 *   2. The token is set as an HttpOnly cookie `XSRF-TOKEN-<realmName>`.
 *   3. The same token is embedded as a hidden field `_csrf` in the HTML form.
 *
 * On every POST that processes a form submission:
 *   1. Read the `_csrf` field from the request body.
 *   2. Read the `XSRF-TOKEN-<realmName>` cookie.
 *   3. Compare them with `timingSafeEqual`; reject if they do not match.
 *
 * Because an attacker-controlled page cannot read the HttpOnly cookie via
 * JavaScript they cannot forge the matching hidden field value, preventing
 * CSRF attacks.
 */
@Injectable()
export class CsrfService {
  /** Generate a fresh, URL-safe random token. */
  generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  /** Cookie name scoped to the realm to avoid cross-realm cookie collisions. */
  cookieName(realmName: string): string {
    return `XSRF-TOKEN-${realmName}`;
  }

  /**
   * Validate that the CSRF token submitted in the form body matches the one
   * stored in the cookie.  Returns `true` when they match, `false` otherwise.
   *
   * Uses a constant-time comparison to prevent timing-based attacks.
   */
  validate(
    bodyToken: string | undefined,
    cookieToken: string | undefined,
  ): boolean {
    if (!bodyToken || !cookieToken) return false;
    if (bodyToken.length !== cookieToken.length) return false;

    try {
      return timingSafeEqual(Buffer.from(bodyToken), Buffer.from(cookieToken));
    } catch {
      return false;
    }
  }
}
