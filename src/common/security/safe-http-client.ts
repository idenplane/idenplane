/**
 * DNS-pinned "safe" HTTP client for outbound webhook delivery.
 *
 * `resolveSafeTarget` is the authoritative SSRF enforcement point (as
 * opposed to the DTO-time, I/O-free checks in `ip-range-guard.ts`): DNS
 * answers can change between webhook configuration and delivery, so every
 * delivery attempt must re-resolve the hostname and re-validate every
 * candidate address against the blocklist in `ip-range-guard.ts` before any
 * connection is made.
 *
 * The resolved, validated address is returned alongside the parsed `URL` so
 * that callers (see `safePost`, added in a later subtask) can pin the
 * actual TCP connection to that exact address -- rather than letting the
 * HTTP stack perform a second, unvalidated DNS lookup at connect time --
 * which is what closes the classic DNS-rebinding TOCTOU gap (validate one
 * IP, connect to a different one returned by a second lookup).
 */

import { isIP } from 'node:net';
import type { LookupFunction } from 'node:net';
import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage, RequestOptions } from 'node:http';
import { isBlockedHostnameLiteral, isBlockedIp } from './ip-range-guard.js';

/**
 * The generic, non-leaking message persisted to `WebhookDelivery.response`
 * (and surfaced to callers) whenever a delivery attempt is rejected by SSRF
 * policy. Deliberately does not include the resolved/rejected hostname or IP
 * address so that internal network topology is never written to the
 * database or logs via this path.
 */
const SSRF_BLOCKED_MESSAGE =
  'Delivery blocked: target address is not publicly routable';

/**
 * Thrown by `resolveSafeTarget`/`safePost` whenever a delivery target (or a
 * redirect hop) is rejected by SSRF policy -- as opposed to an ordinary
 * network/timeout/DNS failure, which is surfaced as a plain `Error`
 * (or whatever error type the underlying `node:http`/`node:https`/`node:dns`
 * APIs throw). Callers (see Phase 4's `deliverWebhook` / `deliverToWebhook`)
 * can use `error instanceof SsrfBlockedError` to distinguish "blocked by
 * policy" from a transient failure, while still handling both the same way
 * for delivery-retry bookkeeping purposes.
 *
 * The `message` is intentionally always the generic, non-leaking
 * `SSRF_BLOCKED_MESSAGE` regardless of *why* a particular target was
 * blocked (blocked literal, blocked DNS answer, blocked redirect target,
 * too many redirect hops, etc.), so that it is always safe to persist
 * directly to `WebhookDelivery.response` without risking an internal
 * hostname or IP address leaking into the database or logs.
 */
export class SsrfBlockedError extends Error {
  constructor(message: string = SSRF_BLOCKED_MESSAGE) {
    super(message);
    this.name = 'SsrfBlockedError';
    // Restore the prototype chain (needed when targeting ES5/compiling
    // classes that extend built-ins such as Error under some TS/CJS
    // configurations) so `instanceof SsrfBlockedError` keeps working.
    Object.setPrototypeOf(this, SsrfBlockedError.prototype);
  }
}

/** The result of successfully resolving and validating a delivery target. */
export interface SafeTarget {
  /** The parsed request URL (protocol/path/query all preserved as-is). */
  url: URL;
  /** The validated, public-routable IP address the connection must use. */
  pinnedAddress: string;
  /** Address family of `pinnedAddress`. */
  family: 4 | 6;
}

/**
 * Parse and validate `rawUrl` as a safe outbound webhook delivery target:
 *
 *   1. Reject anything that isn't a syntactically valid absolute URL.
 *   2. Reject any protocol other than `http:`/`https:`.
 *   3. Reject hostnames that are known-unsafe *literals* (loopback aliases,
 *      numeric-encoded IPv4 literals, or IP literals in a blocked range) --
 *      see `isBlockedHostnameLiteral` -- without performing any DNS lookup.
 *   4. If the hostname is itself an IP literal (already validated in step
 *      3), use it directly as the pinned address; no DNS lookup is needed
 *      or performed.
 *   5. Otherwise, resolve the hostname via `dns.promises.lookup` (all
 *      addresses, not just the first) and reject if DNS resolution fails,
 *      returns no addresses, or every resolved candidate is blocked.
 *
 * Returns the first non-blocked resolved address. Throws `SsrfBlockedError`
 * (always with the generic, non-leaking `SSRF_BLOCKED_MESSAGE`) when the URL
 * itself, its protocol, or every resolved address is rejected by SSRF
 * policy. DNS resolution failures (a genuine network/lookup error, not a
 * policy decision) are surfaced as a plain `Error` instead, so callers can
 * still tell "blocked by policy" apart from "couldn't resolve at all".
 */
export async function resolveSafeTarget(rawUrl: string): Promise<SafeTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    // Not a network/DNS failure -- the URL itself is rejected before any
    // I/O is attempted, so this is a policy decision from the caller's
    // perspective too.
    throw new SsrfBlockedError();
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfBlockedError();
  }

  // `URL#hostname` already strips the surrounding brackets from an IPv6
  // literal (e.g. "http://[::1]/" -> hostname "::1"), so no extra
  // unwrapping is needed here.
  const hostname = url.hostname;

  if (isBlockedHostnameLiteral(hostname)) {
    throw new SsrfBlockedError();
  }

  const literalFamily = isIP(hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    // Already confirmed non-blocked above (isBlockedHostnameLiteral defers
    // IP literals to isBlockedIp), and there's nothing to resolve -- no DNS
    // lookup is performed for a literal IP target.
    return { url, pinnedAddress: hostname, family: literalFamily };
  }

  // A DNS lookup failure/empty result is a genuine network/resolution
  // problem, not an SSRF policy decision, so it's surfaced as a plain
  // `Error` rather than `SsrfBlockedError` -- neither message includes the
  // hostname, so nothing sensitive is leaked either way.
  let records: LookupAddress[];
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error('Delivery blocked: DNS resolution failed');
  }

  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('Delivery blocked: DNS resolution returned no addresses');
  }

  const safeRecord = records.find((record) => !isBlockedIp(record.address));
  if (!safeRecord) {
    throw new SsrfBlockedError();
  }

  const family: 4 | 6 = safeRecord.family === 6 ? 6 : 4;
  return { url, pinnedAddress: safeRecord.address, family };
}

/** Default request timeout, matching the previous fetch-based implementations. */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Maximum number of redirect hops `safePost` will follow before giving up.
 * Matches the plan's explicit cap so a chain of redirects can't be used to
 * stall the retry loop or exhaust resources.
 */
const MAX_REDIRECT_HOPS = 3;

/** HTTP status codes treated as redirects that `safePost` will (re-validate and) follow. */
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

/** Result shape returned by `safePost`, matching the pre-existing `doHttpPost` return shape. */
export interface SafePostResult {
  statusCode: number;
  body: string;
}

/**
 * Internal variant of `SafePostResult` that additionally carries the
 * response headers, needed to read `Location` for redirect handling. Never
 * exposed outside this module -- `safePost`'s public return shape stays
 * `{ statusCode, body }` so existing callers (webhook delivery services)
 * don't need to change.
 */
interface PinnedRequestResult extends SafePostResult {
  headers: Record<string, string | string[] | undefined>;
}

export interface SafePostOptions {
  /** Request timeout in milliseconds. Defaults to 10s, matching the previous AbortController-based fetch timeout. */
  timeoutMs?: number;
}

/**
 * DNS-pinned, SSRF-safe replacement for `fetch(url, { method: 'POST', ... })`.
 *
 * Uses `node:http`/`node:https` directly (rather than the global `fetch`) so
 * that the TCP connection can be pinned to the exact IP address validated by
 * `resolveSafeTarget` above, via a custom `lookup` function passed to the
 * request options. This closes the classic DNS-rebinding TOCTOU gap: without
 * pinning, `fetch`/the HTTP stack would perform its own, unvalidated DNS
 * lookup at connect time, which could return a different (and unsafe)
 * address than the one that was just validated -- especially if the
 * attacker controls the DNS record and flips it between validation and
 * connection.
 *
 * `servername` (TLS SNI) and the `Host` header are left as the *original*
 * hostname (not the pinned IP), so certificate validation and
 * virtual-hosting on the receiver side keep working correctly -- only the
 * underlying TCP connection target is pinned, not the logical destination
 * identity.
 *
 * Redirects are **never** followed automatically by the underlying
 * `http`/`https` request (unlike `fetch`'s default `redirect: 'follow'`
 * behaviour). Instead, this function explicitly detects 3xx responses with a
 * `Location` header, resolves the location against the current URL, and runs
 * it back through `resolveSafeTarget` -- exactly like the original request --
 * *before* connecting to it. This prevents an initially-public URL from
 * bouncing the request to an internal address via a redirect, which would
 * otherwise completely bypass the SSRF checks above. Following is capped at
 * `MAX_REDIRECT_HOPS` hops.
 */
export async function safePost(
  rawUrl: string,
  body: string,
  headers: Record<string, string>,
  options: SafePostOptions = {},
): Promise<SafePostResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let target = await resolveSafeTarget(rawUrl);

  for (let hop = 0; ; hop++) {
    const result = await sendPinnedRequest(target, body, headers, timeoutMs);

    if (!REDIRECT_STATUS_CODES.has(result.statusCode)) {
      return { statusCode: result.statusCode, body: result.body };
    }

    const location = result.headers.location;
    const locationValue = Array.isArray(location) ? location[0] : location;
    if (!locationValue) {
      // 3xx with no Location header -- nothing to follow, hand it back as-is
      // (matches how the previous fetch-based implementation, and plain
      // fetch with redirect: 'manual', would surface it to the caller).
      return { statusCode: result.statusCode, body: result.body };
    }

    if (hop >= MAX_REDIRECT_HOPS) {
      // Not strictly an "address is unroutable" rejection, but still a
      // policy decision (not a network failure) and must stay generic for
      // the same persisted-message reasons, so it reuses SsrfBlockedError.
      throw new SsrfBlockedError('Delivery blocked: too many redirects');
    }

    let nextUrl: URL;
    try {
      nextUrl = new URL(locationValue, target.url);
    } catch {
      throw new SsrfBlockedError('Delivery blocked: invalid redirect location');
    }

    // Re-validate the redirect target exactly like the original URL --
    // literal-hostname check, then a fresh DNS lookup validated against the
    // blocklist -- before ever connecting to it.
    target = await resolveSafeTarget(nextUrl.toString());
  }
}

/**
 * Send a single POST request to `target.url`, with the TCP connection
 * pinned to `target.pinnedAddress`/`target.family` via a custom `lookup`
 * implementation that ignores whatever hostname Node would otherwise
 * resolve and always returns the pre-validated address instead.
 */
function sendPinnedRequest(
  target: SafeTarget,
  body: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<PinnedRequestResult> {
  const { url, pinnedAddress, family } = target;
  const isHttps = url.protocol === 'https:';
  const requestFn = isHttps ? httpsRequest : httpRequest;

  // Ignore the hostname argument entirely -- always hand back the address
  // that was already validated by resolveSafeTarget, so no second (and
  // therefore unvalidated / rebindable) DNS lookup ever happens at connect
  // time.
  const pinnedLookup: LookupFunction = (_hostname, _options, callback) => {
    callback(null, pinnedAddress, family);
  };

  return new Promise<PinnedRequestResult>((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const requestOptions: RequestOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port !== '' ? Number(url.port) : isHttps ? 443 : 80,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers,
      lookup: pinnedLookup,
      family,
      signal: controller.signal,
      // Keep SNI/certificate validation and virtual-hosting tied to the
      // original hostname -- only the TCP connection target is pinned.
      ...(isHttps ? { servername: url.hostname } : {}),
    };

    const req = requestFn(requestOptions, (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        clearTimeout(timer);
        resolve({
          statusCode: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
          headers: res.headers,
        });
      });
      res.on('error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    req.on('error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });

    req.write(body);
    req.end();
  });
}
