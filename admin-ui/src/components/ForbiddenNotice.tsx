import { useEffect, useState } from 'react';
import { FORBIDDEN_EVENT, type ForbiddenDetail } from '../api/client';
import { usePermissions } from '../hooks/usePermissions';
import { roleLabel } from '../auth/permissions';
import { Icons } from './ui';

const AUTO_HIDE_MS = 8000;

/**
 * Shows a dismissable notice whenever an admin API call answers 403, from
 * any page. It never signs the admin out (only a 401 does); the page that
 * made the call still handles its own error.
 */
export default function ForbiddenNotice() {
  const permissions = usePermissions();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const onForbidden = (event: Event) => {
      const detail = (event as CustomEvent<ForbiddenDetail>).detail;
      setMessage(detail?.message ?? 'Your admin role does not allow this action');
    };
    window.addEventListener(FORBIDDEN_EVENT, onForbidden);
    return () => window.removeEventListener(FORBIDDEN_EVENT, onForbidden);
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), AUTO_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [message]);

  if (!message) return null;
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-2.5 rounded-lg border border-warning-soft bg-surface p-4 text-sm text-fg shadow-float"
    >
      <Icons.Alert className="mt-0.5 h-4 w-4 shrink-0 text-warning-fg" />
      <div className="flex-1">
        <p className="font-semibold">You don't have permission to do that</p>
        <p className="mt-1 text-muted">{message}</p>
        {permissions.known && (
          <p className="mt-1 text-xs text-subtle">Signed in as {roleLabel(permissions)}.</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => setMessage(null)}
        aria-label="Dismiss"
        className="text-subtle hover:text-fg"
      >
        <Icons.X className="h-4 w-4" />
      </button>
    </div>
  );
}
