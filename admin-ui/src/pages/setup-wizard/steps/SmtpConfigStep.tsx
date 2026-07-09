import { useState, type FormEvent, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { saveSmtpConfig, testSmtp, type SmtpConfigData } from '../../../api/wizard';
import { useWizard } from '../../../context/WizardContext';
import { getErrorMessage } from '../../../utils/getErrorMessage';
import PasswordInput from '../../../components/PasswordInput';

/**
 * Validates email address format
 */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function SmtpConfigStep() {
  const { setSmtpConfig } = useWizard();
  const [form, setForm] = useState<SmtpConfigData>({
    host: '',
    port: 587,
    user: '',
    password: '',
    from: '',
    secure: false,
  });
  const [testEmailTo, setTestEmailTo] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [testSuccess, setTestSuccess] = useState(false);

  // SMTP config is optional, but if any fields are filled, host and from are required
  const isFormPartiallyFilled = form.host || form.port !== 587 || form.user || form.password || form.from;

  const mutation = useMutation({
    mutationFn: (data: SmtpConfigData) => saveSmtpConfig(data),
    onSuccess: (result) => {
      if (result.smtpConfig) {
        setSmtpConfig(result.smtpConfig);
      }
    },
  });

  const testEmailMutation = useMutation({
    mutationFn: () => testSmtp({ to: testEmailTo }),
    onSuccess: () => {
      setTestSuccess(true);
    },
  });

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      setLocalError(null);

      // If any SMTP fields are filled, validate required fields
      if (isFormPartiallyFilled) {
        if (!form.host) {
          setLocalError('SMTP host is required when configuring email settings.');
          return;
        }
        if (!isValidEmail(form.from)) {
          setLocalError('A valid sender email address is required.');
          return;
        }
      }

      // Only save if there's something to save (or skip entirely)
      if (isFormPartiallyFilled) {
        mutation.mutate(form);
      }
    },
    [form, isFormPartiallyFilled, mutation],
  );

  const handleTestEmail = useCallback(() => {
    if (!testEmailTo || !isValidEmail(testEmailTo)) {
      setLocalError('Please enter a valid email address for the test.');
      return;
    }
    setTestSuccess(false);
    setLocalError(null);
    testEmailMutation.mutate();
  }, [testEmailTo, testEmailMutation]);

  const handleSkip = useCallback(() => {
    // No SMTP config needed, just proceed
    // The wizard context handles moving to next step
  }, []);

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Configure Email (Optional)</h2>
        <p className="mt-1 text-sm text-gray-500">
          Set up SMTP for password resets, email verification, and admin notifications.
          You can skip this step and configure it later from the realm settings.
        </p>
        <div className="mt-3 flex items-start gap-2 rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2.5">
          <svg className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p className="text-xs text-indigo-700">
            <span className="font-semibold">More providers available.</span> After setup, go to{' '}
            <span className="font-medium">Realm Settings › Email</span> to switch to Resend, SendGrid,
            Mailgun, or Postmark.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="smtpHost" className="mb-1.5 block text-sm font-medium text-gray-700">
            SMTP Host
          </label>
          <input
            id="smtpHost"
            name="host"
            type="text"
            value={form.host}
            onChange={(e) => setForm({ ...form, host: e.target.value })}
            placeholder="smtp.example.com"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-500">
            The hostname of your SMTP server.
          </p>
        </div>

        <div>
          <label htmlFor="smtpPort" className="mb-1.5 block text-sm font-medium text-gray-700">
            Port
          </label>
          <input
            id="smtpPort"
            name="port"
            type="number"
            min={1}
            max={65535}
            value={form.port}
            onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-500">
            Common ports: 587 (STARTTLS), 465 (SSL/TLS), 25 (unencrypted)
          </p>
        </div>

        <div>
          <label htmlFor="smtpFrom" className="mb-1.5 block text-sm font-medium text-gray-700">
            Sender Email
          </label>
          <input
            id="smtpFrom"
            name="from"
            type="email"
            value={form.from}
            onChange={(e) => setForm({ ...form, from: e.target.value })}
            placeholder="noreply@example.com"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-500">
            The email address that appears in the &quot;From&quot; field of sent emails.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="smtpUser" className="mb-1.5 block text-sm font-medium text-gray-700">
              Username
            </label>
            <input
              id="smtpUser"
              name="user"
              type="text"
              value={form.user || ''}
              onChange={(e) => setForm({ ...form, user: e.target.value || undefined })}
              placeholder="Optional"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="smtpPassword" className="mb-1.5 block text-sm font-medium text-gray-700">
              Password
            </label>
            <PasswordInput
              id="smtpPassword"
              name="password"
              value={form.password || ''}
              onChange={(e) => setForm({ ...form, password: e.target.value || undefined })}
              placeholder="Optional"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="smtpSecure"
            checked={form.secure ?? false}
            onChange={(e) => setForm({ ...form, secure: e.target.checked })}
            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          <label htmlFor="smtpSecure" className="text-sm font-medium text-gray-700">
            Use SSL/TLS
          </label>
          <span className="text-xs text-gray-400">(Enable for port 465, disable for STARTTLS on port 587)</span>
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
            {getErrorMessage(mutation.error, 'Failed to save SMTP configuration.')}
          </div>
        )}

        {mutation.isSuccess && (
          <div
            role="status"
            aria-live="polite"
            className="rounded-md bg-green-50 p-3 text-sm text-green-700"
          >
            SMTP configuration saved successfully.
          </div>
        )}

        {/* Test Email Section */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <h3 className="text-sm font-semibold text-gray-900">Send Test Email</h3>
          <p className="mt-1 text-xs text-gray-500">
            After saving your SMTP settings, send a test email to verify the configuration.
          </p>
          <div className="mt-3 flex items-end gap-3">
            <div className="flex-1">
              <label htmlFor="testEmailTo" className="mb-1.5 block text-sm font-medium text-gray-700">
                Recipient
              </label>
              <input
                id="testEmailTo"
                type="email"
                value={testEmailTo}
                onChange={(e) => setTestEmailTo(e.target.value)}
                placeholder="test@example.com"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={handleTestEmail}
              disabled={testEmailMutation.isPending || !testEmailTo || !form.host}
              className="rounded-md bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
            >
              {testEmailMutation.isPending ? (
                <>
                  <svg className="inline h-4 w-4 animate-spin mr-2" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Sending...
                </>
              ) : (
                'Send Test'
              )}
            </button>
          </div>
          {testSuccess && (
            <div className="mt-3 rounded-md bg-green-50 p-3 text-sm text-green-700">
              Test email sent successfully!
            </div>
          )}
          {testEmailMutation.isError && (
            <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
              {getErrorMessage(testEmailMutation.error, 'Failed to send test email. Check your SMTP settings.')}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-gray-200 pt-4">
          <button
            type="button"
            onClick={handleSkip}
            className="rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Skip for now
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
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
