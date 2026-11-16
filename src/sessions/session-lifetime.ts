/**
 * How long an OAuth session and its refresh tokens live.
 *
 * A session is one of two kinds, fixed when it is created:
 *
 * - a normal session lives for the realm's `refreshTokenLifespan`, counted
 *   from sign-in;
 * - an offline session (one created by a grant that was given
 *   `offline_access`) lives for the realm's `offlineTokenLifespan`, counted
 *   from sign-in. The realm has no separate idle timeout for offline
 *   sessions: each rotated offline token is valid for the offline lifespan,
 *   capped at the session's own expiry.
 *
 * The kind is not stored on the session: the session's `expiresAt` already
 * carries the lifetime, and whether its tokens are offline is recorded on
 * each refresh token (`isOffline`). The refresh grant can never turn a normal
 * session into an offline one or back, because `offline_access` is only
 * granted when the session is created (or kept when an offline token is
 * refreshed).
 *
 * The hourly clean-up deletes sessions by `expiresAt` alone, so getting
 * `expiresAt` right here is what keeps an offline session alive for its
 * lifetime. The refresh grant also checks `expiresAt` itself, so a session
 * ends on time and not at the next clean-up run.
 */
export interface SessionLifetimeSettings {
  /** Seconds a normal session and its refresh tokens live. */
  refreshTokenLifespan: number;
  /** Seconds an offline session and its offline tokens live. */
  offlineTokenLifespan: number;
}

/** The lifespan, in seconds, of a session of the given kind. */
export function sessionLifespanSeconds(
  realm: SessionLifetimeSettings,
  offline: boolean,
): number {
  return offline ? realm.offlineTokenLifespan : realm.refreshTokenLifespan;
}

/** When a session of the given kind, started at `createdAt`, expires. */
export function sessionExpiresAt(
  realm: SessionLifetimeSettings,
  offline: boolean,
  createdAt: Date,
): Date {
  return new Date(
    createdAt.getTime() + sessionLifespanSeconds(realm, offline) * 1000,
  );
}

/**
 * When a refresh token issued at `now` expires: its kind's lifespan from
 * now, but never after the session it belongs to. A token that outlived its
 * session could not be used anyway; capping it keeps introspection honest.
 */
export function refreshTokenExpiresAt(
  realm: SessionLifetimeSettings,
  offline: boolean,
  sessionExpiry: Date | null | undefined,
  now: Date = new Date(),
): Date {
  const own = now.getTime() + sessionLifespanSeconds(realm, offline) * 1000;
  return new Date(sessionExpiry ? Math.min(own, sessionExpiry.getTime()) : own);
}
