import type { StepType } from '../../api/authFlows';
import { STEP_TYPE_META } from './stepTypeMeta';

interface FlowStepPaletteProps {
  onAddStep: (type: StepType) => void;
}

const ALL_STEP_TYPES: StepType[] = [
  'password',
  'totp',
  'webauthn',
  'social',
  'ldap',
  'email_otp',
  'consent',
];

export default function FlowStepPalette({ onAddStep }: FlowStepPaletteProps) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
        Step Types
      </p>
      {ALL_STEP_TYPES.map((type) => {
        const meta = STEP_TYPE_META[type];
        return (
          <button
            key={type}
            data-testid={`palette-step-${type}`}
            onClick={() => onAddStep(type)}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-step-type', type);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            className={`flex cursor-grab items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-medium transition-shadow hover:shadow-md active:cursor-grabbing ${meta.color}`}
          >
            <span role="img" aria-label={meta.label} className="text-lg">
              {meta.icon}
            </span>
            <span className="text-gray-700">{meta.label}</span>
          </button>
        );
      })}
    </div>
  );
}
