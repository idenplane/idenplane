/**
 * What the signed-in admin may do, mirroring the server's admin policy
 * (src/admin-rbac/admin-access-policy.ts). The console only uses this to
 * hide or disable what would be refused: the server decides every request.
 */
import type { AdminMe, AdminRole } from '../api/adminAccess';

export const MASTER_REALM = 'master';

export interface AdminPermissions {
  /** False until GET /admin/auth/me has answered. */
  known: boolean;
  roles: AdminRole[];
  username: string | null;
  isApiKey: boolean;
  isSuperAdmin: boolean;
  /** Server-wide pages and actions: plugins, upgrade, system, realm create/import/export/delete, admin accounts. */
  canManageServer: boolean;
  canReadRealm: (realm: string | undefined) => boolean;
  canWriteRealm: (realm: string | undefined) => boolean;
}

/**
 * Before the server has answered, nothing is hidden: hiding would flash for
 * every super-admin, and the server refuses anything not allowed anyway.
 */
export const UNKNOWN_PERMISSIONS: AdminPermissions = {
  known: false,
  roles: [],
  username: null,
  isApiKey: false,
  isSuperAdmin: false,
  canManageServer: true,
  canReadRealm: () => true,
  canWriteRealm: () => true,
};

export function permissionsFrom(me: AdminMe): AdminPermissions {
  const isSuperAdmin = me.superAdmin || me.roles.includes('super-admin');
  const managed = new Set(
    me.roles.includes('realm-admin')
      ? me.managedRealms.filter((r) => r !== MASTER_REALM)
      : [],
  );
  const canWriteRealm = (realm: string | undefined) => {
    if (isSuperAdmin) return true;
    if (!realm || realm === MASTER_REALM) return false;
    return managed.has(realm);
  };
  return {
    known: true,
    roles: me.roles,
    username: me.username,
    isApiKey: me.kind === 'api-key',
    isSuperAdmin,
    canManageServer: isSuperAdmin,
    canReadRealm: (realm) =>
      isSuperAdmin ||
      (!!realm && (me.roles.includes('view-only') || canWriteRealm(realm))),
    canWriteRealm,
  };
}

/** A short label for the signed-in admin's strongest role. */
export function roleLabel(p: AdminPermissions): string {
  if (p.isApiKey) return 'API key';
  if (p.roles.includes('super-admin')) return 'super-admin';
  if (p.roles.includes('realm-admin') && p.roles.includes('view-only')) {
    return 'realm-admin + view-only';
  }
  if (p.roles.includes('realm-admin')) return 'realm-admin';
  if (p.roles.includes('view-only')) return 'view-only';
  return 'no admin role';
}
