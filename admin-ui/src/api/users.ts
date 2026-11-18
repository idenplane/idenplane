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

export type MfaMethod = 'totp' | 'sms';

export interface MfaStatus {
  enabled: boolean;
  methods?: MfaMethod[];
  /** Passkeys (WebAuthn credentials), counted apart from the second factors. */
  passkeys?: number;
}

export async function getMfaStatus(
  realmName: string,
  userId: string,
): Promise<MfaStatus> {
  const { data } = await apiClient.get<MfaStatus>(
    `/realms/${realmName}/users/${userId}/mfa/status`,
  );
  return data;
}

/** Remove only the user's SMS phone (keeps an authenticator app). */
export async function resetSmsMfa(
  realmName: string,
  userId: string,
): Promise<void> {
  await apiClient.delete(`/realms/${realmName}/users/${userId}/mfa/sms`);
}

/**
 * Full MFA reset: second factors, recovery codes and, unless `keepPasskeys`,
 * the user's passkeys.
 */
export async function resetMfa(
  realmName: string,
  userId: string,
  options: { keepPasskeys?: boolean } = {},
): Promise<void> {
  await apiClient.delete(`/realms/${realmName}/users/${userId}/mfa`, {
    params: options.keepPasskeys ? { keepPasskeys: 'true' } : undefined,
  });
}

export interface UserPasskey {
  id: string;
  friendlyName: string | null;
  deviceType: string;
  backedUp: boolean;
  transports: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

export async function getPasskeys(
  realmName: string,
  userId: string,
): Promise<UserPasskey[]> {
  const { data } = await apiClient.get<UserPasskey[]>(
    `/realms/${realmName}/users/${userId}/mfa/passkeys`,
  );
  return data;
}

export async function removePasskey(
  realmName: string,
  userId: string,
  credentialId: string,
): Promise<void> {
  await apiClient.delete(
    `/realms/${realmName}/users/${userId}/mfa/passkeys/${encodeURIComponent(credentialId)}`,
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
