import { rootClient } from './client';

export interface RegistrationField {
  id: string;
  realmId: string;
  name: string;
  displayName: string;
  type: string;
  required: boolean;
  placeholder?: string;
  helpText?: string;
  options: string[];
  validationPattern?: string;
  defaultValue?: string;
  sortOrder: number;
  enabled: boolean;
}

export interface PendingRegistration {
  id: string;
  username: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  enabled: boolean;
  createdAt: string;
  attributes: Record<string, string>;
}

export async function getPendingRegistrations(
  realmName: string,
  skip = 0,
  take = 20,
): Promise<{ users: PendingRegistration[]; total: number }> {
  const { data } = await rootClient.get<{ users: PendingRegistration[]; total: number }>(
    `/realms/${realmName}/registration/pending`,
    { params: { skip, take } },
  );
  return data;
}

export async function approveRegistration(
  realmName: string,
  userId: string,
  note?: string,
): Promise<{ success: boolean; note?: string }> {
  const { data } = await rootClient.post<{ success: boolean; note?: string }>(
    `/realms/${realmName}/registration/approve/${userId}`,
    { note },
  );
  return data;
}

export async function rejectRegistration(
  realmName: string,
  userId: string,
  reason?: string,
): Promise<{ success: boolean }> {
  const { data } = await rootClient.post<{ success: boolean }>(
    `/realms/${realmName}/registration/reject/${userId}`,
    { reason },
  );
  return data;
}

export async function getRegistrationFields(realmName: string): Promise<RegistrationField[]> {
  const { data } = await rootClient.get<RegistrationField[]>(
    `/realms/${realmName}/registration/admin/fields`,
  );
  return data;
}

export async function createRegistrationField(
  realmName: string,
  field: Partial<RegistrationField>,
): Promise<RegistrationField> {
  const { data } = await rootClient.post<RegistrationField>(
    `/realms/${realmName}/registration/admin/fields`,
    field,
  );
  return data;
}

export async function updateRegistrationField(
  realmName: string,
  fieldId: string,
  field: Partial<RegistrationField>,
): Promise<RegistrationField> {
  const { data } = await rootClient.put<RegistrationField>(
    `/realms/${realmName}/registration/admin/fields/${fieldId}`,
    field,
  );
  return data;
}

export async function deleteRegistrationField(
  realmName: string,
  fieldId: string,
): Promise<void> {
  await rootClient.delete(`/realms/${realmName}/registration/admin/fields/${fieldId}`);
}

export async function getPublicRegistrationFields(realmName: string): Promise<Partial<RegistrationField>[]> {
  const { data } = await rootClient.get<Partial<RegistrationField>[]>(
    `/realms/${realmName}/registration/fields`,
  );
  return data;
}