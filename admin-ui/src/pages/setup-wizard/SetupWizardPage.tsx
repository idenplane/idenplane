/**
 * SetupWizardPage — Main wizard container integrating all steps.
 *
 * This is the main wizard page that orchestrates all setup steps:
 * 1. Admin Account creation
 * 2. Realm Settings configuration
 * 3. SMTP Configuration (optional)
 * 4. First Client creation
 * 5. SDK Integration
 * 6. Test Authentication
 *
 * Follows RealmCreatePage patterns for structure and styling.
 */

import { useWizard } from '../../context/WizardContext';
import SetupWizardSidebar from '../../components/SetupWizard/SetupWizardSidebar';
import SetupWizardFooter from '../../components/SetupWizard/SetupWizardFooter';

// Step components
import AdminAccountStep from './steps/AdminAccountStep';
import RealmSettingsStep from './steps/RealmSettingsStep';
import SmtpConfigStep from './steps/SmtpConfigStep';
import FirstClientStep from './steps/FirstClientStep';
import SdkIntegrationStep from './steps/SdkIntegrationStep';
import TestAuthStep from './steps/TestAuthStep';

// Step components map for dynamic rendering
const STEP_COMPONENTS = [
  AdminAccountStep,
  RealmSettingsStep,
  SmtpConfigStep,
  FirstClientStep,
  SdkIntegrationStep,
  TestAuthStep,
] as const;

const STEP_NAMES = [
  'Create Admin Account',
  'Configure Realm Settings',
  'Setup SMTP (Optional)',
  'Create First Client',
  'SDK Integration',
  'Test Authentication',
] as const;

export default function SetupWizardPage() {
  const {
    currentStep,
    next,
    previous,
    wizardCompleted,
    wizardSkipped,
    progress,
    isLastStep,
    canGoPrevious,
  } = useWizard();

  // Get current step component
  const CurrentStepComponent = STEP_COMPONENTS[currentStep];
  const stepName = STEP_NAMES[currentStep];

  // Handle next step navigation
  function handleNext() {
    if (isLastStep) {
      // Last step handled by TestAuthStep directly
      return;
    }
    next();
  }

  // Handle back step navigation
  function handleBack() {
    previous();
  }

  // Handle skip (SMTP step)
  function handleSkip() {
    // For SMTP step, just proceed to next step
    next();
  }

  // Show completion screen if wizard is done
  if (wizardCompleted || wizardSkipped) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="mx-auto w-full max-w-lg rounded-lg bg-white p-8 text-center shadow-lg">
          {wizardCompleted ? (
            <>
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                <svg
                  className="h-8 w-8 text-green-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-gray-900">Setup Complete!</h1>
              <p className="mt-2 text-sm text-gray-500">
                Your AuthMe instance is now configured and ready to use.
                Redirecting you to the admin console...
              </p>
            </>
          ) : (
            <>
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
                <svg
                  className="h-8 w-8 text-gray-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13 5l7 7-7 7M5 5l7 7-7 7"
                  />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-gray-900">Wizard Skipped</h1>
              <p className="mt-2 text-sm text-gray-500">
                You can configure AuthMe manually through the admin console.
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar with step navigation */}
      <SetupWizardSidebar />

      {/* Main content area */}
      <div className="flex flex-1 flex-col">
        {/* Header */}
        <header className="border-b border-gray-200 bg-white px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-gray-900">AuthMe Setup Wizard</h1>
              <p className="mt-0.5 text-sm text-gray-500">
                Step {currentStep + 1} of 6: {stepName}
              </p>
            </div>

            {/* Progress indicator */}
            <div className="flex items-center gap-4">
              <div className="w-48">
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>Progress</span>
                  <span>{Math.round(progress)}%</span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-gray-200">
                  <div
                    className="h-full rounded-full bg-indigo-600 transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Step content */}
        <main className="flex-1 overflow-y-auto px-8 py-8">
          <div className="mx-auto max-w-2xl">
            {/* Step component */}
            <div className="rounded-lg bg-white p-8 shadow-sm">
              <CurrentStepComponent />
            </div>
          </div>
        </main>

        {/* Footer with navigation */}
        <SetupWizardFooter
          onNext={handleNext}
          onBack={handleBack}
          onSkip={handleSkip}
          nextLabel={isLastStep ? 'Finish Setup' : 'Next'}
          showSkip={currentStep === 2} // SMTP step is optional
          nextDisabled={false}
          backDisabled={!canGoPrevious}
        />
      </div>
    </div>
  );
}