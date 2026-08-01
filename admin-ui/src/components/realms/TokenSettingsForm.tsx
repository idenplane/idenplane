import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Realm } from '../../types';
import { updateRealm } from '../../api/realms';
import { formatDuration } from '../../utils/formatDuration';

type TokenSettingsFormProps = {
  realm: Realm;
};

function seedFromRealm(realm: Realm) {
  return {
    accessTokenLifespan: realm.accessTokenLifespan,
    refreshTokenLifespan: realm.refreshTokenLifespan,
    offlineTokenLifespan: realm.offlineTokenLifespan ?? 2592000,
  };
}

export default function TokenSettingsForm({ realm }: TokenSettingsFormProps) {
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
        accessTokenLifespan: form.accessTokenLifespan,
        refreshTokenLifespan: form.refreshTokenLifespan,
        offlineTokenLifespan: form.offlineTokenLifespan,
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
    <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-line bg-surface p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-fg">Token Lifespans</h2>
      <p className="text-sm text-subtle">
        Configure how long access and refresh tokens remain valid.
      </p>

      <div className="space-y-6">
        <div>
          <label htmlFor="access-token-lifespan" className="mb-1.5 block text-sm font-medium text-muted">
            Access Token Lifespan
          </label>
          <div className="flex items-center gap-3">
            <input
              id="access-token-lifespan"
              type="number"
              min={1}
              value={form.accessTokenLifespan}
              onChange={(e) =>
                setForm({ ...form, accessTokenLifespan: Number(e.target.value) })
              }
              className="w-40 rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
            <span className="text-sm text-subtle">seconds</span>
            <span className="rounded-full bg-sunken px-2.5 py-0.5 text-xs font-medium text-muted">
              {formatDuration(form.accessTokenLifespan)}
            </span>
          </div>
          <p className="mt-1 text-xs text-subtle">
            How long an access token is valid before it must be refreshed.
          </p>
        </div>

        <div>
          <label htmlFor="refresh-token-lifespan" className="mb-1.5 block text-sm font-medium text-muted">
            Refresh Token Lifespan
          </label>
          <div className="flex items-center gap-3">
            <input
              id="refresh-token-lifespan"
              type="number"
              min={1}
              value={form.refreshTokenLifespan}
              onChange={(e) =>
                setForm({ ...form, refreshTokenLifespan: Number(e.target.value) })
              }
              className="w-40 rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
            <span className="text-sm text-subtle">seconds</span>
            <span className="rounded-full bg-sunken px-2.5 py-0.5 text-xs font-medium text-muted">
              {formatDuration(form.refreshTokenLifespan)}
            </span>
          </div>
          <p className="mt-1 text-xs text-subtle">
            How long a refresh token is valid. This also controls session duration.
          </p>
        </div>

        <div>
          <label htmlFor="offline-token-lifespan" className="mb-1.5 block text-sm font-medium text-muted">
            Offline Token Lifespan
          </label>
          <div className="flex items-center gap-3">
            <input
              id="offline-token-lifespan"
              type="number"
              min={60}
              value={form.offlineTokenLifespan}
              onChange={(e) =>
                setForm({ ...form, offlineTokenLifespan: Number(e.target.value) })
              }
              className="w-40 rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
            <span className="text-sm text-subtle">seconds</span>
            <span className="rounded-full bg-sunken px-2.5 py-0.5 text-xs font-medium text-muted">
              {formatDuration(form.offlineTokenLifespan)}
            </span>
          </div>
          <p className="mt-1 text-xs text-subtle">
            How long offline refresh tokens are valid. These survive session logout. Default: 30 days.
          </p>
        </div>
      </div>

      {updateMutation.isSuccess && (
        <div className="rounded-md bg-success-soft p-3 text-sm text-success-fg">
          Token settings updated successfully.
        </div>
      )}
      {updateMutation.isError && (
        <div className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
          Failed to update token settings.
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
