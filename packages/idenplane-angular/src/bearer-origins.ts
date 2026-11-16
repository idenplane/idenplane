/**
 * Decides which requests the HTTP interceptor may send the access token to.
 *
 * The token goes only to origins that are explicitly trusted: the Idenplane
 * server's own origin and the ones listed in `bearerTokenOrigins`. Origins
 * are compared exactly (scheme, host and port, after WHATWG URL
 * normalisation), never by prefix, so `https://api.example.com.evil.com`,
 * `https://api.example.com@evil.com`, `http://api.example.com` and
 * `https://api.example.com:8443` do not match `https://api.example.com`.
 */

import type { IdenplaneConfig } from 'idenplane-sdk';

/**
 * Normalise a configured origin (`https://api.example.com`, with or without a
 * trailing slash) to its serialised form. Anything that is not a plain
 * http(s) origin is a configuration error: a path, query, fragment,
 * credentials or a `*` wildcard would suggest a match this check never makes.
 */
export function normalizeOrigin(entry: string): string {
  if (typeof entry !== 'string' || entry.trim() === '') {
    throw new Error('Idenplane: bearerTokenOrigins entries must be non-empty origin strings');
  }
  if (entry.includes('*')) {
    throw new Error(
      `Idenplane: wildcards are not supported in bearerTokenOrigins ("${entry}"); list each origin`,
    );
  }
  let url: URL;
  try {
    url = new URL(entry);
  } catch {
    throw new Error(`Idenplane: invalid origin in bearerTokenOrigins: "${entry}"`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Idenplane: bearerTokenOrigins must be http(s) origins (got "${entry}")`);
  }
  if (url.username || url.password || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    throw new Error(
      `Idenplane: bearerTokenOrigins entries must be origins only, like "https://api.example.com" (got "${entry}")`,
    );
  }
  return url.origin;
}

/**
 * The set of origins the token may be sent to: the Idenplane server URL's
 * origin plus `bearerTokenOrigins`. Throws on an invalid entry.
 */
export function resolveBearerTokenOrigins(
  config: Pick<IdenplaneConfig, 'url'> & { bearerTokenOrigins?: readonly string[] },
): ReadonlySet<string> {
  const origins = new Set<string>([normalizeOrigin(new URL(config.url).origin)]);
  for (const entry of config.bearerTokenOrigins ?? []) {
    origins.add(normalizeOrigin(entry));
  }
  return origins;
}

function defaultBaseUrl(): string | undefined {
  if (typeof document !== 'undefined' && document.baseURI) return document.baseURI;
  if (typeof location !== 'undefined' && location.href) return location.href;
  return undefined;
}

/**
 * True when `requestUrl` resolves to one of `allowedOrigins`. A relative URL
 * is resolved against the page (`document.baseURI`), so it matches only when
 * the app's own origin is listed; without a page (server-side rendering) a
 * relative URL never matches. Non-http(s) URLs never match.
 */
export function shouldAttachToken(
  requestUrl: string,
  allowedOrigins: ReadonlySet<string>,
  baseUrl: string | undefined = defaultBaseUrl(),
): boolean {
  let url: URL;
  try {
    url = baseUrl === undefined ? new URL(requestUrl) : new URL(requestUrl, baseUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  return allowedOrigins.has(url.origin);
}
