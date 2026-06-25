import apiClient from './client';

export interface AuthPolicy {
  id: string;
  realmId: string;
  name: string;
  description: string | null;
  effect: 'allow' | 'deny';
  conditions: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function getPolicies(realmName: string): Promise<AuthPolicy[]> {
  const { data } = await apiClient.get<AuthPolicy[]>(
    `/realms/${realmName}/policies`,
  );
  return data;
}

export async function getPolicy(realmName: string, id: string): Promise<AuthPolicy> {
  const { data } = await apiClient.get<AuthPolicy>(
    `/realms/${realmName}/policies/${id}`,
  );
  return data;
}

export async function createPolicy(
  realmName: string,
  payload: Partial<AuthPolicy>,
): Promise<AuthPolicy> {
  const { data } = await apiClient.post<AuthPolicy>(
    `/realms/${realmName}/policies`,
    payload,
  );
  return data;
}

export async function updatePolicy(
  realmName: string,
  id: string,
  payload: Partial<AuthPolicy>,
): Promise<AuthPolicy> {
  const { data } = await apiClient.put<AuthPolicy>(
    `/realms/${realmName}/policies/${id}`,
    payload,
  );
  return data;
}

export async function deletePolicy(realmName: string, id: string): Promise<void> {
  await apiClient.delete(`/realms/${realmName}/policies/${id}`);
}

export async function evaluatePolicy(
  realmName: string,
  context: Record<string, unknown>,
): Promise<unknown> {
  const { data } = await apiClient.post<unknown>(
    `/realms/${realmName}/policies/evaluate`,
    context,
  );
  return data;
}

export async function testPolicy(
  realmName: string,
  id: string,
  context: Record<string, unknown>,
): Promise<unknown> {
  const { data } = await apiClient.post<unknown>(
    `/realms/${realmName}/policies/${id}/test`,
    context,
  );
  return data;
}
