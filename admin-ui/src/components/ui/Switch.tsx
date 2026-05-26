import { cn } from './cn';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  hint?: string;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, hint, disabled }: SwitchProps) {
  return (
    <label className={cn('flex items-center gap-3', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full border-none transition-colors duration-200',
          'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
          checked ? 'bg-accent' : 'bg-active',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-[left] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]',
            checked ? 'left-[18px]' : 'left-0.5',
          )}
        />
      </button>
      {label && (
        <span className="flex flex-col">
          <span className="text-[13.5px] font-medium text-fg">{label}</span>
          {hint && <span className="text-xs text-subtle">{hint}</span>}
        </span>
      )}
    </label>
  );
}
