import apiClient from './client';
import type { ConsentCategory } from '../types';

// ---------------------------------------------------------------------------
// Consent Categories
// ---------------------------------------------------------------------------

export async function getConsentCategories(
  realmName: string,
  includeDisabled = false,
): Promise<ConsentCategory[]> {
  const { data } = await apiClient.get<ConsentCategory[]>(
    `/admin/realms/${realmName}/consent-categories`,
    { params: { includeDisabled } },
  );
  return data;
}

export async function getConsentCategoryById(
  realmName: string,
  categoryId: string,
): Promise<ConsentCategory> {
  const { data } = await apiClient.get<ConsentCategory>(
    `/admin/realms/${realmName}/consent-categories/${categoryId}`,
  );
  return data;
}

export async function createConsentCategory(
  realmName: string,
  category: Partial<ConsentCategory>,
): Promise<ConsentCategory> {
  const { data } = await apiClient.post<ConsentCategory>(
    `/admin/realms/${realmName}/consent-categories`,
    category,
  );
  return data;
}

export async function updateConsentCategory(
  realmName: string,
  categoryId: string,
  category: Partial<ConsentCategory>,
): Promise<ConsentCategory> {
  const { data } = await apiClient.put<ConsentCategory>(
    `/admin/realms/${realmName}/consent-categories/${categoryId}`,
    category,
  );
  return data;
}

export async function deleteConsentCategory(
  realmName: string,
  categoryId: string,
): Promise<void> {
  await apiClient.delete(`/admin/realms/${realmName}/consent-categories/${categoryId}`);
}

// ---------------------------------------------------------------------------
// User Consents
// ---------------------------------------------------------------------------

export interface UserConsent {
  id: string;
  userId: string;
  clientId: string;
  categoryId: string;
  grantedAt: string;
  grantedVia: string;
  policyVersion: string | null;
  client?: {
    id: string;
    clientId: string;
    name: string | null;
  };
  category?: {
    id: string;
    name: string;
    required: boolean;
  };
}

export interface UserConsentHistoryEntry {
  id: string;
  userId: string;
  clientId: string;
  categoryId: string;
  action: string;
  performedBy: string | null;
  performedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  policyVersion: string | null;
  client?: {
    id: string;
    clientId: string;
    name: string | null;
  };
  category?: {
    id: string;
    name: string;
    required: boolean;
  };
}

export async function getUserConsents(
  realmName: string,
  userId: string,
): Promise<UserConsent[]> {
  const { data } = await apiClient.get<UserConsent[]>(
    `/realms/${realmName}/users/${userId}/consents`,
  );
  return data;
}

export async function getUserConsentHistory(
  realmName: string,
  userId: string,
  page = 1,
  limit = 20,
): Promise<{ history: UserConsentHistoryEntry[]; total: number }> {
  const { data } = await apiClient.get<{
    history: UserConsentHistoryEntry[];
    total: number;
  }>(`/realms/${realmName}/users/${userId}/consents/history`, {
    params: { page, limit },
  });
  return data;
}

// ---------------------------------------------------------------------------
// Consent Statistics
// ---------------------------------------------------------------------------

export interface ConsentStatistics {
  totalConsents: number;
  activeUsersWithConsents24h: number;
  activeUsersWithConsents7d: number;
  activeUsersWithConsents30d: number;
  consentActionsLast24h: number;
  consentActionsLast7d: number;
  consentActionsLast30d: number;
  consentsByCategory: Array<{
    categoryId: string;
    categoryName: string;
    totalGrants: number;
  }>;
  pendingDeletions: number;
}

export interface CategoryStatistics {
  categoryId: string;
  categoryName: string;
  required: boolean;
  totalGrants: number;
  totalRevokes: number;
  grantsLast24h: number;
  grantsLast7d: number;
  grantsLast30d: number;
  activeUsers24h: number;
  activeUsers7d: number;
  activeUsers30d: number;
}

export async function getConsentStatistics(
  realmName: string,
): Promise<ConsentStatistics> {
  const { data } = await apiClient.get<ConsentStatistics>(
    `/admin/realms/${realmName}/stats/consents`,
  );
  return data;
}

export async function getCategoryStatistics(
  realmName: string,
  categoryId: string,
): Promise<CategoryStatistics> {
  const { data } = await apiClient.get<CategoryStatistics>(
    `/admin/realms/${realmName}/stats/consents/categories/${categoryId}`,
  );
  return data;
}
