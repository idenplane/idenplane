import apiClient from './client';
import type { User, OfflineSession } from '../types';

export async function getUsers(
  realmName: string,
  page = 1,
  limit = 20,
): Promise<{ users: User[]; total: number }> {
  const { data } = await apiClient.get<{ users: User[]; total: number }>(
    `/realms/${realmName}/users`,
    { params: { page, limit } },
  );
  return data;
}

export async function getUserById(
  realmName: string,
  id: string,
): Promise<User> {
  const { data } = await apiClient.get<User>(
    `/realms/${realmName}/users/${id}`,
  );
  return data;
}

export async function createUser(
  realmName: string,
  user: Partial<User> & { password?: string },
): Promise<User> {
  const { data } = await apiClient.post<User>(
    `/realms/${realmName}/users`,
    user,
  );
  return data;
}

export async function updateUser(
  realmName: string,
  id: string,
  user: Partial<User>,
): Promise<User> {
  const { data } = await apiClient.put<User>(
    `/realms/${realmName}/users/${id}`,
    user,
  );
  return data;
}

export async function deleteUser(
  realmName: string,
  id: string,
): Promise<void> {
  await apiClient.delete(`/realms/${realmName}/users/${id}`);
}

export async function resetPassword(
  realmName: string,
  id: string,
  password: string,
): Promise<void> {
  await apiClient.put(
    `/realms/${realmName}/users/${id}/reset-password`,
    { password },
  );
}

export async function unlockUser(
  realmName: string,
  userId: string,
): Promise<void> {
  await apiClient.post(
    `/realms/${realmName}/brute-force/users/${userId}/unlock`,
  );
}

export async function getMfaStatus(
  realmName: string,
  userId: string,
): Promise<{ enabled: boolean }> {
  const { data } = await apiClient.get<{ enabled: boolean }>(
    `/realms/${realmName}/users/${userId}/mfa/status`,
  );
  return data;
}

export async function resetMfa(
  realmName: string,
  userId: string,
): Promise<void> {
  await apiClient.delete(
    `/realms/${realmName}/users/${userId}/mfa`,
  );
}

export async function getOfflineSessions(
  realmName: string,
  userId: string,
): Promise<OfflineSession[]> {
  const { data } = await apiClient.get<OfflineSession[]>(
    `/realms/${realmName}/users/${userId}/offline-sessions`,
  );
  return data;
}

export async function revokeOfflineSession(
  realmName: string,
  userId: string,
  tokenId: string,
): Promise<void> {
  await apiClient.delete(
    `/realms/${realmName}/users/${userId}/offline-sessions/${tokenId}`,
  );
}

export interface ImpersonationResult {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
}

export async function impersonateUser(
  realmName: string,
  userId: string,
): Promise<ImpersonationResult> {
  const { data } = await apiClient.post<ImpersonationResult>(
    `/realms/${realmName}/users/${userId}/impersonate`,
  );
  return data;
}
