import apiClient from './client';

export interface LockedUser {
  id: string;
  username: string;
  email: string | null;
  lockedUntil: string;
}

export async function getLockedUsers(realmName: string): Promise<LockedUser[]> {
  const { data } = await apiClient.get<LockedUser[]>(
    `/realms/${realmName}/brute-force/locked-users`,
  );
  return data;
}
