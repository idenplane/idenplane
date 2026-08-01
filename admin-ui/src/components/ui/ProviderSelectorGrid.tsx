import type { ReactNode } from 'react';
import { cn } from './cn';

export interface ProviderOption<T extends string> {
  value: T;
  label: string;
  description: string;
  badge?: string;
  icon: ReactNode;
}

export interface ProviderSelectorGridProps<T extends string> {
  options: ProviderOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Grid column classes, e.g. `grid-cols-3` or `grid-cols-3 sm:grid-cols-5`. */
  columnsClassName?: string;
}

/**
 * Card-grid provider picker shared by EmailProviderForm and SmsProviderForm
 * (previously two near-identical copies of this exact markup).
 */
export function ProviderSelectorGrid<T extends string>({
  options,
  value,
  onChange,
  columnsClassName = 'grid-cols-3',
}: ProviderSelectorGridProps<T>) {
  return (
    <div className={cn('grid gap-3', columnsClassName)}>
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'relative flex flex-col gap-1.5 rounded-lg border-2 p-4 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              selected
                ? 'border-accent bg-accent-soft'
                : 'border-line bg-surface hover:border-line-strong hover:bg-hover',
            )}
            aria-pressed={selected}
          >
            {option.badge && (
              <span className="absolute right-2 top-2 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                {option.badge}
              </span>
            )}
            <span
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-md',
                selected ? 'bg-accent text-white' : 'bg-sunken text-subtle',
              )}
            >
              {option.icon}
            </span>
            <span className={cn('text-sm font-semibold', selected ? 'text-accent' : 'text-fg')}>
              {option.label}
            </span>
            <span className="text-xs leading-snug text-subtle">{option.description}</span>
          </button>
        );
      })}
    </div>
  );
}
