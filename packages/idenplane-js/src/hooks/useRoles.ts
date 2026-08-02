import { useCallback, useMemo } from 'react';
import { useAuthContext } from '../context.js';

/**
 * @deprecated Use usePermissions() instead.
 * Hook for role-checking helpers.
 */
export function useRoles() {
  const { client, isAuthenticated } = useAuthContext();

  const hasRealmRole = useCallback(
    (role: string) => (isAuthenticated ? client.hasRealmRole(role) : false),
    [client, isAuthenticated],
  );

  const hasClientRole = useCallback(
    (clientId: string, role: string) =>
      isAuthenticated ? client.hasClientRole(clientId, role) : false,
    [client, isAuthenticated],
  );

  const realmRoles = useMemo(
    () => (isAuthenticated ? client.getRealmRoles() : []),
    [client, isAuthenticated],
  );

  const getClientRoles = useCallback(
    (clientId: string) => (isAuthenticated ? client.getClientRoles(clientId) : []),
    [client, isAuthenticated],
  );

  return { hasRealmRole, hasClientRole, realmRoles, getClientRoles };
}
