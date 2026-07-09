import apiClient from './client';

export interface ServiceAccount {
  id: string;
  realmId: string;
  name: string;
  description: string | null;
  enabled: boolean;
  allowedIps: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ApiKey {
  id: string;
  serviceAccountId: string;
  name: string | null;
  keyPrefix: string | null;
  scopes: string[];
  enabled: boolean;
  revoked: boolean;
  expiresAt: string | null;
  maxRequestsPerDay: number | null;
  maxRequestsPerMonth: number | null;
  rateLimitPerMinute: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKeyCreateResult extends ApiKey {
  plainKey: string;
}

export interface CreateServiceAccountDto {
  name: string;
  description?: string;
  allowedIps?: string[];
}

export interface UpdateServiceAccountDto {
  name?: string;
  description?: string;
  allowedIps?: string[];
  enabled?: boolean;
}

export interface CreateApiKeyDto {
  name?: string;
  scopes?: string[];
  expiresAt?: string;
  maxRequestsPerDay?: number;
  maxRequestsPerMonth?: number;
  rateLimitPerMinute?: number;
}

export async function getServiceAccounts(realmName: string): Promise<ServiceAccount[]> {
  const { data } = await apiClient.get<ServiceAccount[]>(`/realms/${realmName}/service-accounts`);
  return data;
}

export async function getServiceAccount(realmName: string, accountId: string): Promise<ServiceAccount> {
  const { data } = await apiClient.get<ServiceAccount>(`/realms/${realmName}/service-accounts/${accountId}`);
  return data;
}

export async function createServiceAccount(realmName: string, dto: CreateServiceAccountDto): Promise<ServiceAccount> {
  const { data } = await apiClient.post<ServiceAccount>(`/realms/${realmName}/service-accounts`, dto);
  return data;
}

export async function updateServiceAccount(realmName: string, accountId: string, dto: UpdateServiceAccountDto): Promise<ServiceAccount> {
  const { data } = await apiClient.put<ServiceAccount>(`/realms/${realmName}/service-accounts/${accountId}`, dto);
  return data;
}

export async function deleteServiceAccount(realmName: string, accountId: string): Promise<void> {
  await apiClient.delete(`/realms/${realmName}/service-accounts/${accountId}`);
}

export async function getApiKeys(realmName: string, accountId: string): Promise<ApiKey[]> {
  const { data } = await apiClient.get<ApiKey[]>(`/realms/${realmName}/service-accounts/${accountId}/api-keys`);
  return data;
}

export async function createApiKey(realmName: string, accountId: string, dto: CreateApiKeyDto): Promise<ApiKeyCreateResult> {
  const { data } = await apiClient.post<ApiKeyCreateResult>(
    `/realms/${realmName}/service-accounts/${accountId}/api-keys`,
    dto,
  );
  return data;
}

export async function revokeApiKey(realmName: string, accountId: string, keyId: string): Promise<void> {
  await apiClient.post(`/realms/${realmName}/service-accounts/${accountId}/api-keys/${keyId}/revoke`);
}

export async function rotateApiKey(realmName: string, accountId: string, keyId: string): Promise<ApiKeyCreateResult> {
  const { data } = await apiClient.post<ApiKeyCreateResult>(
    `/realms/${realmName}/service-accounts/${accountId}/api-keys/${keyId}/rotate`,
  );
  return data;
}
