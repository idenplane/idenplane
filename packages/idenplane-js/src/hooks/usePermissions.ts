import { useCallback, useMemo } from 'react';
import { useAuthContext } from '../context.js';

/**
 * Hook for permissions and role-checking helpers.
 *
 * ```tsx
 * const { hasRole, hasPermission, roles } = usePermissions();
 * if (hasRole('admin')) { ... }
 * if (hasPermission('read:reports')) { ... }
 * ```
 */
export function usePermissions() {
  const { client, isAuthenticated } = useAuthContext();

  const hasRole = useCallback(
    (role: string) => (isAuthenticated ? client.hasRealmRole(role) : false),
    [client, isAuthenticated],
  );

  const hasPermission = useCallback(
    (permission: string) => (isAuthenticated ? client.hasPermission(permission) : false),
    [client, isAuthenticated],
  );

  const roles = useMemo(
    () => (isAuthenticated ? client.getRealmRoles() : []),
    [client, isAuthenticated],
  );

  return { hasRole, hasPermission, roles };
}
