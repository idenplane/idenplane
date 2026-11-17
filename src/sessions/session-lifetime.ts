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
 *
 * ## Idle timeout
 *
 * The realm's `ssoSessionIdleTimeout` (seconds, 0 = off; Keycloak's setting
 * of the same name) ends a session that is not used for that long:
 *
 * - a normal OAuth session: each refresh token is issued for at most the
 *   idle timeout, so a session whose refresh token is not used in time
 *   cannot be refreshed again. Using it issues the next token, which is the
 *   activity. The refresh grant and introspection already refuse an expired
 *   refresh token, so nothing else has to check it. Offline sessions are
 *   exempt: they exist to be used rarely.
 * - a browser SSO session (`LoginSession`): its `lastActivityAt` is checked
 *   whenever the cookie is read (`LoginService.validateLoginSession`, used by
 *   every authorization request and hosted page), and moved forward when it
 *   is used. That write is throttled (`activityWriteDue`): at most once per
 *   `ACTIVITY_WRITE_INTERVAL_SECONDS`, so a session can end up to that much
 *   sooner than the exact idle timeout, never later. The clean-up deletes
 *   idle SSO sessions too.
 *
 * Activity is recorded even while the timeout is off, so that turning it on
 * judges each session by its real last use.
 */
export interface SessionLifetimeSettings {
  /** Seconds a normal session and its refresh tokens live. */
  refreshTokenLifespan: number;
  /** Seconds an offline session and its offline tokens live. */
  offlineTokenLifespan: number;
  /**
   * Seconds a normal session may go unused before it ends; 0 or absent
   * turns the idle timeout off. Offline sessions are exempt.
   */
  ssoSessionIdleTimeout?: number;
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

/** The realm's idle timeout in seconds, or 0 when it is off. */
export function idleTimeoutSeconds(realm: {
  ssoSessionIdleTimeout?: number | null;
}): number {
  const idle = realm.ssoSessionIdleTimeout ?? 0;
  return idle > 0 ? idle : 0;
}

/**
 * When a refresh token issued at `now` expires: its kind's lifespan from
 * now, but never after the session it belongs to. A token that outlived its
 * session could not be used anyway; capping it keeps introspection honest.
 * A normal token also expires once the idle timeout passes unused.
 */
export function refreshTokenExpiresAt(
  realm: SessionLifetimeSettings,
  offline: boolean,
  sessionExpiry: Date | null | undefined,
  now: Date = new Date(),
): Date {
  const idle = offline ? 0 : idleTimeoutSeconds(realm);
  const lifespan = sessionLifespanSeconds(realm, offline);
  const seconds = idle > 0 ? Math.min(lifespan, idle) : lifespan;
  const own = now.getTime() + seconds * 1000;
  return new Date(sessionExpiry ? Math.min(own, sessionExpiry.getTime()) : own);
}

/**
 * At most how often a session's `lastActivityAt` is written. Shorter for a
 * short idle timeout, so the write never lags by more than a quarter of it.
 */
export const ACTIVITY_WRITE_INTERVAL_SECONDS = 60;

function activityWriteIntervalMs(realm: {
  ssoSessionIdleTimeout?: number | null;
}): number {
  const idle = idleTimeoutSeconds(realm);
  const seconds =
    idle > 0
      ? Math.min(ACTIVITY_WRITE_INTERVAL_SECONDS, Math.max(1, idle / 4))
      : ACTIVITY_WRITE_INTERVAL_SECONDS;
  return seconds * 1000;
}

/** Whether a session last used at `lastActivityAt` has gone idle by `now`. */
export function isIdleExpired(
  realm: { ssoSessionIdleTimeout?: number | null },
  lastActivityAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  const idle = idleTimeoutSeconds(realm);
  if (idle === 0 || !lastActivityAt) return false;
  return now.getTime() - lastActivityAt.getTime() > idle * 1000;
}

/**
 * The part of a `LoginSession` filter that leaves out sessions gone idle by
 * `now`: nothing when the idle timeout is off. For listings, counts and the
 * per-user cap, so an idle session is never shown or counted as active
 * between its end and the clean-up that deletes it.
 */
export function notIdleWhere(
  realm: { ssoSessionIdleTimeout?: number | null },
  now: Date = new Date(),
): { lastActivityAt?: { gte: Date } } {
  const idle = idleTimeoutSeconds(realm);
  return idle > 0
    ? { lastActivityAt: { gte: new Date(now.getTime() - idle * 1000) } }
    : {};
}

/**
 * Whether using a session at `now` should be written to `lastActivityAt`:
 * only when the stored value is older than the write interval, so a busy
 * session costs one write a minute, not one per request.
 */
export function activityWriteDue(
  realm: { ssoSessionIdleTimeout?: number | null },
  lastActivityAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!lastActivityAt) return true;
  return (
    now.getTime() - lastActivityAt.getTime() >= activityWriteIntervalMs(realm)
  );
}

/**
 * The oldest `lastActivityAt` a session written at `now` may have before the
 * conditional write skips it: another request already recorded the use.
 */
export function activityWriteThreshold(
  realm: { ssoSessionIdleTimeout?: number | null },
  now: Date = new Date(),
): Date {
  return new Date(now.getTime() - activityWriteIntervalMs(realm));
}
