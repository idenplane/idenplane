import apiClient from './client';

export type AttributeType = 'text' | 'number' | 'boolean' | 'select' | 'multi-select';

export interface CustomAttribute {
  id: string;
  realmId: string;
  name: string;
  displayName: string;
  type: AttributeType;
  required: boolean;
  showOnRegistration: boolean;
  showOnProfile: boolean;
  options: string[];
  order: number;
  minLength: number | null;
  maxLength: number | null;
  min: number | null;
  max: number | null;
  createdAt: string;
  updatedAt: string;
}

export async function getCustomAttributes(realmName: string): Promise<CustomAttribute[]> {
  const { data } = await apiClient.get<CustomAttribute[]>(
    `/realms/${realmName}/custom-attributes`,
  );
  return data;
}

export async function getCustomAttribute(realmName: string, id: string): Promise<CustomAttribute> {
  const { data } = await apiClient.get<CustomAttribute>(
    `/realms/${realmName}/custom-attributes/${id}`,
  );
  return data;
}

export async function createCustomAttribute(
  realmName: string,
  payload: Partial<CustomAttribute>,
): Promise<CustomAttribute> {
  const { data } = await apiClient.post<CustomAttribute>(
    `/realms/${realmName}/custom-attributes`,
    payload,
  );
  return data;
}

export async function updateCustomAttribute(
  realmName: string,
  id: string,
  payload: Partial<CustomAttribute>,
): Promise<CustomAttribute> {
  const { data } = await apiClient.put<CustomAttribute>(
    `/realms/${realmName}/custom-attributes/${id}`,
    payload,
  );
  return data;
}

export async function deleteCustomAttribute(realmName: string, id: string): Promise<void> {
  await apiClient.delete(`/realms/${realmName}/custom-attributes/${id}`);
}

export async function getUserAttributes(
  realmName: string,
  userId: string,
): Promise<Record<string, unknown>> {
  const { data } = await apiClient.get<Record<string, unknown>>(
    `/realms/${realmName}/users/${userId}/attributes`,
  );
  return data;
}

export async function updateUserAttributes(
  realmName: string,
  userId: string,
  attrs: Record<string, unknown>,
): Promise<void> {
  await apiClient.put(`/realms/${realmName}/users/${userId}/attributes`, {
    attributes: attrs,
  });
}
