import type { HTMLAttributes } from 'react';
import { cn } from './cn';

export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
  /** Lift the shadow on hover (use for clickable/linked cards). */
  hover?: boolean;
}

const paddingClasses: Record<CardPadding, string> = {
  none: 'p-0',
  sm: 'p-[18px]',
  md: 'p-5',
  lg: 'p-6',
};

export function Card({ padding = 'md', hover, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-line bg-surface shadow-soft',
        'transition-[box-shadow,border-color,transform] duration-200',
        hover && 'hover:shadow-lift',
        rest.onClick && 'cursor-pointer',
        paddingClasses[padding],
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
