import { useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getMfaStatus, resetMfa, resetPassword } from '../../api/users';
import ConfirmDialog from '../ConfirmDialog';
import PasswordInput from '../PasswordInput';

type UserSecuritySectionProps = {
  realmName: string;
  userId: string;
  username: string;
};

export default function UserSecuritySection({ realmName, userId, username }: UserSecuritySectionProps) {
  const queryClient = useQueryClient();
  const [showResetMfa, setShowResetMfa] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState('');

  const { data: mfaStatus } = useQuery({
    queryKey: ['mfaStatus', realmName, userId],
    queryFn: () => getMfaStatus(realmName, userId),
  });

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
    mutationFn: () => resetMfa(realmName, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mfaStatus', realmName, userId] });
      setShowResetMfa(false);
    },
  });

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

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={resetPwMutation.isPending}
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
          <div className="flex items-center gap-3">
            {mfaStatus?.enabled ? (
              <>
                <span className="inline-flex rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-medium text-success-fg">
                  Enabled
                </span>
                <button
                  type="button"
                  onClick={() => setShowResetMfa(true)}
                  className="rounded-md border border-danger-soft px-3 py-1.5 text-sm font-medium text-danger-fg hover:bg-danger-soft"
                >
                  Reset MFA
                </button>
              </>
            ) : (
              <span className="inline-flex rounded-full bg-warning-soft px-2.5 py-0.5 text-xs font-medium text-warning-fg">
                Not configured
              </span>
            )}
          </div>
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
      </div>

      <ConfirmDialog
        isOpen={showResetMfa}
        title="Reset MFA"
        message={`Are you sure you want to reset MFA for user "${username}"? They will need to set up TOTP again on their next login.`}
        onConfirm={() => resetMfaMutation.mutate()}
        onCancel={() => setShowResetMfa(false)}
      />
    </>
  );
}
