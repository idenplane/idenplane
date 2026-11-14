import { useMemo } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { getMe } from '../api/adminAccess';
import { hasCredentials } from '../api/client';
import { useAuthContext } from '../context/AuthContext';
import {
  permissionsFrom,
  UNKNOWN_PERMISSIONS,
  type AdminPermissions,
} from '../auth/permissions';

/**
 * The signed-in admin's permissions, from GET /admin/auth/me. One request
 * per session (cached under the current credential), shared by every
 * component that asks.
 */
export function usePermissions(): AdminPermissions {
  const { token, apiKey } = useAuthContext();
  const credential = token ?? apiKey;
  const { data } = useQuery({
    queryKey: ['admin-me', credential],
    queryFn: getMe,
    enabled: credential !== null && hasCredentials(),
    staleTime: 60_000,
    retry: false,
  });
  return useMemo(
    () => (data ? permissionsFrom(data) : UNKNOWN_PERMISSIONS),
    [data],
  );
}

/**
 * Whether the signed-in admin may change the realm of the current route
 * (`/console/realms/:name/...`), or of `realm` when given.
 */
export function useCanWriteRealm(realm?: string): boolean {
  const { name } = useParams<{ name: string }>();
  return usePermissions().canWriteRealm(realm ?? name);
}
