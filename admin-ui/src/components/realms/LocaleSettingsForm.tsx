import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Realm } from '../../types';
import { updateRealm } from '../../api/realms';

type LocaleSettingsFormProps = {
  realm: Realm;
};

function seedFromRealm(realm: Realm) {
  return {
    defaultLocale: realm.defaultLocale ?? 'en',
    supportedLocales: realm.supportedLocales ?? [],
  };
}

export default function LocaleSettingsForm({ realm }: LocaleSettingsFormProps) {
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
        defaultLocale: form.defaultLocale,
        supportedLocales: form.supportedLocales,
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
        <h2 className="text-lg font-semibold text-fg">Locale &amp; Internationalization</h2>
        <p className="mt-1 text-sm text-subtle">
          Configure the default language and supported locales for this realm.
        </p>
      </div>

      <div className="space-y-6">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">Default Locale</label>
          <input
            type="text"
            value={form.defaultLocale}
            onChange={(e) => setForm({ ...form, defaultLocale: e.target.value })}
            placeholder="en"
            className="w-48 rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
          <p className="mt-1 text-xs text-subtle">
            BCP 47 language tag (e.g. en, en-US, fr, de, ar). Used when no user preference is set.
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">Supported Locales</label>
          <input
            type="text"
            value={form.supportedLocales.join(', ')}
            onChange={(e) =>
              setForm({
                ...form,
                supportedLocales: e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder="en, fr, de, ar"
            className="w-full max-w-md rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
          <p className="mt-1 text-xs text-subtle">
            Comma-separated list of supported locale codes. Users can switch between these in the account UI.
          </p>
        </div>
      </div>

      {updateMutation.isSuccess && (
        <div className="rounded-md bg-success-soft p-3 text-sm text-success-fg">
          Locale settings updated successfully.
        </div>
      )}
      {updateMutation.isError && (
        <div className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
          Failed to update locale settings.
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
