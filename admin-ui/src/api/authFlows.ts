import apiClient from './client';

// ─── Types ──────────────────────────────────────────────────

export type StepType =
  | 'password'
  | 'totp'
  | 'webauthn'
  | 'social'
  | 'ldap'
  | 'email_otp'
  | 'consent';

export type ConditionOperator =
  | 'eq'
  | 'neq'
  | 'in'
  | 'not_in'
  | 'exists'
  | 'not_exists';

export interface FlowStepCondition {
  field: string;
  operator: ConditionOperator;
  value?: unknown;
}

export interface FlowStep {
  id: string;
  type: StepType;
  required: boolean;
  order: number;
  condition?: FlowStepCondition | null;
  fallbackStepId?: string | null;
  config?: Record<string, unknown>;
}

export interface AuthFlow {
  id: string;
  realmId: string;
  name: string;
  description?: string | null;
  /** @deprecated Informational only; never used for binding. */
  isDefault: boolean;
  steps: FlowStep[];
  /** Incremented by the server on every update. */
  version?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAuthFlowPayload {
  name: string;
  description?: string;
  isDefault?: boolean;
  steps: FlowStep[];
}

export interface UpdateAuthFlowPayload {
  name?: string;
  description?: string;
  isDefault?: boolean;
  steps?: FlowStep[];
}

// ─── API Functions ───────────────────────────────────────────

export async function getAuthFlows(realmName: string): Promise<AuthFlow[]> {
  const { data } = await apiClient.get<AuthFlow[]>(
    `/realms/${realmName}/auth-flows`,
  );
  return data;
}

export async function getAuthFlowById(
  realmName: string,
  id: string,
): Promise<AuthFlow> {
  const { data } = await apiClient.get<AuthFlow>(
    `/realms/${realmName}/auth-flows/${id}`,
  );
  return data;
}

export async function createAuthFlow(
  realmName: string,
  payload: CreateAuthFlowPayload,
): Promise<AuthFlow> {
  const { data } = await apiClient.post<AuthFlow>(
    `/realms/${realmName}/auth-flows`,
    payload,
  );
  return data;
}

export async function updateAuthFlow(
  realmName: string,
  id: string,
  payload: UpdateAuthFlowPayload,
): Promise<AuthFlow> {
  const { data } = await apiClient.put<AuthFlow>(
    `/realms/${realmName}/auth-flows/${id}`,
    payload,
  );
  return data;
}

export async function deleteAuthFlow(
  realmName: string,
  id: string,
): Promise<void> {
  await apiClient.delete(`/realms/${realmName}/auth-flows/${id}`);
}

export async function validateAuthFlow(
  realmName: string,
  id: string,
): Promise<FlowValidationResult> {
  const { data } = await apiClient.post<FlowValidationResult>(
    `/realms/${realmName}/auth-flows/${id}/validate`,
  );
  return data;
}

// ─── Validation & bindings ───────────────────────────────────

/** One validation problem, as returned by the server. */
export interface FlowValidationError {
  path: string;
  code: string;
  message: string;
  /** Present on binding errors that concern a flow. */
  flowId?: string;
  flowErrors?: FlowValidationError[];
}

export interface FlowValidationResult {
  valid: boolean;
  errors: FlowValidationError[];
}

export interface ClientFlowBinding {
  id: string;
  clientId: string;
  name: string | null;
  authFlowId: string | null;
}

export interface FlowBindings {
  /** Server flag AUTH_FLOW_RUNTIME_ENABLED; while false, login ignores bindings. */
  runtimeEnabled: boolean;
  authFlowsEnabled: boolean;
  browserFlowId: string | null;
  clients: ClientFlowBinding[];
}

export interface UpdateFlowBindingsPayload {
  browserFlowId?: string | null;
  authFlowsEnabled?: boolean;
  clients?: Array<{ clientId: string; authFlowId: string | null }>;
}

export async function getFlowBindings(realmName: string): Promise<FlowBindings> {
  const { data } = await apiClient.get<FlowBindings>(
    `/realms/${realmName}/auth-flows/bindings`,
  );
  return data;
}

export async function updateFlowBindings(
  realmName: string,
  payload: UpdateFlowBindingsPayload,
): Promise<FlowBindings> {
  const { data } = await apiClient.put<FlowBindings>(
    `/realms/${realmName}/auth-flows/bindings`,
    payload,
  );
  return data;
}

/** Where a flow is bound (409 body on delete). */
export type FlowBindingRef =
  | { kind: 'realm'; realmId: string; realmName: string }
  | { kind: 'client'; id: string; clientId: string };

/** The `errors` list of a 400 validation / binding response, if any. */
export function getFlowValidationErrors(err: unknown): FlowValidationError[] {
  const data = (err as { response?: { status?: number; data?: { errors?: unknown } } })
    ?.response?.data;
  return Array.isArray(data?.errors) ? (data.errors as FlowValidationError[]) : [];
}

/** The `bindings` list of a 409 delete response, if any. */
export function getFlowBindingConflicts(err: unknown): FlowBindingRef[] {
  const res = (err as { response?: { status?: number; data?: { bindings?: unknown } } })
    ?.response;
  return res?.status === 409 && Array.isArray(res.data?.bindings)
    ? (res.data.bindings as FlowBindingRef[])
    : [];
}
