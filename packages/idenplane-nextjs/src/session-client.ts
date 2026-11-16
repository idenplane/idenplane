/**
 * Browser helper that keeps the HttpOnly access-token cookie in step with the
 * browser SDK, through the route handlers from `idenplane-nextjs/session`.
 */

import type { IdenplaneClient } from 'idenplane-sdk';

export interface SyncSessionCookieOptions {
  /** Route that mounts `createSessionCookieHandlers` (default: "/api/auth/session"). */
  endpoint?: string;
  /** Called when storing or clearing the cookie fails. */
  onError?: (error: Error) => void;
}

type SyncableClient = Pick<IdenplaneClient, 'on' | 'getAccessToken' | 'isAuthenticated'>;

/**
 * Store the current access token in the session cookie after sign-in, after
 * a session is restored and after every token refresh, and clear it on
 * sign-out. Requests are sent one at a time, in order, so a slow earlier
 * request cannot overwrite a newer token. Returns a function that stops
 * syncing.
 *
 * @example
 * ```tsx
 * 'use client';
 * const [client] = useState(() => new IdenplaneClient({ ... }));
 * useEffect(() => syncSessionCookie(client), [client]);
 * return <AuthProvider client={client}>{children}</AuthProvider>;
 * ```
 */
export function syncSessionCookie(
  client: SyncableClient,
  options: SyncSessionCookieOptions = {},
): () => void {
  const endpoint = options.endpoint ?? '/api/auth/session';
  let queue: Promise<unknown> = Promise.resolve();
  let stopped = false;

  const send = (method: 'POST' | 'DELETE', token?: string | null) => {
    queue = queue
      .then(async () => {
        if (stopped) return;
        const res = await fetch(endpoint, {
          method,
          credentials: 'same-origin',
          cache: 'no-store',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) {
          throw new Error(`Idenplane: ${method} ${endpoint} answered ${res.status}`);
        }
      })
      .catch((err: unknown) => {
        options.onError?.(err instanceof Error ? err : new Error(String(err)));
      });
  };

  const store = () => {
    const token = client.getAccessToken();
    if (token) send('POST', token);
  };

  const unsubscribers = [
    client.on('login', store),
    client.on('tokenRefresh', store),
    client.on('ready', (authenticated) => {
      if (authenticated) store();
    }),
    client.on('logout', () => send('DELETE')),
  ];

  if (client.isAuthenticated()) store();

  return () => {
    stopped = true;
    unsubscribers.forEach((off) => off());
  };
}
