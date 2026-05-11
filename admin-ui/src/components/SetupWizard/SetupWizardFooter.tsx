/**
 * SetupWizardFooter — navigation footer with back/next/skip buttons.
 *
 * Displays navigation controls for the setup wizard with:
 * - Back button (disabled on first step)
 * - Next button (disabled when loading or on last step)
 * - Skip button (optional, based on step configuration)
 *
 * Follows the SetupWizardSidebar dark theme styling pattern.
 */

import { useWizard } from '../../context/WizardContext';

interface SetupWizardFooterProps {
  onNext?: () => void;
  onBack?: () => void;
  onSkip?: () => void;
  nextLabel?: string;
  skipLabel?: string;
  showSkip?: boolean;
  nextDisabled?: boolean;
  backDisabled?: boolean;
  isLoading?: boolean;
}

/**
 * Step configuration for which steps allow skipping
 */
const STEP_SKIP_CONFIG: Record<number, { allowSkip: boolean; skipLabel?: string }> = {
  0: { allowSkip: false }, // Admin Account - required
  1: { allowSkip: false }, // Realm Settings - required
  2: { allowSkip: true, skipLabel: 'Skip for now' }, // SMTP Configuration - optional
  3: { allowSkip: false }, // First Client - required
  4: { allowSkip: false }, // SDK Integration - required
  5: { allowSkip: false }, // Test Authentication - required
};

export default function SetupWizardFooter({
  onNext,
  onBack,
  onSkip,
  nextLabel = 'Next',
  skipLabel,
  showSkip,
  nextDisabled = false,
  backDisabled = false,
  isLoading = false,
}: SetupWizardFooterProps) {
  const { currentStep, isLastStep, canGoPrevious, wizardSkipped } = useWizard();

  // Determine skip availability from step config if not explicitly provided
  const stepConfig = STEP_SKIP_CONFIG[currentStep] || { allowSkip: false };
  const shouldShowSkip = showSkip ?? stepConfig.allowSkip;
  const defaultSkipLabel = stepConfig.skipLabel || 'Skip';

  const handleBack = () => {
    if (onBack) {
      onBack();
    }
    // Default behavior: go to previous step
  };

  const handleNext = () => {
    if (onNext) {
      onNext();
    }
    // Default behavior: handled by parent
  };

  const handleSkip = () => {
    if (onSkip) {
      onSkip();
    }
    // Default behavior: handled by parent
  };

  return (
    <footer
      className="flex items-center justify-between border-t border-gray-700 bg-gray-900 px-6 py-4"
      role="navigation"
      aria-label="Wizard navigation"
    >
      {/* Back button */}
      <button
        type="button"
        onClick={handleBack}
        disabled={!canGoPrevious || backDisabled || isLoading}
        className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
          canGoPrevious && !backDisabled && !isLoading
            ? 'border border-gray-600 bg-gray-800 text-gray-200 hover:bg-gray-700'
            : 'cursor-not-allowed border border-gray-700 bg-gray-800 text-gray-500'
        }`}
        aria-label="Go to previous step"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 19l-7-7 7-7"
          />
        </svg>
        <span>Back</span>
      </button>

      {/* Center section with skip option */}
      <div className="flex items-center gap-4">
        {shouldShowSkip && !wizardSkipped && (
          <button
            type="button"
            onClick={handleSkip}
            disabled={isLoading}
            className={`rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
              isLoading
                ? 'cursor-not-allowed bg-gray-700 text-gray-500'
                : 'bg-transparent text-gray-400 hover:bg-gray-800 hover:text-gray-300'
            }`}
            aria-label={skipLabel || defaultSkipLabel}
          >
            {skipLabel || defaultSkipLabel}
          </button>
        )}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <svg
              className="h-4 w-4 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span>Processing...</span>
          </div>
        )}
      </div>

      {/* Next/Finish button */}
      <button
        type="button"
        onClick={handleNext}
        disabled={nextDisabled || isLoading}
        className={`flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-colors ${
          nextDisabled || isLoading
            ? 'cursor-not-allowed bg-indigo-800 text-indigo-400'
            : 'bg-indigo-600 text-white hover:bg-indigo-500'
        }`}
        aria-label={isLastStep ? 'Complete setup' : nextLabel}
      >
        <span>{isLastStep ? 'Finish Setup' : nextLabel}</span>
        {isLoading ? (
          <svg
            className="h-4 w-4 animate-spin"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        ) : (
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d={isLastStep ? 'M5 13l4 4L19 7' : 'M9 5l7 7-7 7'}
            />
          </svg>
        )}
      </button>
    </footer>
  );
}