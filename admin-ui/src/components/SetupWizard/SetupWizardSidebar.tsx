/**
 * SetupWizardSidebar — sidebar with step navigation and help tooltips.
 *
 * Displays a sidebar with wizard steps, help tooltips for each step,
 * and navigation controls. Follows the Layout.tsx sidebar pattern with
 * collapsible sections and dark theme styling.
 */

import { useState, useRef, useEffect } from 'react';
import { useWizard } from '../../context/WizardContext';

interface HelpTooltip {
  title: string;
  content: string;
}

const STEP_TOOLTIPS: Record<number, HelpTooltip> = {
  0: {
    title: 'Admin Account',
    content: 'Create your master administrator account. This account will have full access to manage your AuthMe instance.',
  },
  1: {
    title: 'Realm Settings',
    content: 'Configure your master realm settings. The realm is the top-level container for users, clients, and authentication flows.',
  },
  2: {
    title: 'SMTP Configuration',
    content: 'Configure SMTP settings for sending emails (password reset, verification, etc.). This step is optional but recommended.',
  },
  3: {
    title: 'First Client',
    content: 'Create your first client application. A client represents an application that will use AuthMe for authentication.',
  },
  4: {
    title: 'SDK Integration',
    content: 'Get code snippets to integrate your application with AuthMe using our SDK. Supports multiple frameworks and languages.',
  },
  5: {
    title: 'Test Authentication',
    content: 'Test your authentication flow by performing a complete login. This verifies your setup is working correctly.',
  },
};

interface StepNavItemProps {
  stepNumber: number;
  name: string;
  description: string;
  isCompleted: boolean;
  isCurrent: boolean;
  isSkipped: boolean;
  onClick: () => void;
  onHelpClick: (e: React.MouseEvent) => void;
}

function StepNavItem({
  stepNumber,
  name,
  description,
  isCompleted,
  isCurrent,
  isSkipped,
  onClick,
  onHelpClick,
}: StepNavItemProps) {
  return (
    <div
      className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-150 ${
        isCurrent
          ? 'bg-indigo-600 text-white'
          : isCompleted
          ? 'bg-green-600/20 text-green-300 hover:bg-green-600/30 cursor-pointer'
          : isSkipped
          ? 'bg-gray-700/50 text-gray-400 cursor-pointer'
          : 'text-gray-400 hover:bg-gray-800 cursor-pointer'
      }`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      aria-current={isCurrent ? 'step' : undefined}
    >
      {/* Step number circle */}
      <div
        className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          isCurrent
            ? 'bg-white text-indigo-600'
            : isCompleted
            ? 'bg-green-500 text-white'
            : isSkipped
            ? 'bg-gray-600 text-gray-400'
            : 'bg-gray-700 text-gray-400'
        }`}
        aria-hidden="true"
      >
        {isCompleted ? (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        ) : isSkipped ? (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        ) : (
          stepNumber + 1
        )}
      </div>

      {/* Step info */}
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium truncate ${isCurrent ? 'text-white' : ''}`}>
          {name}
        </p>
        <p className={`text-xs truncate ${isCurrent ? 'text-indigo-200' : 'text-gray-500'}`}>
          {isSkipped ? 'Skipped' : description}
        </p>
      </div>

      {/* Help button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onHelpClick(e);
        }}
        className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs transition-colors ${
          isCurrent
            ? 'bg-indigo-500 text-white hover:bg-indigo-400'
            : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-300'
        }`}
        aria-label={`Help for ${name}`}
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </button>
    </div>
  );
}

interface HelpTooltipPanelProps {
  tooltip: HelpTooltip;
  onClose: () => void;
  position?: 'left' | 'right';
}

function HelpTooltipPanel({ tooltip, onClose, position = 'right' }: HelpTooltipPanelProps) {
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={tooltipRef}
      className={`absolute z-50 w-72 rounded-lg border border-gray-600 bg-gray-800 p-4 shadow-xl ${
        position === 'right' ? 'left-full top-0 ml-3' : 'right-full top-0 mr-3'
      }`}
      role="dialog"
      aria-label={tooltip.title}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-indigo-600/20">
          <svg className="h-5 w-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <div className="flex-1">
          <h4 className="text-sm font-semibold text-white">{tooltip.title}</h4>
          <p className="mt-1.5 text-sm text-gray-400">{tooltip.content}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-gray-500 hover:text-gray-300"
          aria-label="Close help"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default function SetupWizardSidebar() {
  const { currentStep, setCurrentStep, wizardSkipped } = useWizard();
  const [helpTooltip, setHelpTooltip] = useState<{ step: number; position: 'left' | 'right' } | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const steps = [
    { name: 'Admin Account', description: 'Create your admin account', required: true },
    { name: 'Realm Settings', description: 'Configure master realm settings', required: true },
    { name: 'SMTP Configuration', description: 'Set up email notifications', required: false },
    { name: 'First Client', description: 'Create your first application', required: true },
    { name: 'SDK Integration', description: 'Get integration code snippets', required: true },
    { name: 'Test Authentication', description: 'Test your auth flow', required: true },
  ];

  const handleHelpClick = (stepNumber: number, event: React.MouseEvent) => {
    event.stopPropagation();
    // Determine tooltip position based on available space
    const rect = (event.target as HTMLElement).getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const position = rect.left > viewportWidth / 2 ? 'left' : 'right';
    setHelpTooltip({ step: stepNumber, position });
  };

  const closeHelpTooltip = () => {
    setHelpTooltip(null);
  };

  const handleStepClick = (stepNumber: number) => {
    // Only allow navigating to completed steps or the current step
    if (stepNumber <= currentStep) {
      setCurrentStep(stepNumber);
    }
  };

  return (
    <aside
      className={`flex h-full flex-col bg-gray-900 text-white transition-all duration-200 ${
        isCollapsed ? 'w-16' : 'w-72'
      }`}
      aria-label="Setup wizard sidebar"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-700 px-4 py-4">
        {!isCollapsed && (
          <div>
            <h2 className="text-base font-semibold">Setup Wizard</h2>
            <p className="mt-0.5 text-xs text-gray-400">
              {wizardSkipped ? 'Configuration skipped' : 'Complete all steps'}
            </p>
          </div>
        )}
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!isCollapsed}
        >
          <svg
            className={`h-5 w-5 transition-transform ${isCollapsed ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>
      </div>

      {/* Step navigation */}
      <nav aria-label="Wizard steps" className="flex-1 overflow-y-auto px-3 py-4">
        {!isCollapsed ? (
          <ol className="space-y-2">
            {steps.map((step, index) => (
              <li key={index} className="relative">
                <StepNavItem
                  stepNumber={index}
                  name={step.name}
                  description={step.description}
                  isCompleted={index < currentStep}
                  isCurrent={index === currentStep}
                  isSkipped={wizardSkipped && index > currentStep}
                  onClick={() => handleStepClick(index)}
                  onHelpClick={(e) => handleHelpClick(index, e as unknown as React.MouseEvent)}
                />

                {/* Help tooltip */}
                {helpTooltip?.step === index && (
                  <HelpTooltipPanel
                    tooltip={STEP_TOOLTIPS[index]}
                    onClose={closeHelpTooltip}
                    position={helpTooltip.position}
                  />
                )}
              </li>
            ))}
          </ol>
        ) : (
          /* Collapsed view - just step numbers */
          <ol className="flex flex-col items-center space-y-3">
            {steps.map((_, index) => (
              <button
                key={index}
                type="button"
                onClick={() => {
                  setIsCollapsed(false);
                  setCurrentStep(index);
                }}
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold transition-colors ${
                  index === currentStep
                    ? 'bg-indigo-600 text-white'
                    : index < currentStep
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                }`}
                aria-label={`Go to step ${index + 1}: ${steps[index].name}`}
              >
                {index < currentStep ? (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  index + 1
                )}
              </button>
            ))}
          </ol>
        )}
      </nav>

      {/* Footer with help info */}
      {!isCollapsed && (
        <div className="border-t border-gray-700 px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span>Click on completed steps to navigate back</span>
          </div>
        </div>
      )}
    </aside>
  );
}