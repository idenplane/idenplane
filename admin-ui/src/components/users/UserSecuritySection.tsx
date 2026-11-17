import { useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getMfaStatus,
  getPasskeys,
  removePasskey,
  resetMfa,
  resetSmsMfa,
  resetPassword,
  type UserPasskey,
} from '../../api/users';
import ConfirmDialog from '../ConfirmDialog';
import PasswordInput from '../PasswordInput';
import { useCanWriteRealm } from '../../hooks/usePermissions';

type UserSecuritySectionProps = {
  realmName: string;
  userId: string;
  username: string;
};

export default function UserSecuritySection({ realmName, userId, username }: UserSecuritySectionProps) {
  const canWrite = useCanWriteRealm(realmName);
  const queryClient = useQueryClient();
  const [showResetMfa, setShowResetMfa] = useState(false);
  const [showResetSms, setShowResetSms] = useState(false);
  const [keepPasskeys, setKeepPasskeys] = useState(false);
  const [passkeyToRemove, setPasskeyToRemove] = useState<UserPasskey | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState('');

  const { data: mfaStatus } = useQuery({
    queryKey: ['mfaStatus', realmName, userId],
    queryFn: () => getMfaStatus(realmName, userId),
  });

  const passkeyCount = mfaStatus?.passkeys ?? 0;
  const { data: passkeys = [] } = useQuery({
    queryKey: ['userPasskeys', realmName, userId],
    queryFn: () => getPasskeys(realmName, userId),
    enabled: passkeyCount > 0,
  });

  const invalidateSecurity = () => {
    queryClient.invalidateQueries({ queryKey: ['mfaStatus', realmName, userId] });
    queryClient.invalidateQueries({ queryKey: ['userPasskeys', realmName, userId] });
  };

  const resetPwMutation = useMutation({
    mutationFn: () => resetPassword(realmName, userId, newPassword),
    onSuccess: () => {
      setNewPassword('');
      setPasswordMsg('Password reset successfully.');
    },
    onError: () => {
      setPasswordMsg('Failed to reset password.');
    },
  });

  const resetMfaMutation = useMutation({
    mutationFn: () => resetMfa(realmName, userId, { keepPasskeys }),
    onSuccess: () => {
      invalidateSecurity();
      setShowResetMfa(false);
    },
  });

  const resetSmsMutation = useMutation({
    mutationFn: () => resetSmsMfa(realmName, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mfaStatus', realmName, userId] });
      setShowResetSms(false);
    },
  });

  const removePasskeyMutation = useMutation({
    mutationFn: (id: string) => removePasskey(realmName, userId, id),
    onSuccess: () => {
      invalidateSecurity();
      setPasskeyToRemove(null);
    },
  });

  const methods = mfaStatus?.methods ?? [];
  const hasAnyFactor = !!mfaStatus?.enabled || passkeyCount > 0;
  const METHOD_LABELS: Record<string, string> = {
    totp: 'Authenticator app',
    sms: 'Text message',
  };

  function handleResetPassword(e: FormEvent) {
    e.preventDefault();
    setPasswordMsg('');
    resetPwMutation.mutate();
  }

  return (
    <>
      {/* Set Password */}
      <form onSubmit={handleResetPassword} className="space-y-4 rounded-lg border border-line bg-surface p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-fg">Set Password</h2>

        <div>
          <label htmlFor="field-user-newPassword" className="mb-1.5 block text-sm font-medium text-muted">New Password</label>
          <PasswordInput
            id="field-user-newPassword"
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
        </div>

        {passwordMsg && (
          <div
            className={`rounded-md p-3 text-sm ${
              passwordMsg.includes('success')
                ? 'bg-success-soft text-success-fg'
                : 'bg-danger-soft text-danger-fg'
            }`}
          >
            {passwordMsg}
          </div>
        )}

        {!canWrite && (
          <p className="text-xs text-subtle">Read-only: your admin role can't change this realm.</p>
        )}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!canWrite || resetPwMutation.isPending}
            className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {resetPwMutation.isPending ? 'Resetting...' : 'Reset Password'}
          </button>
        </div>
      </form>

      {/* Security - MFA Status */}
      <div className="space-y-4 rounded-lg border border-line bg-surface p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-fg">Security</h2>

        <div>
          <h3 className="mb-2 text-sm font-medium text-muted">MFA Status</h3>
          <div className="flex flex-wrap items-center gap-3">
            {mfaStatus?.enabled ? (
              <>
                <span className="inline-flex rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-medium text-success-fg">
                  Enabled
                </span>
                {methods.map((m) => (
                  <span
                    key={m}
                    className="inline-flex rounded-full bg-active px-2.5 py-0.5 text-xs font-medium text-muted"
                  >
                    {METHOD_LABELS[m] ?? m}
                  </span>
                ))}
                {canWrite && methods.includes('sms') && methods.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setShowResetSms(true)}
                    className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-muted hover:bg-active"
                  >
                    Remove phone
                  </button>
                )}
              </>
            ) : (
              <span className="inline-flex rounded-full bg-warning-soft px-2.5 py-0.5 text-xs font-medium text-warning-fg">
                Not configured
              </span>
            )}
            {/* Shown for a passkey-only user too: a passkey registered by
                someone who took the account over must be removable. */}
            {canWrite && hasAnyFactor && (
              <button
                type="button"
                onClick={() => {
                  setKeepPasskeys(false);
                  setShowResetMfa(true);
                }}
                className="rounded-md border border-danger-soft px-3 py-1.5 text-sm font-medium text-danger-fg hover:bg-danger-soft"
              >
                Reset MFA
              </button>
            )}
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-medium text-muted">Passkeys</h3>
          {passkeyCount === 0 ? (
            <p className="text-sm text-subtle">No passkeys registered.</p>
          ) : (
            <ul className="divide-y divide-line rounded-md border border-line">
              {passkeys.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-fg">{p.friendlyName || 'Passkey'}</p>
                    <p className="text-xs text-subtle">
                      Added {new Date(p.createdAt).toLocaleDateString()}
                      {' · '}
                      {p.lastUsedAt
                        ? `last used ${new Date(p.lastUsedAt).toLocaleDateString()}`
                        : 'never used'}
                    </p>
                  </div>
                  {canWrite && (
                    <button
                      type="button"
                      onClick={() => setPasskeyToRemove(p)}
                      aria-label={`Remove passkey ${p.friendlyName || p.id}`}
                      className="shrink-0 rounded-md border border-line px-3 py-1.5 text-sm font-medium text-muted hover:bg-active"
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {resetMfaMutation.isSuccess && (
          <div className="rounded-md bg-success-soft p-3 text-sm text-success-fg">
            MFA has been reset successfully.
          </div>
        )}
        {resetMfaMutation.isError && (
          <div className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
            Failed to reset MFA.
          </div>
        )}
        {resetSmsMutation.isSuccess && (
          <div className="rounded-md bg-success-soft p-3 text-sm text-success-fg">
            The phone number has been removed.
          </div>
        )}
        {resetSmsMutation.isError && (
          <div className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
            Failed to remove the phone number.
          </div>
        )}
        {removePasskeyMutation.isSuccess && (
          <div className="rounded-md bg-success-soft p-3 text-sm text-success-fg">
            The passkey has been removed and the user signed out everywhere.
          </div>
        )}
        {removePasskeyMutation.isError && (
          <div className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
            Failed to remove the passkey.
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={showResetMfa}
        title="Reset MFA"
        message={
          <span className="block space-y-3">
            <span className="block">
              Reset MFA for user &quot;{username}&quot;? This removes every second factor
              (authenticator app and phone), the recovery codes
              {keepPasskeys ? '' : ' and every passkey'}, and signs the user out everywhere.
            </span>
            {passkeyCount > 0 && (
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={keepPasskeys}
                  onChange={(e) => setKeepPasskeys(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Keep the user&apos;s {passkeyCount} passkey{passkeyCount === 1 ? '' : 's'}. Only
                  if you are sure they are the user&apos;s own: a passkey signs in without the
                  password. If the user signs in with passkeys only, set a password before
                  removing them.
                </span>
              </label>
            )}
          </span>
        }
        onConfirm={() => resetMfaMutation.mutate()}
        onCancel={() => setShowResetMfa(false)}
      />

      <ConfirmDialog
        isOpen={showResetSms}
        title="Remove phone"
        message={`Remove the SMS phone number of user "${username}"? Their authenticator app keeps working.`}
        onConfirm={() => resetSmsMutation.mutate()}
        onCancel={() => setShowResetSms(false)}
      />

      <ConfirmDialog
        isOpen={!!passkeyToRemove}
        title="Remove passkey"
        message={`Remove the passkey "${passkeyToRemove?.friendlyName || 'Passkey'}" of user "${username}"? It stops working at once and the user is signed out everywhere.`}
        onConfirm={() => {
          if (passkeyToRemove) removePasskeyMutation.mutate(passkeyToRemove.id);
        }}
        onCancel={() => setPasskeyToRemove(null)}
      />
    </>
  );
}
