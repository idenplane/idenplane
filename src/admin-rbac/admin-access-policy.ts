import type { AdminRolesOptions } from '../common/decorators/require-admin-roles.decorator.js';
import type { AdminRoutePolicy } from './admin-route-policy.js';

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
