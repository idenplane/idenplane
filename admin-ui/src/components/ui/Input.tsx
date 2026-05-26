import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

export type InputSize = 'sm' | 'md' | 'lg';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  label?: string;
  error?: string;
  hint?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  size?: InputSize;
  /** Class names applied to the outer field container. */
  containerClassName?: string;
}

const heightClasses: Record<InputSize, string> = {
  sm: 'h-8',
  md: 'h-[38px]',
  lg: 'h-11',
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, prefix, suffix, size = 'md', id, className, containerClassName, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-[12.5px] font-medium text-fg">
          {label}
        </label>
      )}
      <div
        className={cn(
          'relative flex items-center rounded-lg border bg-surface transition-all duration-150',
          'focus-within:shadow-[var(--shadow-focus)]',
          error ? 'border-danger focus-within:shadow-none' : 'border-line-strong focus-within:border-accent',
          heightClasses[size],
          containerClassName,
        )}
      >
        {prefix && <span className="flex pl-3 text-subtle">{prefix}</span>}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            'h-full flex-1 border-none bg-transparent px-3 text-[13.5px] text-fg outline-none placeholder:text-subtle',
            className,
          )}
          {...rest}
        />
        {suffix && <span className="flex pr-2 text-subtle">{suffix}</span>}
      </div>
      {error && <span className="text-xs text-danger">{error}</span>}
      {!error && hint && <span className="text-xs text-subtle">{hint}</span>}
    </div>
  );
});
