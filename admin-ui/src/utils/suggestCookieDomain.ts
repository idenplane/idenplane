/**
 * Suggest a proxy-session cookie domain from an application's redirect URI:
 * `https://grafana.example.com/*` → `.example.com`.
 *
 * Only a suggestion — the field stays editable — but getting this wrong is the
 * most expensive mistake on the create form. A cookie domain that does not
 * cover the application's host means the browser never sends the session
 * cookie, so the user bounces between the app and login forever, with no error
 * in any log. The server rejects it; offering a correct default means most
 * admins never reach that rejection.
 *
 * Returns an empty string for anything that is not an absolute URL, rather than
 * guessing from a fragment.
 */
export function suggestCookieDomain(redirectUri: string): string {
  let host: string;
  try {
    host = new URL(redirectUri.replace(/\/\*$/, '/')).hostname;
  } catch {
    return '';
  }

  const labels = host.split('.');
  // A bare host (localhost) or an apex domain (example.com) is its own scope;
  // anything deeper shares the registrable parent, which is what lets one
  // cookie reach both Idenplane and the protected application.
  if (labels.length <= 2) return host;
  return `.${labels.slice(-2).join('.')}`;
}
