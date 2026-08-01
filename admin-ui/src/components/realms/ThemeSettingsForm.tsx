import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Realm } from '../../types';
import { updateRealm, getThemes, type ThemeInfo } from '../../api/realms';

type ThemeSettingsFormProps = {
  realm: Realm;
};

function seedFromRealm(realm: Realm) {
  return {
    themeName: realm.themeName ?? 'idenplane',
    loginTheme: realm.loginTheme ?? 'idenplane',
    accountTheme: realm.accountTheme ?? 'idenplane',
    emailTheme: realm.emailTheme ?? 'idenplane',
  };
}

export default function ThemeSettingsForm({ realm }: ThemeSettingsFormProps) {
  const queryClient = useQueryClient();

  const { data: themes } = useQuery({
    queryKey: ['themes'],
    queryFn: () => getThemes(),
  });

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
        themeName: form.themeName,
        loginTheme: form.loginTheme,
        accountTheme: form.accountTheme,
        emailTheme: form.emailTheme,
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
        <h2 className="text-lg font-semibold text-fg">Theme Settings</h2>
        <p className="mt-1 text-sm text-subtle">
          Assign themes per page type and customize colors for this realm.
        </p>
      </div>

      {/* Per-Type Theme Selectors */}
      {themes && themes.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-subtle">Theme Assignment</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted">Login Theme</label>
              <select
                value={form.loginTheme}
                onChange={(e) => setForm({ ...form, loginTheme: e.target.value, themeName: e.target.value })}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              >
                {themes.map((t: ThemeInfo) => (
                  <option key={t.name} value={t.name}>{t.displayName}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-subtle">Applied to login, register, consent, and other auth pages</p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted">Account Theme</label>
              <select
                value={form.accountTheme}
                onChange={(e) => setForm({ ...form, accountTheme: e.target.value })}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              >
                {themes.map((t: ThemeInfo) => (
                  <option key={t.name} value={t.name}>{t.displayName}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-subtle">Applied to account management and TOTP setup pages</p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted">Email Theme</label>
              <select
                value={form.emailTheme}
                onChange={(e) => setForm({ ...form, emailTheme: e.target.value })}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              >
                {themes.map((t: ThemeInfo) => (
                  <option key={t.name} value={t.name}>{t.displayName}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-subtle">Applied to verification and password reset emails</p>
            </div>
          </div>
        </div>
      )}

      {updateMutation.isSuccess && (
        <div className="rounded-md bg-success-soft p-3 text-sm text-success-fg">
          Theme settings updated successfully.
        </div>
      )}
      {updateMutation.isError && (
        <div className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
          Failed to update theme settings.
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
