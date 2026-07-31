/**
 * `class-validator` decorator that rejects webhook URLs whose host is
 * *statically* known to be unroutable -- an IP literal in a blocked range, or
 * a loopback-ish hostname literal like `localhost`.
 *
 * This is deliberately a convenience check, not the security boundary. It
 * performs no DNS resolution (validation runs on the request path and must
 * stay I/O-free), so a hostname that merely *resolves* to an internal address
 * passes here and is caught later by `resolveSafeTarget` at delivery time,
 * which is the authoritative enforcement point. The value of checking here is
 * feedback: an operator who pastes `http://127.0.0.1:9000/hook` gets an
 * immediate 400 instead of a webhook that is accepted and then silently fails
 * every delivery.
 *
 * See `ip-range-guard.ts` for the blocklist and `safe-http-client.ts` for the
 * delivery-time enforcement.
 */

import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { isBlockedHostnameLiteral } from './ip-range-guard.js';
import { privateTargetsAllowed } from './safe-http-client.js';

/**
 * Returns true when `value` is a syntactically valid http(s) URL whose host is
 * not statically known to be blocked. Non-strings, unparseable URLs and
 * non-http(s) protocols are rejected, so `file://`, `gopher://` and friends
 * cannot reach the delivery path at all.
 */
export function isSafeWebhookUrl(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }

  // Deployments that opt into internal targets must be able to configure them
  // too, not just deliver to them -- otherwise the escape hatch is unusable.
  if (privateTargetsAllowed()) {
    return true;
  }

  return !isBlockedHostnameLiteral(url.hostname);
}

export function IsSafeWebhookUrl(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isSafeWebhookUrl',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return isSafeWebhookUrl(value);
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be an http(s) URL pointing at a publicly routable address`;
        },
      },
    });
  };
}
