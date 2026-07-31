import { useState, type FormEvent, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { saveAdminAccount, type AdminAccountData } from '../../../api/wizard';
import { useWizard } from '../../../context/WizardContext';
import { getErrorMessage } from '../../../utils/getErrorMessage';
import PasswordInput from '../../../components/PasswordInput';

/**
 * Password strength levels for validation feedback
 */
type PasswordStrength = 'weak' | 'fair' | 'good' | 'strong';

interface PasswordStrengthInfo {
  level: PasswordStrength;
  label: string;
  color: string;
  score: number;
}

function evaluatePasswordStrength(password: string): PasswordStrengthInfo {
  let score = 0;
  const checks = {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password),
  };

  if (checks.length) score += 20;
  if (checks.uppercase) score += 20;
  if (checks.lowercase) score += 20;
  if (checks.number) score += 20;
  if (checks.special) score += 20;

  // Bonus for longer passwords
  if (password.length >= 12) score += 10;
  if (password.length >= 16) score += 10;

  score = Math.min(100, score);

  let level: PasswordStrength;
  let label: string;
  let color: string;

  if (score < 40) {
    level = 'weak';
    label = 'Weak';
    color = 'bg-danger';
  } else if (score < 60) {
    level = 'fair';
    label = 'Fair';
    color = 'bg-warning';
  } else if (score < 80) {
    level = 'good';
    label = 'Good';
    color = 'bg-info';
  } else {
    level = 'strong';
    label = 'Strong';
    color = 'bg-success';
  }

  return { level, label, color, score };
}

export default function AdminAccountStep() {
  const { setAdminAccount } = useWizard();
  const [form, setForm] = useState<AdminAccountData>({
    username: '',
    email: '',
    password: '',
  });
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const passwordStrength = evaluatePasswordStrength(form.password);
  const passwordsMatch = confirmPassword === '' || form.password === confirmPassword;
  const isPasswordValid = passwordStrength.score >= 40 && passwordsMatch;

  const mutation = useMutation({
    mutationFn: (data: AdminAccountData) => saveAdminAccount(data),
    onSuccess: (result) => {
      if (result.adminUsername) {
        setAdminAccount({
          username: result.adminUsername,
          email: result.adminEmail || '',
          password: form.password,
        });
      }
    },
  });

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      setLocalError(null);

      // Validate passwords match
      if (form.password !== confirmPassword) {
        setLocalError('Passwords do not match.');
        return;
      }

      // Validate password strength
      if (passwordStrength.score < 40) {
        setLocalError('Password is too weak. Please use a stronger password.');
        return;
      }

      mutation.mutate(form);
    },
    [form, confirmPassword, passwordStrength.score, mutation],
  );

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-fg">Create Admin Account</h2>
        <p className="mt-1 text-sm text-subtle">
          Set up your master admin account. This account will have full access to manage all realms and settings.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="username" className="mb-1.5 block text-sm font-medium text-muted">
            Username
          </label>
          <input
            id="username"
            name="username"
            type="text"
            required
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            placeholder="admin"
          />
          <p className="mt-1 text-xs text-subtle">
            This will be the username for your admin account.
          </p>
        </div>

        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-muted">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            placeholder="admin@example.com"
          />
          <p className="mt-1 text-xs text-subtle">
            Used for password recovery and admin notifications.
          </p>
        </div>

        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-muted">
            Password
          </label>
          <PasswordInput
            id="password"
            name="password"
            required
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
          {form.password && (
            <div className="mt-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs text-subtle">Password strength</span>
                <span className={`text-xs font-medium ${passwordStrength.level === 'weak' ? 'text-danger' : passwordStrength.level === 'fair' ? 'text-warning' : passwordStrength.level === 'good' ? 'text-info' : 'text-success'}`}>
                  {passwordStrength.label}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-active">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${passwordStrength.color}`}
                  style={{ width: `${passwordStrength.score}%` }}
                />
              </div>
              <ul className="mt-2 space-y-1 text-xs text-subtle">
                <li className={passwordStrength.score >= 20 ? 'text-success' : ''}>
                  At least 8 characters
                </li>
                <li className={passwordStrength.score >= 40 ? 'text-success' : ''}>
                  Contains uppercase letter
                </li>
                <li className={passwordStrength.score >= 60 ? 'text-success' : ''}>
                  Contains lowercase letter
                </li>
                <li className={passwordStrength.score >= 80 ? 'text-success' : ''}>
                  Contains number
                </li>
                <li className={passwordStrength.score >= 100 ? 'text-success' : ''}>
                  Contains special character
                </li>
              </ul>
            </div>
          )}
        </div>

        <div>
          <label htmlFor="confirmPassword" className="mb-1.5 block text-sm font-medium text-muted">
            Confirm Password
          </label>
          <PasswordInput
            id="confirmPassword"
            name="confirmPassword"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={`w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:ring-1 focus:outline-none ${confirmPassword && !passwordsMatch ? 'border-danger focus:border-danger focus:ring-danger' : 'border-line-strong focus:border-accent focus:ring-accent'}`}
          />
          {confirmPassword && !passwordsMatch && (
            <p className="mt-1 text-xs text-danger">Passwords do not match</p>
          )}
        </div>

        {localError && (
          <div
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg"
          >
            {localError}
          </div>
        )}

        {mutation.isError && (
          <div
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg"
          >
            {getErrorMessage(mutation.error, 'Failed to save admin account.')}
          </div>
        )}

        <div className="border-t border-line pt-4">
          <div className="flex items-start gap-2">
            <input
              type="checkbox"
              id="acknowledge"
              required
              className="mt-1 h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
            />
            <label htmlFor="acknowledge" className="text-sm text-muted">
              I understand this admin account will have full access to manage all realms and settings. I will keep my credentials secure.
            </label>
          </div>
        </div>

        <div className="flex justify-end border-t border-line pt-4">
          <button
            type="submit"
            disabled={mutation.isPending || !isPasswordValid}
            className="flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {mutation.isPending ? (
              <>
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span>Saving...</span>
              </>
            ) : (
              <span>Save & Continue</span>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
