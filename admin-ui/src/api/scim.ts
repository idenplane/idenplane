import apiClient from './client';

export interface ScimToken {
  id: string;
  realmId: string;
  name: string;
  tokenPrefix: string;
  enabled: boolean;
  revoked: boolean;
  expiresAt: string | null;
  scopes: string[];
  description: string | null;
  createdAt: string;
}

export interface ScimTokenCreateResult extends ScimToken {
  plainToken: string;
}

export interface ScimAttributeMapping {
  id: string;
  realmId: string;
  resourceType: string;
  scimAttribute: string;
  idenplaneAttribute: string;
  enabled: boolean;
  direction: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScimStatus {
  enabled: boolean;
  userAutocreate: boolean;
  groupSyncEnabled: boolean;
  activeTokens: number;
  totalUsers: number;
  totalGroups: number;
}

export async function getScimTokens(realmName: string): Promise<ScimToken[]> {
  const { data } = await apiClient.get<ScimToken[]>(
    `/realms/${realmName}/scim/tokens`,
  );
  return data;
}

export async function createScimToken(
  realmName: string,
  payload: {
    name: string;
    description?: string;
    expiresAt?: string;
    scopes?: string[];
  },
): Promise<ScimTokenCreateResult> {
  const { data } = await apiClient.post<ScimTokenCreateResult>(
    `/realms/${realmName}/scim/tokens`,
    payload,
  );
  return data;
}

export async function deleteScimToken(realmName: string, tokenId: string): Promise<void> {
  await apiClient.delete(`/realms/${realmName}/scim/tokens/${tokenId}`);
}

export async function revokeScimToken(realmName: string, tokenId: string): Promise<void> {
  await apiClient.put(`/realms/${realmName}/scim/tokens/${tokenId}/revoke`);
}

export async function enableScimToken(realmName: string, tokenId: string): Promise<void> {
  await apiClient.put(`/realms/${realmName}/scim/tokens/${tokenId}/enable`);
}

export async function disableScimToken(realmName: string, tokenId: string): Promise<void> {
  await apiClient.put(`/realms/${realmName}/scim/tokens/${tokenId}/disable`);
}

export async function getScimAttributeMappings(realmName: string): Promise<ScimAttributeMapping[]> {
  const { data } = await apiClient.get<ScimAttributeMapping[]>(
    `/realms/${realmName}/scim/attribute-mappings`,
  );
  return data;
}

export async function createScimAttributeMapping(
  realmName: string,
  payload: {
    resourceType: string;
    scimAttribute: string;
    idenplaneAttribute: string;
    direction?: string;
  },
): Promise<ScimAttributeMapping> {
  const { data } = await apiClient.post<ScimAttributeMapping>(
    `/realms/${realmName}/scim/attribute-mappings`,
    payload,
  );
  return data;
}

export async function deleteScimAttributeMapping(
  realmName: string,
  mappingId: string,
): Promise<void> {
  await apiClient.delete(`/realms/${realmName}/scim/attribute-mappings/${mappingId}`);
}

export async function getScimStatus(realmName: string): Promise<ScimStatus> {
  const { data } = await apiClient.get<ScimStatus>(
    `/realms/${realmName}/scim/status`,
  );
  return data;
}
