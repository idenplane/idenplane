import type { ReactNode } from 'react';

export interface KbdProps {
  children: ReactNode;
}

export function Kbd({ children }: KbdProps) {
  return (
    <kbd className="inline-flex min-w-[18px] items-center justify-center rounded border border-line bg-surface px-1.5 py-0.5 text-center font-mono text-[10.5px] leading-[1.2] text-muted shadow-[0_1px_0_var(--border)]">
      {children}
    </kbd>
  );
}
