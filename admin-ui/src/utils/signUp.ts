/** Characters a realm path segment may hold (unreserved, RFC 3986 §2.3). */
const REALM_CHARS = new Set(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~',
);

/**
 * The server's hosted sign-up page for a realm, carrying the query string
 * (`client_id`, `redirect_uri`, ... are passed on to the page), or `null`
 * when the realm name could not be a realm. Always a same-origin path.
 */
export function hostedSignUpUrl(realm: string | undefined, search: string): string | null {
  if (!realm || realm === '.' || realm === '..' || realm.length > 255) return null;
  for (const ch of realm) {
    if (!REALM_CHARS.has(ch)) return null;
  }
  const query = search.startsWith('?') && search.length > 1 ? search : '';
  return `/realms/${encodeURIComponent(realm)}/register${query}`;
}
