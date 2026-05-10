/**
 * SetupWizardProgress — step progress indicators for the setup wizard.
 *
 * Displays a visual progress bar and numbered step indicators showing:
 * - Current step (highlighted)
 * - Completed steps (with checkmark)
 * - Upcoming steps (dimmed)
 *
 * Follows the Breadcrumbs component pattern for accessibility and styling.
 */

import { useWizard } from '../../context/WizardContext';

interface StepIndicatorProps {
  stepNumber: number;
  name: string;
  description: string;
  isCompleted: boolean;
  isCurrent: boolean;
  isClickable?: boolean;
  onClick?: () => void;
}

function StepIndicator({
  stepNumber,
  name,
  description,
  isCompleted,
  isCurrent,
  isClickable = false,
  onClick,
}: StepIndicatorProps) {
  const baseClasses = 'flex items-start gap-3 p-3 rounded-lg transition-colors';

  const stateClasses = isCurrent
    ? 'bg-indigo-50 border border-indigo-200'
    : isCompleted
    ? 'bg-green-50 border border-green-200'
    : 'bg-gray-50 border border-transparent hover:bg-gray-100';

  const clickableClasses = isClickable && !isCurrent ? ' cursor-pointer' : '';

  const content = (
    <>
      {/* Step number circle */}
      <div
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
          isCompleted
            ? 'bg-green-500 text-white'
            : isCurrent
            ? 'bg-indigo-600 text-white'
            : 'bg-gray-300 text-gray-600'
        }`}
        aria-hidden="true"
      >
        {isCompleted ? (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          stepNumber + 1
        )}
      </div>

      {/* Step info */}
      <div className="min-w-0 flex-1">
        <p
          className={`text-sm font-medium ${
            isCurrent ? 'text-indigo-900' : isCompleted ? 'text-green-900' : 'text-gray-700'
          }`}
        >
          {name}
        </p>
        <p
          className={`mt-0.5 text-xs ${
            isCurrent ? 'text-indigo-600' : isCompleted ? 'text-green-600' : 'text-gray-500'
          }`}
        >
          {description}
        </p>
      </div>
    </>
  );

  if (isClickable && onClick && !isCurrent) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${baseClasses}${stateClasses}${clickableClasses} w-full text-left`}
        aria-current={isCurrent ? 'step' : undefined}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={`${baseClasses}${stateClasses}${clickableClasses}`}
      aria-current={isCurrent ? 'step' : undefined}
    >
      {content}
    </div>
  );
}

export default function SetupWizardProgress() {
  const { currentStep, getStepInfo, setCurrentStep } = useWizard();

  // Define all wizard steps with their info
  const steps = [
    { name: 'Admin Account', description: 'Create your admin account', required: true },
    { name: 'Realm Settings', description: 'Configure master realm settings', required: true },
    { name: 'SMTP Configuration', description: 'Set up email notifications (optional)', required: false },
    { name: 'First Client', description: 'Create your first application', required: true },
    { name: 'SDK Integration', description: 'Get integration code snippets', required: true },
    { name: 'Test Authentication', description: 'Test your auth flow', required: true },
  ];

  // Calculate progress percentage
  const progressPercentage = (currentStep / (steps.length - 1)) * 100;

  return (
    <div className="rounded-lg bg-white p-4 shadow-sm" role="navigation" aria-label="Wizard progress">
      {/* Progress bar */}
      <div className="mb-4">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-gray-600">Progress</span>
          <span className="text-xs font-medium text-gray-600">
            Step {currentStep + 1} of {steps.length}
          </span>
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-gray-200"
          role="progressbar"
          aria-valuenow={currentStep + 1}
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-label={`Step ${currentStep + 1} of ${steps.length} completed`}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-indigo-600 transition-all duration-300 ease-out"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
      </div>

      {/* Step indicators */}
      <ol className="space-y-2" aria-label="Wizard steps">
        {steps.map((step, index) => {
          const stepInfo = getStepInfo(index);
          const isCompleted = stepInfo?.completed ?? false;
          const isCurrent = index === currentStep;

          return (
            <li key={index}>
              <StepIndicator
                stepNumber={index}
                name={step.name}
                description={step.description}
                isCompleted={isCompleted}
                isCurrent={isCurrent}
                isClickable={index < currentStep || isCompleted}
                onClick={() => setCurrentStep(index)}
              />
            </li>
          );
        })}
      </ol>

      {/* Optional label */}
      <p className="mt-4 text-center text-xs text-gray-500">
        Click on completed steps to navigate back
      </p>
    </div>
  );
}