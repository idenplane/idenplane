import { useState, type FormEvent } from 'react';
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

  // Seed the editable form from the realm prop when it changes.
  // Adjusting state during render (vs. an effect) avoids an extra render pass.
  const [seededRealm, setSeededRealm] = useState(realm);
  if (realm !== seededRealm) {
    setSeededRealm(realm);
    setForm({
      enabled: realm.magicLinkEnabled ?? false,
      expirySeconds: realm.magicLinkExpirySeconds ?? 300,
      rateLimitPerEmail: realm.magicLinkRateLimitPerEmail ?? 3,
      rateLimitWindowSeconds: realm.magicLinkRateLimitWindowSeconds ?? 900,
      emailSubject: realm.magicLinkEmailSubject ?? null,
      emailTemplate: realm.magicLinkEmailTemplate ?? null,
    });
  }

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
    <form onSubmit={handleSubmit} className="space-y-8 rounded-lg border border-line bg-surface p-6 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-fg">Magic Link Settings</h2>
        <p className="mt-1 text-sm text-subtle">
          Configure passwordless authentication using magic links sent via email.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="magicLinkEnabled"
          checked={form.enabled}
          onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
        />
        <label htmlFor="magicLinkEnabled" className="text-sm font-medium text-muted">
          Enable Magic Link Authentication
        </label>
      </div>
      <p className="ml-6 -mt-4 text-xs text-subtle">
        When enabled, users can sign in by requesting a magic link sent to their email instead of using a password.
      </p>

      <div className="space-y-6">
        <div>
          <label htmlFor="expirySeconds" className="mb-1.5 block text-sm font-medium text-muted">
            Link Expiry Duration
          </label>
          <div className="flex items-center gap-3">
            <input
              id="expirySeconds"
              type="number"
              min={60}
              value={form.expirySeconds}
              onChange={(e) => setForm({ ...form, expirySeconds: Number(e.target.value) })}
              className="w-40 rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
            <span className="text-sm text-subtle">seconds</span>
            <span className="rounded-full bg-sunken px-2.5 py-0.5 text-xs font-medium text-muted">
              {formatDuration(form.expirySeconds)}
            </span>
          </div>
          <p className="mt-1 text-xs text-subtle">
            How long a magic link remains valid. Default: 5 minutes (300s). Minimum: 60 seconds.
          </p>
        </div>

        <div>
          <label htmlFor="rateLimitPerEmail" className="mb-1.5 block text-sm font-medium text-muted">
            Rate Limit - Max Requests Per Email
          </label>
          <input
            id="rateLimitPerEmail"
            type="number"
            min={1}
            max={20}
            value={form.rateLimitPerEmail}
            onChange={(e) => setForm({ ...form, rateLimitPerEmail: Number(e.target.value) })}
            className="w-40 rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
          <p className="mt-1 text-xs text-subtle">
            Maximum number of magic link requests allowed per email address within the rate limit window.
          </p>
        </div>

        <div>
          <label htmlFor="rateLimitWindowSeconds" className="mb-1.5 block text-sm font-medium text-muted">
            Rate Limit Window
          </label>
          <div className="flex items-center gap-3">
            <input
              id="rateLimitWindowSeconds"
              type="number"
              min={60}
              value={form.rateLimitWindowSeconds}
              onChange={(e) => setForm({ ...form, rateLimitWindowSeconds: Number(e.target.value) })}
              className="w-40 rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
            <span className="text-sm text-subtle">seconds</span>
            <span className="rounded-full bg-sunken px-2.5 py-0.5 text-xs font-medium text-muted">
              {formatDuration(form.rateLimitWindowSeconds)}
            </span>
          </div>
          <p className="mt-1 text-xs text-subtle">
            Time window for rate limiting. Default: 15 minutes (900s).
          </p>
        </div>
      </div>

      <div className="space-y-4 border-t border-line pt-6">
        <div>
          <h3 className="text-sm font-semibold text-muted">Email Customization</h3>
          <p className="mt-1 text-xs text-subtle">
            Customize the magic link email sent to users. Leave blank to use default template.
          </p>
        </div>

        <div>
          <label htmlFor="emailSubject" className="mb-1.5 block text-sm font-medium text-muted">
            Email Subject Line
          </label>
          <input
            id="emailSubject"
            type="text"
            value={form.emailSubject ?? ''}
            onChange={(e) => setForm({ ...form, emailSubject: e.target.value || null })}
            placeholder="Your sign-in link"
            className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
          <p className="mt-1 text-xs text-subtle">
            Subject line for the magic link email. Leave blank to use default.
          </p>
        </div>

        <div>
          <label htmlFor="emailTemplate" className="mb-1.5 block text-sm font-medium text-muted">
            Custom Email Template
          </label>
          <textarea
            id="emailTemplate"
            value={form.emailTemplate ?? ''}
            onChange={(e) => setForm({ ...form, emailTemplate: e.target.value || null })}
            placeholder="Use {{magicLinkUrl}} to insert the magic link..."
            rows={6}
            className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
          <p className="mt-1 text-xs text-subtle">
            Custom email body template. Use {'{{magicLinkUrl}}'} to insert the magic link URL.
            Leave blank to use the default template from realm theme.
          </p>
        </div>
      </div>

      {updateMutation.isSuccess && (
        <div className="rounded-md bg-success-soft p-3 text-sm text-success-fg">
          Magic link settings updated successfully.
        </div>
      )}
      {updateMutation.isError && (
        <div className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
          Failed to update magic link settings.
        </div>
      )}

      <div className="flex justify-end border-t border-line pt-4">
        <button
          type="submit"
          disabled={updateMutation.isPending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </form>
  );
}
