import apiClient from './client';

export type AdminRole = 'super-admin' | 'realm-admin' | 'view-only';

/** GET /admin/auth/me: the signed-in admin as the server authorizes it. */
export interface AdminMe {
  userId: string;
  username: string | null;
  kind: 'user' | 'api-key';
  roles: AdminRole[];
  superAdmin: boolean;
  /** Reads every realm (super-admin or view-only). */
  readAllRealms: boolean;
  /** Changes every realm and runs server-wide operations. */
  writeAllRealms: boolean;
  /** Realms managed as a realm-admin. */
  managedRealms: string[];
}

export async function getMe(): Promise<AdminMe> {
  const { data } = await apiClient.get<AdminMe>('/auth/me');
  return data;
}

/** A master realm admin, as GET /admin/admin-accounts lists it. */
export interface AdminAccount {
  id: string;
  username: string;
  email: string | null;
  enabled: boolean;
  roles: AdminRole[];
  realms: string[];
}

export async function listAdminAccounts(): Promise<AdminAccount[]> {
  const { data } = await apiClient.get<AdminAccount[]>('/admin-accounts');
  return data;
}

export async function setAdminRealms(
  userId: string,
  realms: string[],
): Promise<{ realms: string[] }> {
  const { data } = await apiClient.put<{ realms: string[] }>(
    `/admin-accounts/${encodeURIComponent(userId)}/realms`,
    { realms },
  );
  return data;
}
