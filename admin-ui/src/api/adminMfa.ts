import apiClient from './client';

/**
 * Admin console MFA (docs: Security → Admin console MFA). The signed-in
 * admin's own factors, the sign-in second step, step-up, and the
 * super-admin's requirement and reset.
 */

export type AdminMfaMethod = 'totp' | 'passkey' | 'recovery';

/** The machine-readable reason the server refused a request for MFA. */
export type AdminMfaRefusal =
  | 'admin_mfa_enrolment_required'
  | 'admin_mfa_step_up_required'
  | 'admin_recent_mfa_required';

export interface AdminMfaPolicy {
  required: boolean;
  /** `environment`: fixed by ADMIN_MFA_REQUIRED, not changeable here. */
  source: 'environment' | 'setting';
}

export interface AdminPasskey {
  id: string;
  name: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface AdminMfaStatus {
  policy: AdminMfaPolicy;
  enrolled: boolean;
  totp: boolean;
  passkeys: AdminPasskey[];
  recoveryCodes: { remaining: number; oldFormat: boolean };
  session: { verified: boolean; authTime: number | null };
}

export interface TotpSetup {
  secret: string;
  qrCodeDataUrl: string;
  otpauthUrl: string;
}

/** A new session token, when the server issued one. */
export interface IssuedToken {
  access_token?: string;
}

/** The answer to POST /admin/auth/login. */
export type LoginResult =
  | { access_token: string; mfa_enrolment_required?: boolean }
  | { mfa_required: true; mfa_token: string; methods: AdminMfaMethod[] };

// ── Own factors ──────────────────────────────────────────────────────────

export async function getMfaStatus(): Promise<AdminMfaStatus> {
  const { data } = await apiClient.get<AdminMfaStatus>('/auth/mfa');
  return data;
}

export async function startTotp(): Promise<TotpSetup> {
  const { data } = await apiClient.post<TotpSetup>('/auth/mfa/totp');
  return data;
}

export async function activateTotp(
  code: string,
): Promise<IssuedToken & { recoveryCodes: string[] | null }> {
  const { data } = await apiClient.post('/auth/mfa/totp/activate', { code });
  return data;
}

export async function removeTotp(): Promise<void> {
  await apiClient.delete('/auth/mfa/totp');
}

export async function passkeyRegistrationOptions(): Promise<Record<string, unknown>> {
  const { data } = await apiClient.post('/auth/mfa/passkeys/options');
  return data;
}

export async function registerPasskey(
  response: unknown,
  name: string,
): Promise<IssuedToken & { recoveryCodes: string[] | null }> {
  const { data } = await apiClient.post('/auth/mfa/passkeys', { response, name });
  return data;
}

export async function removePasskey(id: string): Promise<void> {
  await apiClient.delete(`/auth/mfa/passkeys/${encodeURIComponent(id)}`);
}

export async function regenerateRecoveryCodes(): Promise<string[]> {
  const { data } = await apiClient.post<{ recoveryCodes: string[] }>(
    '/auth/mfa/recovery-codes',
  );
  return data.recoveryCodes;
}

// ── Step-up ──────────────────────────────────────────────────────────────

export async function stepUpWithCode(
  method: 'totp' | 'recovery',
  code: string,
): Promise<string> {
  const { data } = await apiClient.post<{ access_token: string }>('/auth/step-up', {
    method,
    code,
  });
  return data.access_token;
}

export async function stepUpPasskeyOptions(): Promise<Record<string, unknown>> {
  const { data } = await apiClient.post('/auth/step-up/passkey/options');
  return data;
}

export async function stepUpWithPasskey(response: unknown): Promise<string> {
  const { data } = await apiClient.post<{ access_token: string }>(
    '/auth/step-up/passkey',
    { response },
  );
  return data.access_token;
}

// ── Sign-in, second step ─────────────────────────────────────────────────

export async function loginWithCode(
  mfaToken: string,
  method: 'totp' | 'recovery',
  code: string,
): Promise<string> {
  const { data } = await apiClient.post<{ access_token: string }>('/auth/login/mfa', {
    mfa_token: mfaToken,
    method,
    code,
  });
  return data.access_token;
}

export async function loginPasskeyOptions(mfaToken: string): Promise<Record<string, unknown>> {
  const { data } = await apiClient.post('/auth/login/passkey/options', {
    mfa_token: mfaToken,
  });
  return data;
}

export async function loginWithPasskey(mfaToken: string, response: unknown): Promise<string> {
  const { data } = await apiClient.post<{ access_token: string }>('/auth/login/passkey', {
    mfa_token: mfaToken,
    response,
  });
  return data.access_token;
}

// ── Super-admin ──────────────────────────────────────────────────────────

export async function getAdminMfaPolicy(): Promise<AdminMfaPolicy> {
  const { data } = await apiClient.get<AdminMfaPolicy>('/admin-mfa/policy');
  return data;
}

export async function setAdminMfaPolicy(required: boolean): Promise<AdminMfaPolicy> {
  const { data } = await apiClient.put<AdminMfaPolicy>('/admin-mfa/policy', { required });
  return data;
}

export async function resetAdminMfa(userId: string): Promise<void> {
  await apiClient.delete(`/admin-accounts/${encodeURIComponent(userId)}/mfa`);
}

/** The MFA refusal code of an axios error, if it is one. */
export function mfaRefusalOf(error: unknown): AdminMfaRefusal | null {
  const code = (error as { response?: { status?: number; data?: { code?: unknown } } })
    ?.response;
  if (code?.status !== 403) return null;
  const value = code.data?.code;
  return value === 'admin_mfa_enrolment_required' ||
    value === 'admin_mfa_step_up_required' ||
    value === 'admin_recent_mfa_required'
    ? value
    : null;
}
