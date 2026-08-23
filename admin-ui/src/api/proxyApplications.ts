import apiClient from './client';
import type {
  ProxyApplicationView,
  CreateProxyApplicationInput,
  UpdateProxyApplicationInput,
} from '../types';

export async function getProxyApplications(
  realmName: string,
): Promise<ProxyApplicationView[]> {
  const { data } = await apiClient.get<ProxyApplicationView[]>(
    `/realms/${realmName}/proxy-applications`,
  );
  return data;
}

export async function getProxyApplication(
  realmName: string,
  slug: string,
): Promise<ProxyApplicationView> {
  const { data } = await apiClient.get<ProxyApplicationView>(
    `/realms/${realmName}/proxy-applications/${slug}`,
  );
  return data;
}

export async function createProxyApplication(
  realmName: string,
  input: CreateProxyApplicationInput,
): Promise<ProxyApplicationView> {
  const { data } = await apiClient.post<ProxyApplicationView>(
    `/realms/${realmName}/proxy-applications`,
    input,
  );
  return data;
}

export async function updateProxyApplication(
  realmName: string,
  slug: string,
  input: UpdateProxyApplicationInput,
): Promise<ProxyApplicationView> {
  const { data } = await apiClient.put<ProxyApplicationView>(
    `/realms/${realmName}/proxy-applications/${slug}`,
    input,
  );
  return data;
}

export async function deleteProxyApplication(
  realmName: string,
  slug: string,
): Promise<void> {
  await apiClient.delete(`/realms/${realmName}/proxy-applications/${slug}`);
}

export async function revokeProxyApplicationSessions(
  realmName: string,
  slug: string,
): Promise<{ revoked: number }> {
  const { data } = await apiClient.post<{ revoked: number }>(
    `/realms/${realmName}/proxy-applications/${slug}/revoke-sessions`,
  );
  return data;
}
