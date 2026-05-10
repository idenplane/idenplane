import apiClient from './client';

export interface WizardStatus {
  isFirstRun: boolean;
  wizardCompleted: boolean;
  wizardSkipped: boolean;
  currentStep: number;
  totalSteps: number;
  steps: WizardStepInfo[];
}

export interface WizardStepInfo {
  index: number;
  name: string;
  description: string;
  completed: boolean;
  required: boolean;
}

export interface WizardState {
  id: string;
  completed: boolean;
  skipped: boolean;
  currentStep: number;
  adminUsername: string | null;
  adminEmail: string | null;
  adminPasswordHash: string | null;
  realmName: string | null;
  realmDisplayName: string | null;
  smtpConfig: SmtpConfig | null;
  clientId: string | null;
  clientSecret: string | null;
  redirectUris: string[] | null;
  sdkGenerated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  secure: boolean;
}

export interface AdminAccountData {
  username: string;
  email: string;
  password: string;
}

export interface RealmSettingsData {
  name: string;
  displayName?: string;
}

export interface SmtpConfigData {
  host: string;
  port: number;
  user?: string;
  password?: string;
  from: string;
  secure?: boolean;
}

export interface ClientData {
  clientId: string;
  redirectUris: string[];
}

export interface SmtpTestData {
  to: string;
}

export interface SmtpTestResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface WizardCompleteResult {
  success: boolean;
  message: string;
}

export async function getWizardStatus(): Promise<WizardStatus> {
  const { data } = await apiClient.get<WizardStatus>('/setup-wizard/status');
  return data;
}

export async function getWizardState(): Promise<WizardState> {
  const { data } = await apiClient.get<WizardState>('/setup-wizard/state');
  return data;
}

export async function saveAdminAccount(
  account: AdminAccountData,
): Promise<WizardState> {
  const { data } = await apiClient.post<WizardState>(
    '/setup-wizard/admin-account',
    account,
  );
  return data;
}

export async function saveRealmSettings(
  settings: RealmSettingsData,
): Promise<WizardState> {
  const { data } = await apiClient.post<WizardState>(
    '/setup-wizard/realm-settings',
    settings,
  );
  return data;
}

export async function saveSmtpConfig(
  config: SmtpConfigData,
): Promise<WizardState> {
  const { data } = await apiClient.post<WizardState>(
    '/setup-wizard/smtp-config',
    config,
  );
  return data;
}

export async function testSmtp(testData: SmtpTestData): Promise<SmtpTestResult> {
  const { data } = await apiClient.post<SmtpTestResult>(
    '/setup-wizard/smtp/test',
    testData,
  );
  return data;
}

export async function saveClient(client: ClientData): Promise<WizardState> {
  const { data } = await apiClient.post<WizardState>(
    '/setup-wizard/client',
    client,
  );
  return data;
}

export async function markSdkGenerated(): Promise<WizardState> {
  const { data } = await apiClient.post<WizardState>('/setup-wizard/sdk-generated');
  return data;
}

export async function completeWizard(): Promise<WizardCompleteResult> {
  const { data } = await apiClient.post<WizardCompleteResult>(
    '/setup-wizard/complete',
  );
  return data;
}

export async function skipWizard(): Promise<WizardState> {
  const { data } = await apiClient.post<WizardState>('/setup-wizard/skip');
  return data;
}

export async function resetWizard(): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>(
    '/setup-wizard/reset',
  );
  return data;
}