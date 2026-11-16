/**
 * Client-side mirror of the server's redirect URI rules
 * (src/common/redirect-uri.utils.ts, `redirectUriListProblem`).
 *
 * Since 0.11.0 a redirect URI must match a registered one exactly
 * (RFC 9700). A trailing `/*` wildcard is only honoured for a client with
 * the insecure, legacy `allowInsecureWildcardRedirectUris` opt-in, and a
 * fragment (`#`) is never allowed. The server enforces this too; the form
 * checks it first so the administrator sees why before saving.
 */

/** Splits a one-per-line textarea value into URIs. */
export function splitLines(value: string): string[] {
  return value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** True when an entry is a `/*` wildcard. */
export function isWildcardUri(uri: string): boolean {
  return uri.endsWith('/*');
}

/** The problems with a list of redirect URIs, one message per bad entry. */
export function redirectUriProblems(uris: string[], allowWildcard: boolean): string[] {
  const problems: string[] = [];
  for (const uri of uris) {
    if (uri.includes('#')) {
      problems.push(`"${uri}" has a fragment (#); redirect URIs must not contain one.`);
      continue;
    }
    if (!uri.includes('*')) continue;
    const trailingOnly = isWildcardUri(uri) && uri.indexOf('*') === uri.length - 1;
    if (!trailingOnly) {
      problems.push(`"${uri}" contains "*". Wildcards are not supported; enter the exact URI.`);
    } else if (!allowWildcard) {
      problems.push(
        `"${uri}" is a wildcard. Redirect URIs must match exactly since 0.11.0: enter each exact callback URL.`,
      );
    }
  }
  return problems;
}
