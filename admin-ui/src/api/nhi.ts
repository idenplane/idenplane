import apiClient from './client';
import type {
  NhiIdentity,
  NhiCredential,
  NhiCredentialPolicy,
  NhiUsageStats,
  NhiAuditLog,
  NhiTlsAuthMode,
} from '../types';

// ── Types ────────────────────────────────────────────────────────────────────

export type NhiIdentityType = 'IOT_DEVICE' | 'AI_AGENT' | 'BOT' | 'MACHINE_TO_MACHINE';
export type NhiLifecycleStatus = 'PROVISIONING' | 'ACTIVE' | 'SUSPENDED' | 'DECOMMISSIONED';
/** The server's NhiCredentialType. Only API_KEY and CERTIFICATE authenticate. */
export type NhiCredentialType = 'API_KEY' | 'CERTIFICATE' | 'JWT' | 'OAUTH' | 'MTLS';

export interface CreateNhiIdentityDto {
  name: string;
  identityType?: NhiIdentityType;
  description?: string;
  permissionScopes?: string[];
  agentPurpose?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

export interface UpdateNhiIdentityDto {
  name?: string;
  description?: string;
  enabled?: boolean;
  permissionScopes?: string[];
  agentPurpose?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

/** The one subject/SAN rule of a PKI certificate credential. */
export type NhiPkiRuleField =
  | 'tlsClientAuthSubjectDn'
  | 'tlsClientAuthSanDns'
  | 'tlsClientAuthSanUri'
  | 'tlsClientAuthSanIp'
  | 'tlsClientAuthSanEmail';

export interface CreateNhiCredentialDto
  extends Partial<Record<NhiPkiRuleField, string>> {
  credentialType?: NhiCredentialType;
  name: string;
  expiresAt?: string;
  allowedIpRanges?: string[];
  rotationRequired?: boolean;
  /** RFC 8705: SELF_SIGNED pins certificatePem; PKI names one rule. */
  tlsAuthMode?: NhiTlsAuthMode;
  /** The certificate only; a private key is refused. */
  certificatePem?: string;
}

export interface RotateNhiCredentialDto
  extends Partial<Record<NhiPkiRuleField, string>> {
  name?: string;
  /** SELF_SIGNED: the new certificate. */
  certificatePem?: string;
  /** Seconds the old certificate keeps working. Default: the policy's, else 86400. */
  overlapSeconds?: number;
}

export type NhiClientAuthMethod = 'self_signed_tls_client_auth' | 'tls_client_auth';

/** The OAuth client of an NHI identity (RFC 8705 NHI binding). */
export interface NhiOAuthClient {
  id: string;
  clientId: string;
  name: string | null;
  enabled: boolean;
  clientType: 'CONFIDENTIAL';
  grantTypes: string[];
  tokenEndpointAuthMethod: NhiClientAuthMethod;
  tlsClientCertificateBoundAccessTokens: true;
  nhiIdentityId: string;
  tokenEndpoint: string;
  mtlsClientAuthEnabled: boolean;
  createdAt: string;
}

export interface SetCertificateDto {
  certificatePem: string;
  certificateChain?: string;
  privateKeyPem?: string;
}

export interface GenerateCertificateDto {
  identityId?: string;
  commonName: string;
  organization?: string;
  organizationalUnit?: string;
  locality?: string;
  state?: string;
  country?: string;
  validityDays?: number;
  keyAlgorithm?: 'RSA' | 'ECDSA';
}

export interface CreateNhiCredentialPolicyDto {
  name: string;
  description?: string;
  enabled?: boolean;
  priority?: number;
  credentialType?: NhiCredentialType;
  rotationIntervalDays?: number;
  rotationBeforeDays?: number;
  autoRotate?: boolean;
  maxCredentialAgeDays?: number;
  maxRequestsPerDay?: number;
  maxRequestsPerMonth?: number;
  rateLimitPerMinute?: number;
  requireCertificate?: boolean;
  requireIpRestriction?: boolean;
  requireAuditLogging?: boolean;
}

export interface UpdateNhiCredentialPolicyDto {
  name?: string;
  description?: string;
  enabled?: boolean;
  priority?: number;
  rotationIntervalDays?: number;
  rotationBeforeDays?: number;
  autoRotate?: boolean;
  maxCredentialAgeDays?: number;
  maxRequestsPerDay?: number;
  maxRequestsPerMonth?: number;
  rateLimitPerMinute?: number;
  requireCertificate?: boolean;
  requireIpRestriction?: boolean;
  requireAuditLogging?: boolean;
}

export interface BulkDeviceItemDto {
  name: string;
  description?: string;
  generateCertificate?: boolean;
  certificateKeyAlgorithm?: 'RSA' | 'ECDSA';
  certificateValidityDays?: number;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

export interface BulkRegistrationDto {
  devices: BulkDeviceItemDto[];
}

export interface BulkRegistrationResponseDto {
  total: number;
  successful: number;
  failed: number;
  results: Array<{
    name: string;
    success: boolean;
    identity?: NhiIdentity;
    certificatePem?: string;
    privateKeyPem?: string;
    error?: string;
  }>;
}

export interface AuditLogQuery {
  nhiIdentityId?: string;
  action?: string;
  success?: boolean;
  dateFrom?: string;
  dateTo?: string;
  first?: number;
  max?: number;
}

// ── NHI Identity API functions ────────────────────────────────────────────────

export async function getNhiIdentities(realmName: string): Promise<NhiIdentity[]> {
  const { data } = await apiClient.get<NhiIdentity[]>(
    `/realms/${realmName}/nhi`,
  );
  return data;
}

export async function getNhiIdentityById(
  realmName: string,
  id: string,
): Promise<NhiIdentity> {
  const { data } = await apiClient.get<NhiIdentity>(
    `/realms/${realmName}/nhi/${id}`,
  );
  return data;
}

export async function createNhiIdentity(
  realmName: string,
  dto: CreateNhiIdentityDto,
): Promise<NhiIdentity> {
  const { data } = await apiClient.post<NhiIdentity>(
    `/realms/${realmName}/nhi`,
    dto,
  );
  return data;
}

export async function updateNhiIdentity(
  realmName: string,
  id: string,
  dto: UpdateNhiIdentityDto,
): Promise<NhiIdentity> {
  const { data } = await apiClient.put<NhiIdentity>(
    `/realms/${realmName}/nhi/${id}`,
    dto,
  );
  return data;
}

export async function deleteNhiIdentity(
  realmName: string,
  id: string,
): Promise<void> {
  await apiClient.delete(`/realms/${realmName}/nhi/${id}`);
}

// ── Lifecycle API functions ───────────────────────────────────────────────────

export async function suspendNhiIdentity(
  realmName: string,
  id: string,
): Promise<NhiIdentity> {
  const { data } = await apiClient.post<NhiIdentity>(
    `/realms/${realmName}/nhi/${id}/suspend`,
  );
  return data;
}

export async function reactivateNhiIdentity(
  realmName: string,
  id: string,
): Promise<NhiIdentity> {
  const { data } = await apiClient.post<NhiIdentity>(
    `/realms/${realmName}/nhi/${id}/reactivate`,
  );
  return data;
}

export async function decommissionNhiIdentity(
  realmName: string,
  id: string,
): Promise<NhiIdentity> {
  const { data } = await apiClient.post<NhiIdentity>(
    `/realms/${realmName}/nhi/${id}/decommission`,
  );
  return data;
}

// ── Credential API functions ──────────────────────────────────────────────────

export async function createNhiCredential(
  realmName: string,
  identityId: string,
  dto: CreateNhiCredentialDto,
): Promise<NhiCredential> {
  const { data } = await apiClient.post<NhiCredential>(
    `/realms/${realmName}/nhi/${identityId}/credentials`,
    dto,
  );
  return data;
}

export async function getNhiCredentials(
  realmName: string,
  identityId: string,
): Promise<NhiCredential[]> {
  const { data } = await apiClient.get<NhiCredential[]>(
    `/realms/${realmName}/nhi/${identityId}/credentials`,
  );
  return data;
}

export async function revokeNhiCredential(
  realmName: string,
  identityId: string,
  credentialId: string,
): Promise<void> {
  await apiClient.post(`/realms/${realmName}/nhi/${identityId}/credentials/${credentialId}/revoke`);
}

export async function rotateNhiCredential(
  realmName: string,
  identityId: string,
  credentialId: string,
  dto: RotateNhiCredentialDto = {},
): Promise<{ newCredential: NhiCredential; oldCredential?: NhiCredential }> {
  const { data } = await apiClient.post<{ newCredential: NhiCredential; oldCredential?: NhiCredential }>(
    `/realms/${realmName}/nhi/${identityId}/credentials/${credentialId}/rotate`,
    dto,
  );
  return data;
}

// ── OAuth client (RFC 8705 NHI binding) ───────────────────────────────────────

/** The identity's OAuth client, or `null` when it has none. */
export async function getNhiOAuthClient(
  realmName: string,
  identityId: string,
): Promise<NhiOAuthClient | null> {
  try {
    const { data } = await apiClient.get<NhiOAuthClient>(
      `/realms/${realmName}/nhi/${identityId}/oauth-client`,
    );
    return data;
  } catch (err) {
    if ((err as { response?: { status?: number } }).response?.status === 404) {
      return null;
    }
    throw err;
  }
}

export async function createNhiOAuthClient(
  realmName: string,
  identityId: string,
  dto: { tokenEndpointAuthMethod?: NhiClientAuthMethod } = {},
): Promise<NhiOAuthClient> {
  const { data } = await apiClient.post<NhiOAuthClient>(
    `/realms/${realmName}/nhi/${identityId}/oauth-client`,
    dto,
  );
  return data;
}

export async function deleteNhiOAuthClient(
  realmName: string,
  identityId: string,
): Promise<void> {
  await apiClient.delete(`/realms/${realmName}/nhi/${identityId}/oauth-client`);
}

// ── Certificate API functions ──────────────────────────────────────────────────

export async function setNhiCertificate(
  realmName: string,
  identityId: string,
  dto: SetCertificateDto,
): Promise<NhiIdentity> {
  const { data } = await apiClient.post<NhiIdentity>(
    `/realms/${realmName}/nhi/${identityId}/certificate`,
    dto,
  );
  return data;
}

export async function generateDeviceCertificate(
  realmName: string,
  dto: GenerateCertificateDto,
): Promise<{
  certificatePem: string;
  privateKeyPem: string;
  certificateInfo: {
    commonName: string;
    issuer: string;
    validFrom: string;
    validTo: string;
    fingerprint: string;
    keyAlgorithm: string;
  };
}> {
  const { data } = await apiClient.post(
    `/realms/${realmName}/nhi/device-certificates`,
    dto,
  );
  return data;
}

// ── Usage Statistics API functions ────────────────────────────────────────────

export async function getNhiUsageStats(
  realmName: string,
  identityId: string,
): Promise<NhiUsageStats> {
  const { data } = await apiClient.get<NhiUsageStats>(
    `/realms/${realmName}/nhi/${identityId}/stats`,
  );
  return data;
}

// ── Bulk Registration API functions ────────────────────────────────────────────

export async function bulkRegisterDevices(
  realmName: string,
  dto: BulkRegistrationDto,
): Promise<BulkRegistrationResponseDto> {
  const { data } = await apiClient.post<BulkRegistrationResponseDto>(
    `/realms/${realmName}/nhi/devices/bulk-register`,
    dto,
  );
  return data;
}

// ── Credential Policy API functions ───────────────────────────────────────────

export async function createNhiCredentialPolicy(
  realmName: string,
  dto: CreateNhiCredentialPolicyDto,
): Promise<NhiCredentialPolicy> {
  const { data } = await apiClient.post<NhiCredentialPolicy>(
    `/realms/${realmName}/nhi/credential-policies`,
    dto,
  );
  return data;
}

export async function getNhiCredentialPolicies(
  realmName: string,
): Promise<NhiCredentialPolicy[]> {
  const { data } = await apiClient.get<NhiCredentialPolicy[]>(
    `/realms/${realmName}/nhi/credential-policies`,
  );
  return data;
}

export async function getNhiCredentialPolicyById(
  realmName: string,
  policyId: string,
): Promise<NhiCredentialPolicy> {
  const { data } = await apiClient.get<NhiCredentialPolicy>(
    `/realms/${realmName}/nhi/credential-policies/${policyId}`,
  );
  return data;
}

export async function updateNhiCredentialPolicy(
  realmName: string,
  policyId: string,
  dto: UpdateNhiCredentialPolicyDto,
): Promise<NhiCredentialPolicy> {
  const { data } = await apiClient.put<NhiCredentialPolicy>(
    `/realms/${realmName}/nhi/credential-policies/${policyId}`,
    dto,
  );
  return data;
}

export async function deleteNhiCredentialPolicy(
  realmName: string,
  policyId: string,
): Promise<void> {
  await apiClient.delete(`/realms/${realmName}/nhi/credential-policies/${policyId}`);
}

// ── Rotation Status API functions ─────────────────────────────────────────────

export async function getPolicyRotationStatus(
  realmName: string,
  policyId: string,
): Promise<Array<{ identityId: string; name: string; credentialId: string; status: string }>> {
  const { data } = await apiClient.get(
    `/realms/${realmName}/nhi/credential-policies/${policyId}/rotation-status`,
  );
  return data;
}

export async function getRotationStatusSummary(
  realmName: string,
): Promise<{
  totalCredentials: number;
  requiringRotation: number;
  recentlyRotated: number;
  credentialsAtRisk: number;
}> {
  const { data } = await apiClient.get(
    `/realms/${realmName}/nhi/rotation-status`,
  );
  return data;
}

// ── Audit Log API functions ───────────────────────────────────────────────────

export async function queryNhiAuditLogs(
  realmName: string,
  query?: AuditLogQuery,
): Promise<NhiAuditLog[]> {
  const params = new URLSearchParams();
  if (query?.nhiIdentityId) params.append('nhiIdentityId', query.nhiIdentityId);
  if (query?.action) params.append('action', query.action);
  if (query?.success !== undefined) params.append('success', String(query.success));
  if (query?.dateFrom) params.append('dateFrom', query.dateFrom);
  if (query?.dateTo) params.append('dateTo', query.dateTo);
  if (query?.first !== undefined) params.append('first', String(query.first));
  if (query?.max !== undefined) params.append('max', String(query.max));

  const { data } = await apiClient.get<NhiAuditLog[]>(
    `/realms/${realmName}/nhi/audit-logs?${params.toString()}`,
  );
  return data;
}

export async function clearNhiAuditLogs(
  realmName: string,
  nhiIdentityId?: string,
): Promise<void> {
  const params = nhiIdentityId ? `?nhiIdentityId=${nhiIdentityId}` : '';
  await apiClient.delete(`/realms/${realmName}/nhi/audit-logs${params}`);
}
