import apiClient from './client';

// ============================================================================
// Types
// ============================================================================

export interface UpgradeStageResult {
  stage: string;
  success: boolean;
  message: string;
  duration: number;
  details?: string;
}

export interface UpgradeResult {
  success: boolean;
  upgradeId?: string;
  fromVersion?: string;
  toVersion: string;
  stages: UpgradeStageResult[];
  rollbackTriggered: boolean;
  duration: number;
  error?: string;
}

export interface UpgradeAuditEntry {
  id: string;
  fromVersion: string;
  toVersion: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  backupId: string | null;
  errorMessage: string | null;
}

export interface UpgradeState {
  upgradeId: string;
  stage: string;
  fromVersion: string;
  toVersion: string;
  startedAt: Date;
  stages: UpgradeStageResult[];
}

export interface PreUpgradeCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  details?: string;
}

export interface PreUpgradeValidationResult {
  canProceed: boolean;
  checks: PreUpgradeCheck[];
  summary: {
    passed: number;
    warnings: number;
    failures: number;
  };
}

export interface UpgradeHealthCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  details?: string;
}

export interface UpgradeHealthResult {
  healthy: boolean;
  version: string | null;
  checks: UpgradeHealthCheck[];
  summary: {
    passed: number;
    warnings: number;
    failures: number;
  };
}

export interface RollbackCapability {
  canRollback: boolean;
  lastSuccessfulUpgrade?: {
    id: string;
    fromVersion: string;
    toVersion: string;
    backupId?: string;
    completedAt: Date;
  };
  reason?: string;
}

export interface RollbackResult {
  success: boolean;
  rollbackVersion?: string;
  previousVersion?: string;
  backupRestored?: boolean;
  backupPath?: string;
  duration?: number;
  error?: string;
  timestamp: Date;
}

export interface ConfigCompatibilityIssue {
  type: 'error' | 'warning';
  path: string;
  message: string;
  currentValue?: string;
  requiredValue?: string;
}

export interface ConfigCompatibilityResult {
  compatible: boolean;
  version: string;
  issues: ConfigCompatibilityIssue[];
  summary: {
    errors: number;
    warnings: number;
  };
}

export interface UpgradeRequest {
  toVersion: string;
  dryRun?: boolean;
  force?: boolean;
  initiatedBy?: string;
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Start a new upgrade to the target version.
 */
export async function startUpgrade(request: UpgradeRequest): Promise<UpgradeResult> {
  const { data } = await apiClient.post<UpgradeResult>('/upgrade', request);
  return data;
}

/**
 * Get the status of the most recent upgrade.
 */
export async function getUpgradeStatus(): Promise<UpgradeAuditEntry | null> {
  const { data } = await apiClient.get<UpgradeAuditEntry | null>('/upgrade/status');
  return data;
}

/**
 * Get upgrade history for audit purposes.
 */
export async function getUpgradeHistory(limit = 10): Promise<UpgradeAuditEntry[]> {
  const { data } = await apiClient.get<UpgradeAuditEntry[]>('/upgrade/history', {
    params: { limit },
  });
  return data;
}

/**
 * Get the current state of a specific upgrade operation.
 */
export async function getUpgradeState(upgradeId: string): Promise<UpgradeState | null> {
  const { data } = await apiClient.get<UpgradeState | null>(`/upgrade/${upgradeId}`);
  return data;
}

/**
 * Run pre-upgrade validation checks to verify the system is ready.
 */
export async function runPreValidation(): Promise<PreUpgradeValidationResult> {
  const { data } = await apiClient.get<PreUpgradeValidationResult>('/upgrade/pre-validation');
  return data;
}

/**
 * Run post-upgrade health checks to verify the system is healthy.
 */
export async function runHealthCheck(): Promise<UpgradeHealthResult> {
  const { data } = await apiClient.get<UpgradeHealthResult>('/upgrade/health');
  return data;
}

/**
 * Check configuration compatibility for a target version.
 */
export async function checkConfigCompatibility(version?: string): Promise<ConfigCompatibilityResult> {
  const { data } = await apiClient.get<ConfigCompatibilityResult>('/upgrade/config-compatibility', {
    params: version ? { version } : undefined,
  });
  return data;
}

/**
 * Check if rollback is possible.
 */
export async function checkRollbackCapability(): Promise<RollbackCapability> {
  const { data } = await apiClient.get<RollbackCapability>('/upgrade/rollback/capability');
  return data;
}

/**
 * Execute a rollback to the previous version.
 */
export async function executeRollback(upgradeId?: string): Promise<RollbackResult> {
  const { data } = await apiClient.post<RollbackResult>('/upgrade/rollback', { upgradeId });
  return data;
}