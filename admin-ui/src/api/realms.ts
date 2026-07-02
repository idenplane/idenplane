import apiClient from './client';
import type { Realm } from '../types';

export async function getAllRealms(): Promise<Realm[]> {
  const { data } = await apiClient.get<Realm[]>('/realms');
  return data;
}

export async function getRealmByName(name: string): Promise<Realm> {
  const { data } = await apiClient.get<Realm>(`/realms/${name}`);
  return data;
}

export async function createRealm(
  realm: Partial<Realm>,
): Promise<Realm> {
  const { data } = await apiClient.post<Realm>('/realms', realm);
  return data;
}

export async function updateRealm(
  name: string,
  realm: Partial<Realm>,
): Promise<Realm> {
  const { data } = await apiClient.put<Realm>(`/realms/${name}`, realm);
  return data;
}

export async function deleteRealm(name: string): Promise<void> {
  await apiClient.delete(`/realms/${name}`);
}

export async function exportRealm(
  name: string,
  options?: { includeUsers?: boolean; includeSecrets?: boolean },
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams();
  if (options?.includeUsers) params.set('includeUsers', 'true');
  if (options?.includeSecrets) params.set('includeSecrets', 'true');
  const { data } = await apiClient.get(`/realms/${name}/export?${params.toString()}`);
  return data;
}

export async function importRealm(
  payload: Record<string, unknown>,
  options?: { overwrite?: boolean },
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams();
  if (options?.overwrite) params.set('overwrite', 'true');
  const { data } = await apiClient.post(`/realms/import?${params.toString()}`, payload);
  return data;
}

export interface ThemeInfo {
  name: string;
  displayName: string;
  description: string;
  colors: {
    primaryColor: string;
    backgroundColor: string;
    cardColor: string;
    textColor: string;
    labelColor: string;
    inputBorderColor: string;
    inputBgColor: string;
    mutedColor: string;
  };
}

export async function getThemes(): Promise<ThemeInfo[]> {
  const { data } = await apiClient.get<ThemeInfo[]>('/realms/themes');
  return data;
}

export async function sendTestEmail(
  name: string,
  to: string,
): Promise<{ message: string }> {
  const { data } = await apiClient.post(`/realms/${name}/email/test`, { to });
  return data;
}

export async function testRealmSmtp(
  name: string,
): Promise<{ success: boolean; error?: string }> {
  const { data } = await apiClient.post<{ success: boolean; error?: string }>(
    `/realms/${name}/smtp/test`,
  );
  return data;
}
