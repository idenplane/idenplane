import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  ADMIN_MFA_EVENT,
  STEP_UP_DONE_EVENT,
  type AdminMfaEventDetail,
} from '../api/client';
import {
  getMfaStatus,
  stepUpPasskeyOptions,
  stepUpWithCode,
  stepUpWithPasskey,
  type AdminMfaStatus,
} from '../api/adminMfa';
import { useAuth } from '../hooks/useAuth';
import { getErrorMessage } from '../utils/getErrorMessage';
import { getPasskey, passkeysSupported } from '../utils/webauthn';
import { Alert, Button, Icons, Input } from './ui';

export const MFA_PAGE = '/console/mfa';

function finish(ok: boolean) {
  window.dispatchEvent(new CustomEvent(STEP_UP_DONE_EVENT, { detail: { ok } }));
}

/**
 * Answers the server's admin-MFA refusals, wherever they come from:
 *
 * - enrolment required: opens the MFA page;
 * - a password-only session, or a sensitive action that needs a recent
 *   check: asks for the second factor again (step-up) and keeps the new
 *   token. `withStepUp` then retries the action; elsewhere the admin
 *   repeats it.
 */
export default function StepUpPrompt() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathRef = useRef(location.pathname);
  useEffect(() => {
    pathRef.current = location.pathname;
  }, [location.pathname]);
  const { keepToken } = useAuth();

  const [reason, setReason] = useState<string | null>(null);
  const [status, setStatus] = useState<AdminMfaStatus | null>(null);
  const [method, setMethod] = useState<'totp' | 'recovery'>('totp');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onRefusal(event: Event) {
      const { code: refusal } = (event as CustomEvent<AdminMfaEventDetail>).detail;
      if (refusal === 'admin_mfa_enrolment_required') {
        if (!pathRef.current.startsWith(MFA_PAGE)) navigate(MFA_PAGE);
        return;
      }
      setCode('');
      setError('');
      setReason((open) => open ?? refusal);
    }
    window.addEventListener(ADMIN_MFA_EVENT, onRefusal);
    return () => window.removeEventListener(ADMIN_MFA_EVENT, onRefusal);
  }, [navigate]);

  useEffect(() => {
    if (!reason) return;
    getMfaStatus()
      .then((s) => {
        setStatus(s);
        setMethod(s.totp ? 'totp' : 'recovery');
      })
      .catch(() => setStatus(null));
  }, [reason]);

  if (!reason) return null;

  const close = (ok: boolean) => {
    setReason(null);
    setStatus(null);
    finish(ok);
  };

  const verified = (token: string) => {
    keepToken(token);
    close(true);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      verified(await stepUpWithCode(method, code));
    } catch (err) {
      setError(getErrorMessage(err, 'The code was not accepted'));
    } finally {
      setBusy(false);
    }
  }

  async function verifyWithPasskey() {
    setBusy(true);
    setError('');
    try {
      const options = await stepUpPasskeyOptions();
      verified(await stepUpWithPasskey(await getPasskey(options)));
    } catch (err) {
      setError(getErrorMessage(err, 'The passkey was not accepted'));
    } finally {
      setBusy(false);
    }
  }

  const canUsePasskey = (status?.passkeys.length ?? 0) > 0 && passkeysSupported();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" onClick={() => close(false)} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="step-up-title"
        className="relative z-10 w-full max-w-md rounded-lg bg-surface p-6 shadow-lift"
      >
        <div className="flex items-center gap-2">
          <Icons.ShieldCheck className="h-5 w-5 text-accent" />
          <h3 id="step-up-title" className="text-lg font-semibold text-fg">
            Verify it&apos;s you
          </h3>
        </div>
        <p className="mt-2 text-sm text-muted">
          {reason === 'admin_mfa_step_up_required'
            ? 'This session was signed in with a password only. Verify your second factor to continue.'
            : 'This action needs your second factor verified in the last 15 minutes.'}
        </p>

        <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
          <Input
            autoFocus
            label={method === 'totp' ? 'Authenticator code' : 'Recovery code'}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
            inputMode={method === 'totp' ? 'numeric' : 'text'}
            placeholder={method === 'totp' ? '123456' : 'xxxxxx-xxxxxx-xxxxxx-xxxxxx'}
            required
          />
          {status?.totp && status.recoveryCodes.remaining > 0 && (
            <button
              type="button"
              className="self-start text-sm font-medium text-accent hover:text-accent-hover"
              onClick={() => setMethod(method === 'totp' ? 'recovery' : 'totp')}
            >
              {method === 'totp' ? 'Use a recovery code instead' : 'Use the authenticator app'}
            </button>
          )}
          {error && <Alert>{error}</Alert>}
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => close(false)} disabled={busy}>
              Cancel
            </Button>
            {canUsePasskey && (
              <Button type="button" variant="secondary" onClick={() => void verifyWithPasskey()} disabled={busy}>
                Use a passkey
              </Button>
            )}
            <Button type="submit" disabled={busy || !code.trim()}>
              {busy ? 'Verifying…' : 'Verify'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
