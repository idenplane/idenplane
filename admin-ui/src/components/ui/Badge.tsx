import type { ReactNode } from 'react';
import { cn } from './cn';

export type BadgeVariant = 'success' | 'danger' | 'warning' | 'info' | 'accent' | 'emerald' | 'neutral';
export type BadgeSize = 'sm' | 'md';

export interface BadgeProps {
  variant?: BadgeVariant;
  size?: BadgeSize;
  /** Show a leading pulsing status dot. */
  dot?: boolean;
  /** Render the label in the monospace face (for codes/event types). */
  mono?: boolean;
  className?: string;
  children: ReactNode;
}

const variantClasses: Record<BadgeVariant, string> = {
  success: 'bg-success-soft text-success-fg',
  danger: 'bg-danger-soft text-danger-fg',
  warning: 'bg-warning-soft text-warning-fg',
  info: 'bg-info-soft text-info-fg',
  accent: 'bg-accent-soft text-accent-strong',
  emerald: 'bg-emerald-soft text-emerald-fg',
  neutral: 'bg-sunken text-muted',
};

export function Badge({ variant = 'neutral', size = 'md', dot, mono, className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-[5px] rounded-full font-medium leading-[1.3] whitespace-nowrap',
        size === 'sm' ? 'px-[7px] py-[2px]' : 'px-[9px] py-[3px]',
        mono ? 'font-mono tracking-[0.02em] text-[10.5px]' : 'text-[11.5px]',
        variantClasses[variant],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse-dot" />}
      {children}
    </span>
  );
}
