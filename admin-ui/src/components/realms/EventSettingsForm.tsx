import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Realm } from '../../types';
import { updateRealm } from '../../api/realms';
import { formatDuration } from '../../utils/formatDuration';

type EventSettingsFormProps = {
  realm: Realm;
};

function seedFromRealm(realm: Realm) {
  return {
    eventsEnabled: realm.eventsEnabled ?? false,
    eventsExpiration: realm.eventsExpiration ?? 604800,
    adminEventsEnabled: realm.adminEventsEnabled ?? false,
    loginEventRetentionDays: realm.loginEventRetentionDays ?? 30,
    adminEventRetentionDays: realm.adminEventRetentionDays ?? 90,
    deletionGracePeriodDays: realm.deletionGracePeriodDays ?? 14,
  };
}

export default function EventSettingsForm({ realm }: EventSettingsFormProps) {
  const queryClient = useQueryClient();

  const [form, setForm] = useState(() => seedFromRealm(realm));

  // Reseed the editable form when the realm prop changes (e.g. after a refetch).
  // Adjusting state during render (vs. an effect) avoids an extra render pass.
  const [seededRealm, setSeededRealm] = useState(realm);
  if (realm !== seededRealm) {
    setSeededRealm(realm);
    setForm(seedFromRealm(realm));
  }

  const updateMutation = useMutation({
    mutationFn: () =>
      updateRealm(realm.name, {
        eventsEnabled: form.eventsEnabled,
        eventsExpiration: form.eventsExpiration,
        adminEventsEnabled: form.adminEventsEnabled,
        loginEventRetentionDays: form.loginEventRetentionDays,
        adminEventRetentionDays: form.adminEventRetentionDays,
        deletionGracePeriodDays: form.deletionGracePeriodDays,
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

  return (
    <form onSubmit={handleSubmit} className="space-y-8 rounded-lg border border-line bg-surface p-6 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-fg">Event Configuration</h2>
        <p className="mt-1 text-sm text-subtle">
          Control whether login and admin events are recorded for this realm.
        </p>
      </div>

      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="eventsEnabled"
            checked={form.eventsEnabled}
            onChange={(e) => setForm({ ...form, eventsEnabled: e.target.checked })}
            className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
          />
          <label htmlFor="eventsEnabled" className="text-sm font-medium text-muted">
            Enable login events
          </label>
        </div>
        <p className="ml-6 -mt-4 text-xs text-subtle">
          Records login, logout, token refresh, and authentication error events.
        </p>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="adminEventsEnabled"
            checked={form.adminEventsEnabled}
            onChange={(e) => setForm({ ...form, adminEventsEnabled: e.target.checked })}
            className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
          />
          <label htmlFor="adminEventsEnabled" className="text-sm font-medium text-muted">
            Enable admin events
          </label>
        </div>
        <p className="ml-6 -mt-4 text-xs text-subtle">
          Records create, update, and delete operations performed through the admin API.
        </p>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">
            Events Expiration (seconds)
          </label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={60}
              value={form.eventsExpiration}
              onChange={(e) =>
                setForm({ ...form, eventsExpiration: Number(e.target.value) })
              }
              className="w-40 rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
            <span className="text-sm text-subtle">seconds</span>
            <span className="rounded-full bg-sunken px-2.5 py-0.5 text-xs font-medium text-muted">
              {formatDuration(form.eventsExpiration)}
            </span>
          </div>
          <p className="mt-1 text-xs text-subtle">
            How long events are kept before automatic cleanup. Default: 7 days (604800s).
          </p>
        </div>
      </div>

      {/* Event Retention */}
      <div className="space-y-6 border-t border-line pt-6">
        <div>
          <h2 className="text-lg font-semibold text-fg">Event Retention</h2>
          <p className="mt-1 text-sm text-subtle">
            How many days event records are retained in the database before being purged.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted">Login event retention (days)</label>
            <input type="number" min={1} value={form.loginEventRetentionDays}
              onChange={(e) => setForm({ ...form, loginEventRetentionDays: Number(e.target.value) })}
              className="w-40 rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none" />
            <p className="mt-1 text-xs text-subtle">Days to keep login/auth event records. Default: 30.</p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted">Admin event retention (days)</label>
            <input type="number" min={1} value={form.adminEventRetentionDays}
              onChange={(e) => setForm({ ...form, adminEventRetentionDays: Number(e.target.value) })}
              className="w-40 rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none" />
            <p className="mt-1 text-xs text-subtle">Days to keep admin audit event records. Default: 90.</p>
          </div>
        </div>
      </div>

      {/* User Lifecycle */}
      <div className="space-y-6 border-t border-line pt-6">
        <div>
          <h2 className="text-lg font-semibold text-fg">User Lifecycle</h2>
          <p className="mt-1 text-sm text-subtle">
            Configure how long deleted user accounts are retained before permanent removal.
          </p>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">Deletion grace period (days)</label>
          <input type="number" min={0} value={form.deletionGracePeriodDays}
            onChange={(e) => setForm({ ...form, deletionGracePeriodDays: Number(e.target.value) })}
            className="w-40 rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none" />
          <p className="mt-1 text-xs text-subtle">
            Days before a soft-deleted account is permanently purged. Set to 0 to disable soft-deletion. Default: 14.
          </p>
        </div>
      </div>

      {updateMutation.isSuccess && (
        <div className="rounded-md bg-success-soft p-3 text-sm text-success-fg">
          Event settings updated successfully.
        </div>
      )}
      {updateMutation.isError && (
        <div className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
          Failed to update event settings.
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
