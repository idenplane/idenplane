import apiClient from './client';
import type { ClientScope, ProtocolMapper } from '../types';

// Client Scopes CRUD
export async function getClientScopes(realmName: string): Promise<ClientScope[]> {
  const { data } = await apiClient.get<ClientScope[]>(
    `/realms/${realmName}/client-scopes`,
  );
  return data;
}

export async function getClientScopeById(
  realmName: string,
  id: string,
): Promise<ClientScope> {
  const { data } = await apiClient.get<ClientScope>(
    `/realms/${realmName}/client-scopes/${id}`,
  );
  return data;
}

export async function createClientScope(
  realmName: string,
  scope: { name: string; description?: string; protocol?: string },
): Promise<ClientScope> {
  const { data } = await apiClient.post<ClientScope>(
    `/realms/${realmName}/client-scopes`,
    scope,
  );
  return data;
}

export async function updateClientScope(
  realmName: string,
  id: string,
  scope: { name?: string; description?: string },
): Promise<ClientScope> {
  const { data } = await apiClient.put<ClientScope>(
    `/realms/${realmName}/client-scopes/${id}`,
    scope,
  );
  return data;
}

export async function deleteClientScope(
  realmName: string,
  id: string,
): Promise<void> {
  await apiClient.delete(`/realms/${realmName}/client-scopes/${id}`);
}

// Protocol Mappers
export async function addMapper(
  realmName: string,
  scopeId: string,
  mapper: { name: string; mapperType: string; config?: Record<string, unknown> },
): Promise<ProtocolMapper> {
  const { data } = await apiClient.post<ProtocolMapper>(
    `/realms/${realmName}/client-scopes/${scopeId}/protocol-mappers`,
    mapper,
  );
  return data;
}

export async function updateMapper(
  realmName: string,
  scopeId: string,
  mapperId: string,
  mapper: { name?: string; config?: Record<string, unknown> },
): Promise<ProtocolMapper> {
  const { data } = await apiClient.put<ProtocolMapper>(
    `/realms/${realmName}/client-scopes/${scopeId}/protocol-mappers/${mapperId}`,
    mapper,
  );
  return data;
}

export async function deleteMapper(
  realmName: string,
  scopeId: string,
  mapperId: string,
): Promise<void> {
  await apiClient.delete(
    `/realms/${realmName}/client-scopes/${scopeId}/protocol-mappers/${mapperId}`,
  );
}

// Client scope assignments

// The API returns join records { id, clientScopeId, clientScope: { ... } }.
// Flatten them into ClientScope objects so the UI can use scope.id / scope.name directly.
type ScopeAssignment = {
  id: string;
  clientScopeId?: string;
  clientScope?: ClientScope;
};

function flattenScopeAssignments(
  data: (ScopeAssignment | ClientScope)[],
): ClientScope[] {
  return data.map((entry) =>
    'clientScope' in entry && entry.clientScope
      ? { ...entry.clientScope, assignmentId: entry.id }
      : (entry as ClientScope),
  );
}

export async function getClientDefaultScopes(
  realmName: string,
  clientId: string,
): Promise<ClientScope[]> {
  const { data } = await apiClient.get(
    `/realms/${realmName}/clients/${clientId}/default-client-scopes`,
  );
  return flattenScopeAssignments(data);
}

export async function assignClientDefaultScope(
  realmName: string,
  clientId: string,
  scopeId: string,
): Promise<void> {
  await apiClient.post(
    `/realms/${realmName}/clients/${clientId}/default-client-scopes`,
    { clientScopeId: scopeId },
  );
}

export async function removeClientDefaultScope(
  realmName: string,
  clientId: string,
  scopeId: string,
): Promise<void> {
  await apiClient.delete(
    `/realms/${realmName}/clients/${clientId}/default-client-scopes/${scopeId}`,
  );
}

export async function getClientOptionalScopes(
  realmName: string,
  clientId: string,
): Promise<ClientScope[]> {
  const { data } = await apiClient.get(
    `/realms/${realmName}/clients/${clientId}/optional-client-scopes`,
  );
  return flattenScopeAssignments(data);
}

export async function assignClientOptionalScope(
  realmName: string,
  clientId: string,
  scopeId: string,
): Promise<void> {
  await apiClient.post(
    `/realms/${realmName}/clients/${clientId}/optional-client-scopes`,
    { clientScopeId: scopeId },
  );
}

export async function removeClientOptionalScope(
  realmName: string,
  clientId: string,
  scopeId: string,
): Promise<void> {
  await apiClient.delete(
    `/realms/${realmName}/clients/${clientId}/optional-client-scopes/${scopeId}`,
  );
}
