/**
 * Redirect URI matching (OAuth 2.0 Security BCP, RFC 9700 §2.1 and §4.1.3;
 * OAuth 2.1 §2.3.1; ASVS 5.0 V10.4.1).
 *
 * Since 0.11.0 a redirect URI must equal a registered one, character for
 * character. No normalisation is done: a different case in the scheme or
 * host, a trailing slash, a dot segment, an encoded character or a query
 * string that is not registered all fail. The one exception is the port of a
 * loopback IP redirect URI (`http://127.0.0.1:{port}/...`,
 * `http://[::1]:{port}/...`), which may be any port, because a native app
 * picks a free port at run time (RFC 8252 §7.3). `localhost` gets no such
 * exception (RFC 8252 §8.3).
 *
 * A redirect URI with a fragment is always refused (RFC 6749 §3.1.2).
 *
 * The pre-0.11.0 trailing wildcard (`https://app.example.com/*` matching any
 * path below it) still works for a client whose administrator turned on
 * `allowInsecureWildcardRedirectUris`. It is insecure: any open redirect or
 * page an attacker can influence below the registered path receives the
 * authorization code. It exists so clients registered that way keep working
 * while they are moved to exact URIs.
 */

export interface RedirectUriMatchOptions {
  /**
   * Honour registered entries ending in `/*` as path-prefix wildcards. Only
   * for a client with `allowInsecureWildcardRedirectUris` on.
   */
  allowWildcard?: boolean;
}

/** True when a registered entry is a `/*` wildcard. */
export function isWildcardRedirectUri(uri: string): boolean {
  return uri.endsWith('/*');
}

/** The registered entries that are `/*` wildcards. */
export function wildcardRedirectUris(uris: readonly string[]): string[] {
  return uris.filter(isWildcardRedirectUri);
}

/**
 * A loopback IP redirect URI split into its host and everything after the
 * port. `http` only (RFC 8252 §7.3), and only the IP literals.
 */
const LOOPBACK = /^http:\/\/(127\.0\.0\.1|\[::1\])(?::(\d{1,5}))?([/?].*)?$/;

function splitLoopback(
  uri: string,
): { host: string; port: number | null; rest: string } | null {
  const m = LOOPBACK.exec(uri);
  if (!m) return null;
  const port = m[2] === undefined ? null : Number(m[2]);
  if (port !== null && (port < 1 || port > 65535)) return null;
  return { host: m[1], port, rest: m[3] ?? '' };
}

/** RFC 8252 §7.3: the same loopback URI on any port. */
function matchesLoopback(redirectUri: string, registered: string): boolean {
  const a = splitLoopback(redirectUri);
  const b = splitLoopback(registered);
  return !!a && !!b && a.host === b.host && a.rest === b.rest;
}

/**
 * Characters that let a path look like it is below a prefix while resolving
 * elsewhere, or that a server may treat as a separator.
 */
const PATH_TRICKS = /(^|\/)\.\.?(\/|$)|%2e|%2f|%5c|\\/i;

/** The insecure, opt-in `/*` wildcard, hardened against path tricks. */
function matchesWildcard(redirectUri: string, pattern: string): boolean {
  const base = pattern.slice(0, -1); // keep the trailing '/'
  if (redirectUri === base.slice(0, -1)) return true;
  if (!redirectUri.startsWith(base)) return false;
  let candidate: URL;
  let registered: URL;
  try {
    candidate = new URL(redirectUri);
    registered = new URL(base);
  } catch {
    return false;
  }
  if (candidate.origin !== registered.origin) return false;
  if (candidate.username || candidate.password) return false;
  // Only the path: a query string may well carry an encoded `/`.
  const path = redirectUri.slice(registered.origin.length).split('?')[0];
  return !PATH_TRICKS.test(path);
}

/**
 * Whether `redirectUri` is allowed by one of the client's registered URIs.
 */
export function matchesRedirectUri(
  redirectUri: string,
  registeredUris: readonly string[],
  options: RedirectUriMatchOptions = {},
): boolean {
  if (redirectUri.includes('#')) return false;
  return registeredUris.some((pattern) => {
    if (pattern === redirectUri) return true;
    if (matchesLoopback(redirectUri, pattern)) return true;
    return (
      options.allowWildcard === true &&
      isWildcardRedirectUri(pattern) &&
      matchesWildcard(redirectUri, pattern)
    );
  });
}

/**
 * The reason a list of redirect URIs cannot be saved on a client, or null.
 * A fragment is never allowed (RFC 6749 §3.1.2). A `*` is allowed only as a
 * trailing `/*` and only when the client opts into insecure wildcards.
 */
export function redirectUriListProblem(
  field: string,
  uris: readonly string[] | undefined,
  allowWildcard: boolean,
): string | null {
  for (const uri of uris ?? []) {
    if (uri.includes('#')) {
      return `${field}: "${uri}" has a fragment; redirect URIs must not contain "#"`;
    }
    if (!uri.includes('*')) continue;
    const trailingOnly =
      isWildcardRedirectUri(uri) && uri.indexOf('*') === uri.length - 1;
    if (!trailingOnly) {
      return `${field}: "${uri}" contains "*"; only a trailing "/*" can be a wildcard, and only with allowInsecureWildcardRedirectUris`;
    }
    if (!allowWildcard) {
      return (
        `${field}: "${uri}" is a wildcard. Since 0.11.0 redirect URIs must match exactly ` +
        '(RFC 9700). Register each exact redirect URI, or set allowInsecureWildcardRedirectUris ' +
        'on this client (insecure, for migration only).'
      );
    }
  }
  return null;
}

/**
 * Forward-auth return URLs (proxy applications' `allowedRedirectUris`). Not
 * an OAuth redirect URI: no code or token is ever sent there, the browser is
 * only sent back to the page it asked for, so a `/*` entry keeps matching any
 * path below it.
 */
export function matchesReturnUrl(
  url: string,
  allowedUris: readonly string[],
): boolean {
  return allowedUris.some((pattern) => {
    if (pattern.endsWith('/*')) {
      const base = pattern.slice(0, -1);
      return url === base.slice(0, -1) || url.startsWith(base);
    }
    return pattern === url;
  });
}
