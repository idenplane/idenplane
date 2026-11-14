/**
 * Request URLs as they may be logged: secrets that travel in a URL are
 * replaced with `[REDACTED]`. Plain string scanning only, so a hostile URL
 * cannot make the logger slow (no regular expressions).
 *
 * - Query parameters whose name is a known secret (`token`, `code`,
 *   `client_secret`, `SAMLResponse`, ...) keep their name, lose their value.
 * - Path segments that are secrets: the invitation token in
 *   `/organizations/{slug}/invitations/{token}/accept`.
 */

const REDACTED = '[REDACTED]';

/** Query parameter names whose values are secrets (compared lowercased). */
const SECRET_QUERY_PARAMS: ReadonlySet<string> = new Set([
  'token',
  'code',
  'user_code',
  'device_code',
  'access_token',
  'id_token',
  'refresh_token',
  'id_token_hint',
  'logout_token',
  'client_secret',
  'client_assertion',
  'password',
  'secret',
  'key',
  'otp',
  'samlrequest',
  'samlresponse',
  'request',
  'state',
  'nonce',
  'code_verifier',
  'assertion',
  'mfa_token',
  'session_state',
]);

/** In `/<before>/{secret}/<after>`, the segment between them is a secret. */
const SECRET_PATH_SEGMENTS: ReadonlyArray<{ before: string; after: string }> = [
  { before: 'invitations', after: 'accept' },
];

function redactPath(path: string): string {
  const segments = path.split('/');
  for (let i = 1; i < segments.length - 1; i++) {
    for (const { before, after } of SECRET_PATH_SEGMENTS) {
      if (
        segments[i - 1] === before &&
        segments[i + 1] === after &&
        segments[i] !== ''
      ) {
        segments[i] = REDACTED;
      }
    }
  }
  return segments.join('/');
}

function redactQuery(query: string): string {
  return query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq < 0) return pair;
      let name = pair.slice(0, eq);
      try {
        name = decodeURIComponent(name);
      } catch {
        // A malformed name is logged as sent; its value is still checked.
      }
      return SECRET_QUERY_PARAMS.has(name.toLowerCase())
        ? `${pair.slice(0, eq)}=${REDACTED}`
        : pair;
    })
    .join('&');
}

/** `url` (path plus optional query) with every secret replaced. */
export function redactUrl(url: string | undefined): string | undefined {
  if (typeof url !== 'string') return url;
  const q = url.indexOf('?');
  const path = q < 0 ? url : url.slice(0, q);
  const query = q < 0 ? undefined : url.slice(q + 1);
  const safePath = redactPath(path);
  return query === undefined ? safePath : `${safePath}?${redactQuery(query)}`;
}
