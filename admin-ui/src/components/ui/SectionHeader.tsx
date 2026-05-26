import type { ReactNode } from 'react';

export interface SectionHeaderProps {
  title: ReactNode;
  hint?: ReactNode;
  eyebrow?: ReactNode;
  /** Trailing content (e.g. a button), right-aligned. */
  action?: ReactNode;
}

export function SectionHeader({ title, hint, eyebrow, action }: SectionHeaderProps) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        {eyebrow && (
          <div className="mb-1 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">
            {eyebrow}
          </div>
        )}
        <h2 className="text-lg font-semibold tracking-[-0.015em] text-fg">{title}</h2>
        {hint && <div className="mt-[3px] text-[12.5px] text-subtle">{hint}</div>}
      </div>
      {action}
    </div>
  );
}
