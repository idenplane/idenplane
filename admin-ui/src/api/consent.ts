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
    `/realms/${realmName}/consent-categories`,
    { params: { includeDisabled } },
  );
  return data;
}

export async function getConsentCategoryById(
  realmName: string,
  categoryId: string,
): Promise<ConsentCategory> {
  const { data } = await apiClient.get<ConsentCategory>(
    `/realms/${realmName}/consent-categories/${categoryId}`,
  );
  return data;
}

export async function createConsentCategory(
  realmName: string,
  category: Partial<ConsentCategory>,
): Promise<ConsentCategory> {
  const { data } = await apiClient.post<ConsentCategory>(
    `/realms/${realmName}/consent-categories`,
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
    `/realms/${realmName}/consent-categories/${categoryId}`,
    category,
  );
  return data;
}

export async function deleteConsentCategory(
  realmName: string,
  categoryId: string,
): Promise<void> {
  await apiClient.delete(`/realms/${realmName}/consent-categories/${categoryId}`);
}

// ---------------------------------------------------------------------------
// User Consents
// ---------------------------------------------------------------------------

// A consent is an OAuth scope grant per client (no GDPR-category link); the
// shape mirrors users.service.getUserConsents exactly.
export interface UserConsent {
  id: string;
  clientId: string;
  clientName: string;
  scopes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UserConsentHistoryEntry {
  id: string;
  clientId: string;
  clientName: string;
  action: string;
  scopes: string[];
  policyVersion: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
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

export interface UserConsentHistoryResponse {
  history: UserConsentHistoryEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export async function getUserConsentHistory(
  realmName: string,
  userId: string,
  page = 1,
  limit = 20,
): Promise<UserConsentHistoryResponse> {
  const { data } = await apiClient.get<UserConsentHistoryResponse>(
    `/realms/${realmName}/users/${userId}/consents/history`,
    { params: { page, limit } },
  );
  return data;
}

// ---------------------------------------------------------------------------
// Consent Statistics
// ---------------------------------------------------------------------------

export interface ConsentCategoryCount {
  categoryId: string;
  categoryKey: string;
  categoryName: string;
  required: boolean;
  totalGrants: number;
  distinctUsers: number;
}

export interface ConsentStatistics {
  totalConsents: number;
  activeUsersWithConsents24h: number;
  activeUsersWithConsents7d: number;
  activeUsersWithConsents30d: number;
  consentActionsLast24h: number;
  consentActionsLast7d: number;
  consentActionsLast30d: number;
  consentsGranted24h: number;
  consentsRevoked24h: number;
  consentsUpdated24h: number;
  consentsByCategory: ConsentCategoryCount[];
  pendingDeletions: number;
  pendingDeletionsGracePeriod: number;
}

export async function getConsentStatistics(
  realmName: string,
): Promise<ConsentStatistics> {
  const { data } = await apiClient.get<ConsentStatistics>(
    `/realms/${realmName}/stats/consents`,
  );
  return data;
}

// ---------------------------------------------------------------------------
// Per-category statistics
// ---------------------------------------------------------------------------

export interface CategoryStatistics {
  categoryId: string;
  categoryKey: string;
  categoryName: string;
  totalGrants: number;
  totalRevokes: number;
  grants24h: number;
  grants7d: number;
  grants30d: number;
  activeUsers24h: number;
  activeUsers7d: number;
  activeUsers30d: number;
}

export async function getCategoryStatistics(
  realmName: string,
  categoryId: string,
): Promise<CategoryStatistics> {
  const { data } = await apiClient.get<CategoryStatistics>(
    `/realms/${realmName}/consent-categories/${categoryId}/stats`,
  );
  return data;
}
