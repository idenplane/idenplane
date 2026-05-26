import type { ButtonHTMLAttributes } from 'react';
import { cn } from './cn';
import type { IconProps } from './icons';

export type IconButtonSize = 'sm' | 'md' | 'lg';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  icon: (props: IconProps) => React.JSX.Element;
  /** Accessible label — also used as the tooltip title. */
  label: string;
  size?: IconButtonSize;
  active?: boolean;
}

const boxClasses: Record<IconButtonSize, string> = {
  sm: 'h-7 w-7',
  md: 'h-[34px] w-[34px]',
  lg: 'h-10 w-10',
};

const glyphClasses: Record<IconButtonSize, string> = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-[18px] w-[18px]',
};

export function IconButton({ icon: Icon, label, size = 'md', active, type = 'button', className, ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex items-center justify-center rounded-lg border transition-all duration-150 cursor-pointer',
        'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
        active
          ? 'bg-active border-line text-fg'
          : 'bg-transparent border-transparent text-muted hover:bg-hover',
        boxClasses[size],
        className,
      )}
      {...rest}
    >
      <Icon className={glyphClasses[size]} />
    </button>
  );
}
