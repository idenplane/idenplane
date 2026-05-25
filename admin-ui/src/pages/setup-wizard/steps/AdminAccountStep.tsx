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
    color = 'bg-red-500';
  } else if (score < 60) {
    level = 'fair';
    label = 'Fair';
    color = 'bg-yellow-500';
  } else if (score < 80) {
    level = 'good';
    label = 'Good';
    color = 'bg-blue-500';
  } else {
    level = 'strong';
    label = 'Strong';
    color = 'bg-green-500';
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
        <h2 className="text-xl font-semibold text-gray-900">Create Admin Account</h2>
        <p className="mt-1 text-sm text-gray-500">
          Set up your master admin account. This account will have full access to manage all realms and settings.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="username" className="mb-1.5 block text-sm font-medium text-gray-700">
            Username
          </label>
          <input
            id="username"
            name="username"
            type="text"
            required
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            placeholder="admin"
          />
          <p className="mt-1 text-xs text-gray-500">
            This will be the username for your admin account.
          </p>
        </div>

        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            placeholder="admin@example.com"
          />
          <p className="mt-1 text-xs text-gray-500">
            Used for password recovery and admin notifications.
          </p>
        </div>

        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-gray-700">
            Password
          </label>
          <PasswordInput
            id="password"
            name="password"
            required
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          />
          {form.password && (
            <div className="mt-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs text-gray-500">Password strength</span>
                <span className={`text-xs font-medium ${passwordStrength.level === 'weak' ? 'text-red-600' : passwordStrength.level === 'fair' ? 'text-yellow-600' : passwordStrength.level === 'good' ? 'text-blue-600' : 'text-green-600'}`}>
                  {passwordStrength.label}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${passwordStrength.color}`}
                  style={{ width: `${passwordStrength.score}%` }}
                />
              </div>
              <ul className="mt-2 space-y-1 text-xs text-gray-500">
                <li className={passwordStrength.score >= 20 ? 'text-green-600' : ''}>
                  At least 8 characters
                </li>
                <li className={passwordStrength.score >= 40 ? 'text-green-600' : ''}>
                  Contains uppercase letter
                </li>
                <li className={passwordStrength.score >= 60 ? 'text-green-600' : ''}>
                  Contains lowercase letter
                </li>
                <li className={passwordStrength.score >= 80 ? 'text-green-600' : ''}>
                  Contains number
                </li>
                <li className={passwordStrength.score >= 100 ? 'text-green-600' : ''}>
                  Contains special character
                </li>
              </ul>
            </div>
          )}
        </div>

        <div>
          <label htmlFor="confirmPassword" className="mb-1.5 block text-sm font-medium text-gray-700">
            Confirm Password
          </label>
          <PasswordInput
            id="confirmPassword"
            name="confirmPassword"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={`w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:ring-1 focus:outline-none ${confirmPassword && !passwordsMatch ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : 'border-gray-300 focus:border-indigo-500 focus:ring-indigo-500'}`}
          />
          {confirmPassword && !passwordsMatch && (
            <p className="mt-1 text-xs text-red-600">Passwords do not match</p>
          )}
        </div>

        {localError && (
          <div
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            className="rounded-md bg-red-50 p-3 text-sm text-red-700"
          >
            {localError}
          </div>
        )}

        {mutation.isError && (
          <div
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            className="rounded-md bg-red-50 p-3 text-sm text-red-700"
          >
            {getErrorMessage(mutation.error, 'Failed to save admin account.')}
          </div>
        )}

        <div className="border-t border-gray-200 pt-4">
          <div className="flex items-start gap-2">
            <input
              type="checkbox"
              id="acknowledge"
              required
              className="mt-1 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <label htmlFor="acknowledge" className="text-sm text-gray-600">
              I understand this admin account will have full access to manage all realms and settings. I will keep my credentials secure.
            </label>
          </div>
        </div>

        <div className="flex justify-end border-t border-gray-200 pt-4">
          <button
            type="submit"
            disabled={mutation.isPending || !isPasswordValid}
            className="flex items-center gap-2 rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
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
