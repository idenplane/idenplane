import type { ReactNode } from 'react';
import type { IconProps } from './icons';

export interface EmptyStateProps {
  icon?: (props: IconProps) => React.JSX.Element;
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, hint, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-[60px] text-center">
      {Icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sunken text-subtle">
          <Icon className="h-[22px] w-[22px]" />
        </div>
      )}
      <div>
        <div className="text-[15px] font-semibold text-fg">{title}</div>
        {hint && <div className="mt-1 text-[13px] text-subtle">{hint}</div>}
      </div>
      {action}
    </div>
  );
}
