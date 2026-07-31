import { useEffect, useMemo, useRef } from 'react';
import { Button } from './ui';

interface ConfirmDialogProps {
  isOpen?: boolean;
  open?: boolean;
  title: string;
  message: React.ReactNode;
  onConfirm: () => void;
  onCancel?: () => void;
  onClose?: () => void;
  confirmText?: string;
  confirmDisabled?: boolean;
}

export default function ConfirmDialog({
  isOpen,
  open,
  title,
  message,
  onConfirm,
  onCancel,
  onClose,
  confirmText,
  confirmDisabled,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const isDialogOpen = isOpen ?? open ?? false;
  const handleClose = useMemo(
    () => onClose ?? onCancel ?? (() => {}),
    [onClose, onCancel],
  );

  // Move focus into the dialog when it opens; restore focus when it closes.
  useEffect(() => {
    if (!isDialogOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();

    return () => {
      previouslyFocused?.focus();
    };
  }, [isDialogOpen]);

  // Trap focus inside the dialog while it is open.
  useEffect(() => {
    if (!isDialogOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        handleClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute('disabled'));

      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isDialogOpen, handleClose]);

  if (!isDialogOpen) return null;

  const titleId = 'confirm-dialog-title';
  const descId = 'confirm-dialog-desc';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50"
        onClick={handleClose}
        aria-hidden="true"
      />
      {/* Dialog panel */}
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="relative z-10 w-full max-w-md rounded-lg bg-surface p-6 shadow-lift"
      >
        <h3 id={titleId} className="text-lg font-semibold text-fg">{title}</h3>
        <p id={descId} className="mt-2 text-sm text-muted">{message}</p>
        <div className="mt-6 flex justify-end gap-3">
          <Button
            ref={cancelRef}
            type="button"
            variant="secondary"
            onClick={handleClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="dangerSolid"
            onClick={onConfirm}
            disabled={confirmDisabled}
          >
            {confirmText ?? 'Confirm'}
          </Button>
        </div>
      </div>
    </div>
  );
}
