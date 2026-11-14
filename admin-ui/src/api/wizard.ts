import { rootClient } from './client';

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

/**
 * The wizard state as the server returns it. It never carries the admin's
 * password hash or a client secret; the SMTP password is a placeholder.
 */
export interface WizardState {
  id: string;
  completed: boolean;
  skipped: boolean;
  currentStep: number;
  adminUsername: string | null;
  adminEmail: string | null;
  realmName: string | null;
  realmDisplayName: string | null;
  smtpConfig: SmtpConfig | null;
  clientId: string | null;
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
  const { data } = await rootClient.get<WizardStatus>('/setup-wizard/status');
  return data;
}

export async function getWizardState(): Promise<WizardState> {
  const { data } = await rootClient.get<WizardState>('/setup-wizard/state');
  return data;
}

export async function saveAdminAccount(
  account: AdminAccountData,
): Promise<WizardState> {
  const { data } = await rootClient.post<WizardState>(
    '/setup-wizard/admin-account',
    account,
  );
  return data;
}

export async function saveRealmSettings(
  settings: RealmSettingsData,
): Promise<WizardState> {
  const { data } = await rootClient.post<WizardState>(
    '/setup-wizard/realm-settings',
    settings,
  );
  return data;
}

export async function saveSmtpConfig(
  config: SmtpConfigData,
): Promise<WizardState> {
  const { data } = await rootClient.post<WizardState>(
    '/setup-wizard/smtp-config',
    config,
  );
  return data;
}

export async function testSmtp(testData: SmtpTestData): Promise<SmtpTestResult> {
  const { data } = await rootClient.post<SmtpTestResult>(
    '/setup-wizard/smtp/test',
    testData,
  );
  return data;
}

/** The wizard state plus the new client's secret, shown this once. */
export type SavedClient = WizardState & { clientSecret: string };

export async function saveClient(client: ClientData): Promise<SavedClient> {
  const { data } = await rootClient.post<SavedClient>(
    '/setup-wizard/client',
    client,
  );
  return data;
}

export async function markSdkGenerated(): Promise<WizardState> {
  const { data } = await rootClient.post<WizardState>('/setup-wizard/sdk-generated');
  return data;
}

export async function completeWizard(): Promise<WizardCompleteResult> {
  const { data } = await rootClient.post<WizardCompleteResult>(
    '/setup-wizard/complete',
  );
  return data;
}

export async function skipWizard(): Promise<WizardState> {
  const { data } = await rootClient.post<WizardState>('/setup-wizard/skip');
  return data;
}

/** Clears the answers of a wizard in progress; refused once setup is done. */
export async function resetWizard(): Promise<WizardState> {
  const { data } = await rootClient.post<WizardState>(
    '/setup-wizard/reset',
  );
  return data;
}