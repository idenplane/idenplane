import apiClient from './client';

export interface Organization {
  id: string;
  realmId: string;
  slug: string;
  name: string;
  displayName: string | null;
  description: string | null;
  enabled: boolean;
  logoUrl: string | null;
  primaryColor: string | null;
  requireMfa: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrgMember {
  id: string;
  organizationId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member';
  user?: { id: string; username: string; email: string | null };
  createdAt: string;
}

export interface OrgInvitation {
  id: string;
  organizationId: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  token: string;
  expiresAt: string | null;
  acceptedAt: string | null;
  createdAt: string;
}

export async function getOrganizations(realmName: string): Promise<Organization[]> {
  const { data } = await apiClient.get<Organization[]>(`/realms/${realmName}/organizations`);
  return data;
}

export async function getOrganization(realmName: string, slug: string): Promise<Organization> {
  const { data } = await apiClient.get<Organization>(
    `/realms/${realmName}/organizations/${slug}`,
  );
  return data;
}

export async function createOrganization(
  realmName: string,
  payload: {
    slug: string;
    name: string;
    displayName?: string;
    description?: string;
    enabled?: boolean;
    logoUrl?: string;
    primaryColor?: string;
    requireMfa?: boolean;
  },
): Promise<Organization> {
  const { data } = await apiClient.post<Organization>(
    `/realms/${realmName}/organizations`,
    payload,
  );
  return data;
}

export async function updateOrganization(
  realmName: string,
  slug: string,
  payload: {
    name?: string;
    displayName?: string;
    description?: string;
    enabled?: boolean;
    logoUrl?: string;
    primaryColor?: string;
    requireMfa?: boolean;
  },
): Promise<Organization> {
  const { data } = await apiClient.put<Organization>(
    `/realms/${realmName}/organizations/${slug}`,
    payload,
  );
  return data;
}

export async function deleteOrganization(realmName: string, slug: string): Promise<void> {
  await apiClient.delete(`/realms/${realmName}/organizations/${slug}`);
}

export async function getOrgMembers(realmName: string, slug: string): Promise<OrgMember[]> {
  const { data } = await apiClient.get<OrgMember[]>(
    `/realms/${realmName}/organizations/${slug}/members`,
  );
  return data;
}

export async function addOrgMember(
  realmName: string,
  slug: string,
  payload: { userId: string; role?: 'owner' | 'admin' | 'member' },
): Promise<OrgMember> {
  const { data } = await apiClient.post<OrgMember>(
    `/realms/${realmName}/organizations/${slug}/members`,
    payload,
  );
  return data;
}

export async function updateOrgMember(
  realmName: string,
  slug: string,
  userId: string,
  payload: { role: 'owner' | 'admin' | 'member' },
): Promise<OrgMember> {
  const { data } = await apiClient.put<OrgMember>(
    `/realms/${realmName}/organizations/${slug}/members/${userId}`,
    payload,
  );
  return data;
}

export async function removeOrgMember(
  realmName: string,
  slug: string,
  userId: string,
): Promise<void> {
  await apiClient.delete(`/realms/${realmName}/organizations/${slug}/members/${userId}`);
}

export async function getOrgInvitations(
  realmName: string,
  slug: string,
): Promise<OrgInvitation[]> {
  const { data } = await apiClient.get<OrgInvitation[]>(
    `/realms/${realmName}/organizations/${slug}/invitations`,
  );
  return data;
}

export async function createOrgInvitation(
  realmName: string,
  slug: string,
  payload: { email: string; role?: 'owner' | 'admin' | 'member' },
): Promise<OrgInvitation> {
  const { data } = await apiClient.post<OrgInvitation>(
    `/realms/${realmName}/organizations/${slug}/invitations`,
    payload,
  );
  return data;
}
