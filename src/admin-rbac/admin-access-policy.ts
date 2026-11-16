import type { AdminRolesOptions } from '../common/decorators/require-admin-roles.decorator.js';
import type { AdminRoutePolicy } from './admin-route-policy.js';
import { ACR_MFA, ACR_PASSWORD, satisfiesAcr } from '../authn-core/acr.js';

export const SUPER_ADMIN = 'super-admin';
export const REALM_ADMIN = 'realm-admin';
export const VIEW_ONLY = 'view-only';

/** The admin roles, from most to least powerful. */
export const ADMIN_ROLES = [SUPER_ADMIN, REALM_ADMIN, VIEW_ONLY] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** The realm that holds the admin accounts. Never in a realm-admin's scope. */
export const MASTER_REALM = 'master';

/**
 * Who is calling, as the authorization step sees it. Built per request from
 * the database (roles and realm assignments), not from the token.
 */
export interface AdminPrincipal {
  /** `api-key`: the static admin API key or a session minted from it. */
  kind: 'user' | 'api-key';
  userId: string;
  username: string | null;
  /** Admin roles only (`super-admin`, `realm-admin`, `view-only`). */
  roles: AdminRole[];
  /**
   * Ids of the realms this admin may manage as a `realm-admin`. Never
   * contains the master realm. Empty for an unscoped realm-admin, who then
   * manages no realm at all.
   */
  realmIds: ReadonlySet<string>;
  /**
   * The admin has a console second factor: a verified TOTP or a passkey.
   * Always false for the API key.
   */
  mfaEnrolled?: boolean;
}

export type AdminAccess = 'read' | 'write';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** GET, HEAD and OPTIONS read; every other method (and `ALL`) changes. */
export function accessForMethod(
  method: string,
  policy: Pick<AdminRoutePolicy, 'sensitiveRead'>,
): AdminAccess {
  if (policy.sensitiveRead) return 'write';
  return READ_METHODS.has(method.toUpperCase()) ? 'read' : 'write';
}

export function isAdminRole(role: string): role is AdminRole {
  return (ADMIN_ROLES as readonly string[]).includes(role);
}

/** `super-admin` passes every role check, as AdminAuthService.hasRole does. */
export function hasAdminRole(roles: readonly string[], required: string) {
  return roles.includes(SUPER_ADMIN) || roles.includes(required);
}

/** Whether the roles satisfy one `@RequireAdminRoles(...)`. */
export function satisfiesRequiredRoles(
  roles: readonly string[],
  options: AdminRolesOptions,
): boolean {
  return options.requireAll
    ? options.roles.every((r) => hasAdminRole(roles, r))
    : options.roles.some((r) => hasAdminRole(roles, r));
}

/**
 * The realm a realm-scoped request acts on, as the guard resolved it.
 * `null` id: the realm does not exist.
 */
export interface ResolvedRealm {
  id: string | null;
  name: string | null;
}

export function isSuperAdmin(principal: AdminPrincipal): boolean {
  return principal.roles.includes(SUPER_ADMIN);
}

/** May this admin read this realm's configuration and data? */
export function canReadRealm(
  principal: AdminPrincipal,
  realm: ResolvedRealm,
): boolean {
  if (isSuperAdmin(principal)) return true;
  if (realm.id === null) return false;
  if (principal.roles.includes(VIEW_ONLY)) return true;
  return canWriteRealm(principal, realm);
}

/** May this admin change this realm? */
export function canWriteRealm(
  principal: AdminPrincipal,
  realm: ResolvedRealm,
): boolean {
  if (isSuperAdmin(principal)) return true;
  if (realm.id === null || realm.name === MASTER_REALM) return false;
  return (
    principal.roles.includes(REALM_ADMIN) && principal.realmIds.has(realm.id)
  );
}

export type AdminDecision =
  { allowed: true } | { allowed: false; reason: string };

const ALLOW: AdminDecision = { allowed: true };

/**
 * The default policy. Pure: the guard resolves the principal and the realm,
 * this decides. `realm` is required for realm-scoped routes; when it is
 * missing the request is refused.
 */
export function decideAdminAccess(
  principal: AdminPrincipal,
  policy: AdminRoutePolicy,
  access: AdminAccess,
  realm: ResolvedRealm | null,
): AdminDecision {
  if (principal.roles.length === 0) {
    return { allowed: false, reason: 'no admin role' };
  }
  for (const required of policy.requiredRoles) {
    if (!satisfiesRequiredRoles(principal.roles, required)) {
      return {
        allowed: false,
        reason: `requires ${required.roles.join(required.requireAll ? ' and ' : ' or ')}`,
      };
    }
  }

  switch (policy.scope.kind) {
    case 'self':
      return ALLOW;
    case 'global':
      return isSuperAdmin(principal)
        ? ALLOW
        : { allowed: false, reason: 'server-wide route: super-admin only' };
    case 'realm': {
      if (isSuperAdmin(principal)) return ALLOW;
      if (!realm) return { allowed: false, reason: 'realm not resolved' };
      const ok =
        access === 'read'
          ? canReadRealm(principal, realm)
          : canWriteRealm(principal, realm);
      return ok
        ? ALLOW
        : {
            allowed: false,
            reason:
              access === 'read'
                ? 'realm not in scope'
                : 'no change rights in this realm',
          };
    }
  }
}

// ─── Admin console MFA ──────────────────────────────────────────────────

/** How long a second-factor check counts as recent (step-up), in seconds. */
export const RECENT_ADMIN_MFA_SECONDS = 15 * 60;

/** The machine-readable reason an admin request was refused for MFA. */
export type AdminMfaRefusal =
  /** MFA is required and the admin has no factor: enrol one. */
  | 'admin_mfa_enrolment_required'
  /** The admin has a factor but the token is password-only: step up. */
  | 'admin_mfa_step_up_required'
  /** The route needs a second factor checked in the last 15 minutes. */
  | 'admin_recent_mfa_required';

/** What the console shows for each refusal; `code` is what it acts on. */
export const ADMIN_MFA_REFUSAL_MESSAGES: Record<AdminMfaRefusal, string> = {
  admin_mfa_enrolment_required:
    'Set up a second factor (authenticator app or passkey) to use the admin console',
  admin_mfa_step_up_required:
    'Verify your second factor to continue: this session was signed in with a password only',
  admin_recent_mfa_required:
    'This action needs your second factor verified in the last 15 minutes',
};

export interface AdminMfaContext {
  /** The token records a second factor (`acr` at MFA level or above). */
  tokenMfa: boolean;
  /** The token's `auth_time`, in seconds. */
  authTime?: number;
  /** Now, in seconds. */
  now: number;
  /** The admin has a factor now (from the database). */
  enrolled: boolean;
  /** MFA is required for every admin (setting or ADMIN_MFA_REQUIRED). */
  required: boolean;
}

/**
 * Admin console MFA, for an admin user (never the API key). Pure: the guard
 * reads the token, the factors and the setting; this decides. `null`
 * allows the request.
 *
 * 1. MFA required and no factor: only exempt routes (`always` and
 *    `first-factor`) until a factor is enrolled, whatever the token says
 *    (so an MFA reset confines the admin at once).
 * 2. A password-only token of an admin who has a factor (issued before the
 *    upgrade or before enrolment): only `always` routes, to step up.
 * 3. `@RequireRecentAdminMfa()`, and adding a factor when the admin has
 *    one, need a second factor checked within RECENT_ADMIN_MFA_SECONDS.
 */
export function decideAdminMfa(
  ctx: AdminMfaContext,
  policy: Pick<AdminRoutePolicy, 'mfaExempt' | 'recentMfa'>,
): AdminMfaRefusal | null {
  if (ctx.required && !ctx.enrolled) {
    return policy.mfaExempt ? null : 'admin_mfa_enrolment_required';
  }
  if (!ctx.tokenMfa && ctx.enrolled && policy.mfaExempt !== 'always') {
    return 'admin_mfa_step_up_required';
  }
  const needsRecent =
    policy.recentMfa || (policy.mfaExempt === 'first-factor' && ctx.enrolled);
  if (!needsRecent) return null;
  const recent =
    ctx.tokenMfa &&
    typeof ctx.authTime === 'number' &&
    ctx.authTime >= ctx.now - RECENT_ADMIN_MFA_SECONDS &&
    ctx.authTime <= ctx.now + 60;
  return recent ? null : 'admin_recent_mfa_required';
}

/**
 * Whether an admin token records a second factor checked within
 * RECENT_ADMIN_MFA_SECONDS: the console's step-up. Never true for the API
 * key, which has no second factor.
 */
export function hasRecentAdminMfa(
  admin: { userId: string; acr?: string; authTime?: number } | undefined,
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!admin || admin.userId.startsWith('api-key:')) return false;
  return (
    decideAdminMfa(
      {
        tokenMfa: satisfiesAcr(admin.acr ?? ACR_PASSWORD, ACR_MFA),
        authTime: admin.authTime,
        now,
        enrolled: false,
        required: false,
      },
      { mfaExempt: null, recentMfa: true },
    ) === null
  );
}
