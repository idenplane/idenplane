import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';
import { Icons } from './icons';
import type { IconComponent } from './icons';

export type AlertVariant = 'danger' | 'warning' | 'info' | 'success';

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Visual/semantic tone. Defaults to `danger` — the most common use case
   * (query/mutation error banners, replacing the old hand-rolled
   * `rounded-md bg-red-50 p-4 text-sm text-red-700` pattern). */
  variant?: AlertVariant;
  /** Optional bold lead-in line above the body content. */
  title?: ReactNode;
  /** Override the default per-variant icon; pass `null` to omit the icon. */
  icon?: IconComponent | null;
  children: ReactNode;
}

const variantClasses: Record<AlertVariant, string> = {
  danger: 'bg-danger-soft text-danger-fg border-danger-soft',
  warning: 'bg-warning-soft text-warning-fg border-warning-soft',
  info: 'bg-info-soft text-info-fg border-info-soft',
  success: 'bg-success-soft text-success-fg border-success-soft',
};

const variantIcons: Record<AlertVariant, IconComponent> = {
  danger: Icons.XCircle,
  warning: Icons.Alert,
  info: Icons.Info,
  success: Icons.CheckCircle,
};

/**
 * Token-based error/status banner. Replaces the hand-rolled
 * `<div className="rounded-md bg-red-50 p-4 text-sm text-red-700">…</div>`
 * pattern that was duplicated across ~36 pages for query/mutation error
 * states, plus warning/info/success variants of the same shape.
 */
export function Alert({
  variant = 'danger',
  title,
  icon,
  className,
  children,
  role = 'alert',
  ...rest
}: AlertProps) {
  const Icon = icon === null ? null : (icon ?? variantIcons[variant]);
  return (
    <div
      role={role}
      className={cn(
        'flex items-start gap-2.5 rounded-md border p-4 text-sm',
        variantClasses[variant],
        className,
      )}
      {...rest}
    >
      {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0" />}
      <div className="min-w-0 flex-1">
        {title && <div className="font-medium leading-5">{title}</div>}
        <div className={cn('leading-5', title ? 'mt-0.5' : undefined)}>{children}</div>
      </div>
    </div>
  );
}
