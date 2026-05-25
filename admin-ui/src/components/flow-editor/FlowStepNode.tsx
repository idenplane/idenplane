import { memo } from 'react';
import type { FlowStep } from '../../api/authFlows';
import { STEP_TYPE_META } from './stepTypeMeta';

// ─── Component ───────────────────────────────────────────────

interface FlowStepNodeProps {
  step: FlowStep;
  isSelected: boolean;
  isPreview?: boolean;
  /** Called when the user clicks on the node */
  onSelect: (step: FlowStep) => void;
  /** Called when the up-arrow is pressed */
  onMoveUp?: () => void;
  /** Called when the down-arrow is pressed */
  onMoveDown?: () => void;
  /** Called when the delete button is pressed */
  onDelete?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}

export default memo(function FlowStepNode({
  step,
  isSelected,
  isPreview = false,
  onSelect,
  onMoveUp,
  onMoveDown,
  onDelete,
  canMoveUp = true,
  canMoveDown = true,
}: FlowStepNodeProps) {
  const meta = STEP_TYPE_META[step.type];

  return (
    <div
      data-testid={`flow-step-node-${step.id}`}
      onClick={() => onSelect(step)}
      className={`relative flex cursor-pointer flex-col rounded-lg border-2 p-4 shadow-sm transition-all ${meta.color} ${
        isSelected ? 'ring-2 ring-indigo-500 ring-offset-2' : 'hover:shadow-md'
      }`}
    >
      {/* Header row */}
      <div className="flex items-center gap-3">
        <span className="text-2xl" role="img" aria-label={meta.label}>
          {meta.icon}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-800 truncate">
              {meta.label}
            </span>
            {step.required && (
              <span className="inline-flex shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                Required
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            Step {step.order}
            {step.condition && (
              <span className="ml-2 text-amber-600">• Conditional</span>
            )}
            {step.fallbackStepId && (
              <span className="ml-2 text-red-500">• Has fallback</span>
            )}
          </div>
        </div>

        {/* Action buttons – hidden in preview mode */}
        {!isPreview && (
          <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              aria-label="Move step up"
              disabled={!canMoveUp}
              onClick={onMoveUp}
              className="rounded p-1 text-gray-400 hover:bg-white/60 hover:text-gray-700 disabled:opacity-30"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
              </svg>
            </button>
            <button
              aria-label="Move step down"
              disabled={!canMoveDown}
              onClick={onMoveDown}
              className="rounded p-1 text-gray-400 hover:bg-white/60 hover:text-gray-700 disabled:opacity-30"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 011.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
            <button
              aria-label="Delete step"
              onClick={onDelete}
              className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Step ID chip */}
      <div className="mt-2 self-start rounded bg-white/70 px-1.5 py-0.5 text-xs font-mono text-gray-400">
        {step.id}
      </div>
    </div>
  );
});
