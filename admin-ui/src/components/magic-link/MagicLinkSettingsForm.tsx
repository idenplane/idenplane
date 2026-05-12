import { useState, useEffect, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Realm } from '../../types';
import type { MagicLinkSettings } from '../../types';
import { updateRealm } from '../../api/realms';

type MagicLinkSettingsFormProps = {
  realm: Realm;
};

export default function MagicLinkSettingsForm({ realm }: MagicLinkSettingsFormProps) {
  const queryClient = useQueryClient();

  const [form, setForm] = useState<MagicLinkSettings>({
    enabled: false,
    expirySeconds: 300,
    rateLimitPerEmail: 3,
    rateLimitWindowSeconds: 900,
    emailSubject: null,
    emailTemplate: null,
  });

  useEffect(() => {
    if (realm) {
      setForm({
        enabled: realm.magicLinkEnabled ?? false,
        expirySeconds: realm.magicLinkExpirySeconds ?? 300,
        rateLimitPerEmail: realm.magicLinkRateLimitPerEmail ?? 3,
        rateLimitWindowSeconds: realm.magicLinkRateLimitWindowSeconds ?? 900,
        emailSubject: realm.magicLinkEmailSubject ?? null,
        emailTemplate: realm.magicLinkEmailTemplate ?? null,
      });
    }
  }, [realm]);

  const updateMutation = useMutation({
    mutationFn: () => updateRealm(realm.name, {
      magicLinkEnabled: form.enabled,
      magicLinkExpirySeconds: form.expirySeconds,
      magicLinkRateLimitPerEmail: form.rateLimitPerEmail,
      magicLinkRateLimitWindowSeconds: form.rateLimitWindowSeconds,
      magicLinkEmailSubject: form.emailSubject,
      magicLinkEmailTemplate: form.emailTemplate,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['realm', realm.name] });
      queryClient.invalidateQueries({ queryKey: ['realms'] });
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    updateMutation.mutate();
  }

  function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Magic Link Settings</h2>
        <p className="mt-1 text-sm text-gray-500">
          Configure passwordless authentication using magic links sent via email.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="magicLinkEnabled"
          checked={form.enabled}
          onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
        />
        <label htmlFor="magicLinkEnabled" className="text-sm font-medium text-gray-700">
          Enable Magic Link Authentication
        </label>
      </div>
      <p className="ml-6 -mt-4 text-xs text-gray-400">
        When enabled, users can sign in by requesting a magic link sent to their email instead of using a password.
      </p>

      <div className="space-y-6">
        <div>
          <label htmlFor="expirySeconds" className="mb-1.5 block text-sm font-medium text-gray-700">
            Link Expiry Duration
          </label>
          <div className="flex items-center gap-3">
            <input
              id="expirySeconds"
              type="number"
              min={60}
              value={form.expirySeconds}
              onChange={(e) => setForm({ ...form, expirySeconds: Number(e.target.value) })}
              className="w-40 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
            <span className="text-sm text-gray-500">seconds</span>
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
              {formatDuration(form.expirySeconds)}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-400">
            How long a magic link remains valid. Default: 5 minutes (300s). Minimum: 60 seconds.
          </p>
        </div>

        <div>
          <label htmlFor="rateLimitPerEmail" className="mb-1.5 block text-sm font-medium text-gray-700">
            Rate Limit - Max Requests Per Email
          </label>
          <input
            id="rateLimitPerEmail"
            type="number"
            min={1}
            max={20}
            value={form.rateLimitPerEmail}
            onChange={(e) => setForm({ ...form, rateLimitPerEmail: Number(e.target.value) })}
            className="w-40 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-400">
            Maximum number of magic link requests allowed per email address within the rate limit window.
          </p>
        </div>

        <div>
          <label htmlFor="rateLimitWindowSeconds" className="mb-1.5 block text-sm font-medium text-gray-700">
            Rate Limit Window
          </label>
          <div className="flex items-center gap-3">
            <input
              id="rateLimitWindowSeconds"
              type="number"
              min={60}
              value={form.rateLimitWindowSeconds}
              onChange={(e) => setForm({ ...form, rateLimitWindowSeconds: Number(e.target.value) })}
              className="w-40 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
            <span className="text-sm text-gray-500">seconds</span>
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
              {formatDuration(form.rateLimitWindowSeconds)}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-400">
            Time window for rate limiting. Default: 15 minutes (900s).
          </p>
        </div>
      </div>

      <div className="space-y-4 border-t border-gray-200 pt-6">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">Email Customization</h3>
          <p className="mt-1 text-xs text-gray-500">
            Customize the magic link email sent to users. Leave blank to use default template.
          </p>
        </div>

        <div>
          <label htmlFor="emailSubject" className="mb-1.5 block text-sm font-medium text-gray-700">
            Email Subject Line
          </label>
          <input
            id="emailSubject"
            type="text"
            value={form.emailSubject ?? ''}
            onChange={(e) => setForm({ ...form, emailSubject: e.target.value || null })}
            placeholder="Your sign-in link"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-400">
            Subject line for the magic link email. Leave blank to use default.
          </p>
        </div>

        <div>
          <label htmlFor="emailTemplate" className="mb-1.5 block text-sm font-medium text-gray-700">
            Custom Email Template
          </label>
          <textarea
            id="emailTemplate"
            value={form.emailTemplate ?? ''}
            onChange={(e) => setForm({ ...form, emailTemplate: e.target.value || null })}
            placeholder="Use {{magicLinkUrl}} to insert the magic link..."
            rows={6}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-400">
            Custom email body template. Use {'{{magicLinkUrl}}'} to insert the magic link URL.
            Leave blank to use the default template from realm theme.
          </p>
        </div>
      </div>

      {updateMutation.isSuccess && (
        <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
          Magic link settings updated successfully.
        </div>
      )}
      {updateMutation.isError && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          Failed to update magic link settings.
        </div>
      )}

      <div className="flex justify-end border-t border-gray-200 pt-4">
        <button
          type="submit"
          disabled={updateMutation.isPending}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </form>
  );
}
