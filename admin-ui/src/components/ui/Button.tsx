import type { ButtonHTMLAttributes } from 'react';
import { cn } from './cn';
import type { IconProps } from './icons';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerSolid' | 'accent';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: (props: IconProps) => React.JSX.Element;
  iconRight?: (props: IconProps) => React.JSX.Element;
  /** Stretch to the full width of the parent. */
  full?: boolean;
}

const sizeClasses: Record<ButtonSize, string> = {
  xs: 'h-[26px] px-2 text-xs gap-[5px]',
  sm: 'h-[30px] px-[11px] text-[12.5px] gap-1.5',
  md: 'h-9 px-3.5 text-[13.5px] gap-[7px]',
  lg: 'h-[42px] px-[18px] text-sm gap-2',
};

const iconSizeClasses: Record<ButtonSize, string> = {
  xs: 'h-3 w-3',
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-4 w-4',
};

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-on-accent border border-accent shadow-[0_1px_2px_rgba(0,0,0,0.06)] hover:bg-accent-hover hover:border-accent-hover hover:-translate-y-px disabled:hover:translate-y-0 disabled:hover:bg-accent',
  secondary:
    'bg-surface text-fg border border-line-strong shadow-soft hover:bg-hover hover:border-subtle',
  ghost:
    'bg-transparent text-muted border border-transparent hover:bg-hover hover:text-fg',
  danger:
    'bg-surface text-danger border border-danger-soft hover:bg-danger-soft',
  dangerSolid:
    'bg-danger text-white border border-danger hover:bg-[#b91c1c]',
  accent:
    'bg-emerald text-white border border-emerald hover:-translate-y-px hover:shadow-pop disabled:hover:translate-y-0',
};

export function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  full,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  const iconCls = iconSizeClasses[size];
  return (
    <button
      type={type}
      className={cn(
        'items-center justify-center rounded-lg font-medium leading-none tracking-[-0.005em] whitespace-nowrap transition-all duration-150',
        'cursor-pointer disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
        full ? 'flex w-full' : 'inline-flex',
        sizeClasses[size],
        variantClasses[variant],
        className,
      )}
      {...rest}
    >
      {Icon && <Icon className={iconCls} />}
      {children}
      {IconRight && <IconRight className={iconCls} />}
    </button>
  );
}
