import { cn } from './cn';
import type { IconProps } from './icons';

export interface SegmentedOption {
  id: string;
  label: string;
  icon?: (props: IconProps) => React.JSX.Element;
  count?: number;
}

export interface SegmentedProps {
  options: SegmentedOption[];
  value: string;
  onChange: (id: string) => void;
  size?: 'sm' | 'md';
}

export function Segmented({ options, value, onChange, size = 'md' }: SegmentedProps) {
  return (
    <div
      className={cn(
        'inline-flex gap-0.5 rounded-lg border border-line bg-sunken p-[3px]',
        size === 'sm' ? 'h-7' : 'h-8',
      )}
      role="tablist"
    >
      {options.map((o) => {
        const active = o.id === value;
        const Icon = o.icon;
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.id)}
            className={cn(
              'inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 text-[12.5px] transition-all duration-100',
              'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
              active ? 'bg-surface font-semibold text-fg shadow-soft' : 'font-medium text-muted hover:text-fg',
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {o.label}
            {o.count != null && <span className="text-[11px] font-medium opacity-65">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
