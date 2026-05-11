/**
 * WizardContext — wizard state management for the setup wizard flow.
 *
 * Manages wizard state including: admin account, realm settings, SMTP config,
 * client application, and wizard completion status. State is kept in React
 * context and synced with backend via the wizard API.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type WizardStep =
  | 'admin-account'
  | 'realm-settings'
  | 'smtp-config'
  | 'first-client'
  | 'sdk-integration'
  | 'test-auth';

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
  clientSecret?: string;
  redirectUris: string[];
}

export interface WizardState {
  // Progress tracking
  currentStep: number;
  totalSteps: number;
  isFirstRun: boolean;
  wizardCompleted: boolean;
  wizardSkipped: boolean;
  completed: boolean;
  skipped: boolean;

  // Step data
  adminAccount?: AdminAccountData;
  realmSettings?: RealmSettingsData;
  smtpConfig?: SmtpConfigData;
  client?: ClientData;
  sdkGenerated: boolean;
}

interface WizardContextValue extends WizardState {
  // Navigation
  setCurrentStep: (step: number) => void;
  goToNextStep: () => void;
  goToPreviousStep: () => void;
  canGoNext: boolean;
  canGoPrevious: boolean;

  // Step data setters
  setAdminAccount: (data: AdminAccountData) => void;
  setRealmSettings: (data: RealmSettingsData) => void;
  setSmtpConfig: (data: SmtpConfigData) => void;
  setClient: (data: ClientData) => void;
  setSdkGenerated: (generated: boolean) => void;

  // Wizard actions
  markStepCompleted: (step: number) => void;
  completeWizard: () => void;
  skipWizard: () => void;
  resetWizard: () => void;

  // Ref for synchronous access to latest state
  wizardStateRef: React.RefObject<WizardState>;

  // Step info
  getStepInfo: (step: number) => { name: string; description: string; completed: boolean; required: boolean } | null;
}

const WIZARD_STEPS = [
  { name: 'Admin Account', description: 'Create your admin account', required: true },
  { name: 'Realm Settings', description: 'Configure master realm settings', required: true },
  { name: 'SMTP Configuration', description: 'Set up email notifications (optional)', required: false },
  { name: 'First Client', description: 'Create your first application', required: true },
  { name: 'SDK Integration', description: 'Get integration code snippets', required: true },
  { name: 'Test Authentication', description: 'Test your auth flow', required: true },
] as const;

const TOTAL_STEPS = WIZARD_STEPS.length;

const initialWizardState: WizardState = {
  currentStep: 0,
  totalSteps: TOTAL_STEPS,
  isFirstRun: true,
  wizardCompleted: false,
  wizardSkipped: false,
  completed: false,
  skipped: false,
  sdkGenerated: false,
};

const WizardContext = createContext<WizardContextValue | null>(null);

export function WizardProvider({
  children,
  initialState,
}: {
  children: ReactNode;
  initialState?: Partial<WizardState>;
}) {
  const mergedState = { ...initialWizardState, ...initialState };
  const [wizardState, setWizardState] = useState<WizardState>(mergedState);

  // Keep a ref in sync so non-React code can access the latest state
  const wizardStateRef = useRef<WizardState>(wizardState);

  const update = useCallback((next: Partial<WizardState>) => {
    wizardStateRef.current = { ...wizardStateRef.current, ...next };
    setWizardState(prev => ({ ...prev, ...next }));
  }, []);

  const setCurrentStep = useCallback((step: number) => {
    update({ currentStep: Math.max(0, Math.min(step, TOTAL_STEPS - 1)) });
  }, [update]);

  const goToNextStep = useCallback(() => {
    update({ currentStep: Math.min(wizardStateRef.current.currentStep + 1, TOTAL_STEPS - 1) });
  }, [update]);

  const goToPreviousStep = useCallback(() => {
    update({ currentStep: Math.max(wizardStateRef.current.currentStep - 1, 0) });
  }, [update]);

  const canGoNext = wizardState.currentStep < TOTAL_STEPS - 1;
  const canGoPrevious = wizardState.currentStep > 0;

  const setAdminAccount = useCallback((data: AdminAccountData) => {
    update({ adminAccount: data });
  }, [update]);

  const setRealmSettings = useCallback((data: RealmSettingsData) => {
    update({ realmSettings: data });
  }, [update]);

  const setSmtpConfig = useCallback((data: SmtpConfigData) => {
    update({ smtpConfig: data });
  }, [update]);

  const setClient = useCallback((data: ClientData) => {
    update({ client: data });
  }, [update]);

  const setSdkGenerated = useCallback((generated: boolean) => {
    update({ sdkGenerated: generated });
  }, [update]);

  const markStepCompleted = useCallback((step: number) => {
    // Track completed steps - for now just update current step
    if (step === wizardStateRef.current.currentStep) {
      // Signal that current step data is saved (backend will track completion)
    }
  }, []);

  const completeWizard = useCallback(() => {
    update({
      wizardCompleted: true,
      completed: true,
      wizardSkipped: false,
    });
  }, [update]);

  const skipWizard = useCallback(() => {
    update({
      wizardSkipped: true,
      skipped: true,
      wizardCompleted: false,
    });
  }, [update]);

  const resetWizard = useCallback(() => {
    wizardStateRef.current = initialWizardState;
    setWizardState(initialWizardState);
  }, []);

  const getStepInfo = useCallback((step: number) => {
    if (step < 0 || step >= TOTAL_STEPS) {
      return null;
    }
    const stepInfo = WIZARD_STEPS[step];
    // Check if this step has data completed
    let completed = false;
    switch (step) {
      case 0:
        completed = !!wizardStateRef.current.adminAccount;
        break;
      case 1:
        completed = !!wizardStateRef.current.realmSettings;
        break;
      case 2:
        completed = !!wizardStateRef.current.smtpConfig;
        break;
      case 3:
        completed = !!wizardStateRef.current.client;
        break;
      case 4:
        completed = wizardStateRef.current.sdkGenerated;
        break;
      case 5:
        completed = wizardStateRef.current.wizardCompleted;
        break;
    }
    return {
      ...stepInfo,
      completed,
      required: stepInfo.required,
    };
  }, [wizardStateRef.current.adminAccount, wizardStateRef.current.realmSettings, wizardStateRef.current.smtpConfig, wizardStateRef.current.client, wizardStateRef.current.sdkGenerated, wizardStateRef.current.wizardCompleted]);

  const value = useMemo<WizardContextValue>(
    () => ({
      ...wizardState,
      setCurrentStep,
      goToNextStep,
      goToPreviousStep,
      canGoNext,
      canGoPrevious,
      setAdminAccount,
      setRealmSettings,
      setSmtpConfig,
      setClient,
      setSdkGenerated,
      markStepCompleted,
      completeWizard,
      skipWizard,
      resetWizard,
      wizardStateRef,
      getStepInfo,
    }),
    [
      wizardState,
      setCurrentStep,
      goToNextStep,
      goToPreviousStep,
      canGoNext,
      canGoPrevious,
      setAdminAccount,
      setRealmSettings,
      setSmtpConfig,
      setClient,
      setSdkGenerated,
      markStepCompleted,
      completeWizard,
      skipWizard,
      resetWizard,
      wizardStateRef,
      getStepInfo,
    ],
  );

  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
}

/** Returns the full WizardContext value — must be used inside <WizardProvider>. */
export function useWizardContext(): WizardContextValue {
  const ctx = useContext(WizardContext);
  if (!ctx) {
    throw new Error('useWizardContext must be used inside <WizardProvider>');
  }
  return ctx;
}

/** Hook for easier access to wizard state and common operations */
export function useWizard() {
  const context = useWizardContext();
  return {
    // State
    currentStep: context.currentStep,
    totalSteps: context.totalSteps,
    isFirstRun: context.isFirstRun,
    wizardCompleted: context.wizardCompleted,
    wizardSkipped: context.wizardSkipped,

    // Navigation helpers
    isFirstStep: context.currentStep === 0,
    isLastStep: context.currentStep === TOTAL_STEPS - 1,
    progress: (context.currentStep / (TOTAL_STEPS - 1)) * 100,

    // Navigation
    next: context.goToNextStep,
    previous: context.goToPreviousStep,
    goToStep: context.setCurrentStep,
    canGoNext: context.canGoNext,
    canGoPrevious: context.canGoPrevious,

    // Data setters
    setAdminAccount: context.setAdminAccount,
    setRealmSettings: context.setRealmSettings,
    setSmtpConfig: context.setSmtpConfig,
    setClient: context.setClient,
    setSdkGenerated: context.setSdkGenerated,

    // Actions
    complete: context.completeWizard,
    skip: context.skipWizard,
    reset: context.resetWizard,

    // Ref
    stateRef: context.wizardStateRef,
  };
}