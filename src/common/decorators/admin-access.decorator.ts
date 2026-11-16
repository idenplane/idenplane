import { SetMetadata } from '@nestjs/common';

/**
 * Admin authorization metadata, read by AdminAuthorizationGuard through
 * `resolveAdminRoutePolicy` (src/admin-rbac/admin-route-policy.ts).
 *
 * Every admin route needs a policy the resolver can work out. Most routes
 * need no decorator at all: a route with a `:realmName` or `:realm` parameter
 * is realm-scoped. A route without one must say what it is, or it is treated
 * as server-wide (super-admin only) and the fitness test fails.
 */

export const ADMIN_SCOPE_KEY = 'adminScope';
export const ADMIN_REALM_PARAM_KEY = 'adminRealmParam';
export const ADMIN_SENSITIVE_READ_KEY = 'adminSensitiveRead';

/**
 * - `global`: server-wide. Super-admin (or the admin API key) only, for
 *   reads and changes alike. Wins over any realm parameter in the path.
 * - `self`: the signed-in admin's own account (who am I, sign out). Every
 *   admin role may use it. Never put this on a route that touches anything
 *   but the caller's own account, or a list the handler filters itself.
 */
export type AdminScopeKind = 'global' | 'self';

/** Marks a controller or handler as server-wide or own-account. */
export const AdminScope = (scope: AdminScopeKind) =>
  SetMetadata(ADMIN_SCOPE_KEY, scope);

/** How a realm route parameter names its realm. */
export type AdminRealmLookup = 'name' | 'id-or-name';

export interface AdminRealmParamOptions {
  param: string;
  /**
   * `name` (the default) matches the realm name only. `id-or-name` tries
   * the realm id first and then the name, exactly like the handlers of
   * `admin/realms/:realm/auth-flows` do, so the guard checks the realm the
   * handler will act on.
   */
  lookup: AdminRealmLookup;
}

/**
 * Names the route parameter that carries the realm, when it is not
 * `:realmName` or `:realm` by name, or when it is looked up differently.
 * The parameter must be in the route path; the fitness test checks it.
 */
export const AdminRealmParam = (
  param: string,
  lookup: AdminRealmLookup = 'name',
) =>
  SetMetadata(ADMIN_REALM_PARAM_KEY, {
    param,
    lookup,
  } satisfies AdminRealmParamOptions);

/**
 * A read that reveals a secret (a client secret, an API key, a token, a
 * private key). It needs the same rights as a change, so `view-only` is
 * refused. Use it on every GET whose response carries secret material.
 */
export const AdminSensitiveRead = () =>
  SetMetadata(ADMIN_SENSITIVE_READ_KEY, true);

export const ADMIN_MFA_EXEMPT_KEY = 'adminMfaExempt';
export const RECENT_ADMIN_MFA_KEY = 'recentAdminMfa';

/**
 * Routes a password-only admin token may still reach when the admin has a
 * second factor or MFA is required for every admin (see
 * docs/docs/security/admin-mfa.md). Only on `@AdminScope('self')` routes;
 * the fitness test pins the list.
 *
 * - `always`: who am I, MFA status and step-up.
 * - `first-factor`: enrolling a factor. Open to an admin with no factor
 *   yet; an admin who has one needs a recent MFA check instead.
 */
export type AdminMfaExemption = 'always' | 'first-factor';

export const AdminMfaExempt = (exemption: AdminMfaExemption) =>
  SetMetadata(ADMIN_MFA_EXEMPT_KEY, exemption);

/**
 * The admin's second factor must have been checked within the last
 * RECENT_ADMIN_MFA_SECONDS (token `acr` at MFA level or above and a recent
 * `auth_time`). Applies to admin users; the admin API key is not a user and
 * is not affected (a route that must refuse it does so itself).
 */
export const RequireRecentAdminMfa = () =>
  SetMetadata(RECENT_ADMIN_MFA_KEY, true);
