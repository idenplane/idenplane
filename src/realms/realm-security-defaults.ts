/**
 * Security-relevant defaults for a NEW realm.
 *
 * Every path that creates a realm (admin API, realm import, the setup wizard,
 * the first-boot `master` seed) writes these values explicitly. The same
 * values are also the column defaults in prisma/schema.prisma, so a realm
 * inserted any other way gets them too. Keep the two in step:
 * realm-security-defaults.spec.ts reads the schema and fails when they drift.
 *
 * Existing realms are never changed by a new default. An upgrade only changes
 * the column default; the values stored on existing rows stay as they were.
 *
 * Brute-force protection: why these numbers
 * -----------------------------------------
 * A per-account lockout is a trade-off. It caps online password guessing,
 * but anyone who knows a username can also use it to keep that account
 * locked (a lockout denial of service). The defaults are chosen to keep both
 * sides small:
 *
 * - 10 failures (`maxLoginFailures`) inside 15 minutes (`failureResetTime`)
 *   lock the account. Ten is well under NIST SP 800-63B's limit of 100, and
 *   high enough that a user mistyping a password does not lock themselves out.
 * - The lock is temporary: 5 minutes (`lockoutDuration`). It ends by itself,
 *   so an attacker has to keep sending requests to keep a user out, and the
 *   user, an admin or the per-IP rate limits can see that happening.
 * - The lockout is progressive. The failures stay counted for the whole
 *   15-minute window, so a wrong password right after the lock ends locks the
 *   account again at once. After the first 10 guesses an attacker gets about
 *   one guess per 5 minutes per account (about 300 a day), not 10.
 * - There is no permanent lockout (`permanentLockoutAfter = 0`). Permanent
 *   lockout disables the account, which hands an attacker a way to switch off
 *   any account (including an administrator's) for good. It stays available
 *   as an opt-in.
 * - While an account is locked the password is not checked at all, and the
 *   response is the same whether the password was right or wrong, so a locked
 *   account cannot be used to test passwords.
 */
export const REALM_BRUTE_FORCE_DEFAULTS = {
  bruteForceEnabled: true,
  maxLoginFailures: 10,
  lockoutDuration: 300,
  failureResetTime: 900,
  permanentLockoutAfter: 0,
} as const;

/**
 * Audit events. Recording sign-in and admin events is what lets an operator
 * see an attack (and a lockout) at all; retention is bounded by
 * `loginEventRetentionDays` (30) and `adminEventRetentionDays` (90).
 */
export const REALM_EVENT_DEFAULTS = {
  eventsEnabled: true,
  adminEventsEnabled: true,
} as const;

/** All security defaults a new realm is created with. */
export const NEW_REALM_SECURITY_DEFAULTS = {
  ...REALM_BRUTE_FORCE_DEFAULTS,
  ...REALM_EVENT_DEFAULTS,
} as const;
