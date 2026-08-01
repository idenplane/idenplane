import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Realm } from '../../types';
import { updateRealm } from '../../api/realms';
import { getUsers } from '../../api/users';
import { getClients } from '../../api/clients';
import { getRealmRoles } from '../../api/roles';
import { getGroups } from '../../api/groups';
import { getClientScopes } from '../../api/clientScopes';
import { getRealmSessions } from '../../api/sessions';
import { getIdentityProviders } from '../../api/identityProviders';

type GeneralSettingsFormProps = {
  realm: Realm;
};

function seedFromRealm(realm: Realm) {
  return {
    displayName: realm.displayName ?? '',
    enabled: realm.enabled,
    registrationAllowed: realm.registrationAllowed ?? true,
  };
}

export default function GeneralSettingsForm({ realm }: GeneralSettingsFormProps) {
  const queryClient = useQueryClient();
  const name = realm.name;

  const { data: users } = useQuery({
    queryKey: ['users', name],
    queryFn: () => getUsers(name),
  });

  const { data: clients } = useQuery({
    queryKey: ['clients', name],
    queryFn: () => getClients(name),
  });

  const { data: roles } = useQuery({
    queryKey: ['roles', name],
    queryFn: () => getRealmRoles(name),
  });

  const { data: groups } = useQuery({
    queryKey: ['groups', name],
    queryFn: () => getGroups(name),
  });

  const { data: clientScopes } = useQuery({
    queryKey: ['clientScopes', name],
    queryFn: () => getClientScopes(name),
  });

  const { data: sessions } = useQuery({
    queryKey: ['sessions', name],
    queryFn: () => getRealmSessions(name),
  });

  const { data: identityProviders } = useQuery({
    queryKey: ['identity-providers', name],
    queryFn: () => getIdentityProviders(name),
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
        displayName: form.displayName,
        enabled: form.enabled,
        registrationAllowed: form.registrationAllowed,
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

  const quickLinks = [
    { to: `/console/realms/${name}/users`, label: 'Users', count: users?.total },
    { to: `/console/realms/${name}/clients`, label: 'Clients', count: clients?.length },
    { to: `/console/realms/${name}/roles`, label: 'Roles', count: roles?.length },
    { to: `/console/realms/${name}/groups`, label: 'Groups', count: groups?.length },
    { to: `/console/realms/${name}/client-scopes`, label: 'Client Scopes', count: clientScopes?.length },
    { to: `/console/realms/${name}/sessions`, label: 'Sessions', count: sessions?.length },
    { to: `/console/realms/${name}/identity-providers`, label: 'Identity Providers', count: identityProviders?.length },
  ];

  return (
    <div className="space-y-8">
      {/* Quick links */}
      <div className="grid gap-4 sm:grid-cols-3">
        {quickLinks.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="flex items-center justify-between rounded-lg border border-line bg-surface p-4 shadow-sm hover:shadow-md transition-shadow"
          >
            <div>
              <p className="text-sm font-medium text-subtle">{link.label}</p>
              <p className="text-2xl font-bold text-fg">
                {link.count !== undefined ? link.count : '-'}
              </p>
            </div>
            <svg className="h-5 w-5 text-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        ))}
      </div>

      {/* General settings form */}
      <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-line bg-surface p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-fg">General Settings</h2>

        <div>
          <label htmlFor="realm-name" className="mb-1.5 block text-sm font-medium text-muted">Name</label>
          <input
            id="realm-name"
            type="text"
            value={realm.name}
            disabled
            className="w-full rounded-md border border-line bg-sunken px-3 py-2 text-sm text-subtle"
          />
          <p className="mt-1 text-xs text-subtle">Realm name cannot be changed</p>
        </div>

        <div>
          <label htmlFor="realm-display-name" className="mb-1.5 block text-sm font-medium text-muted">Display Name</label>
          <input
            id="realm-display-name"
            type="text"
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="enabled"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
          />
          <label htmlFor="enabled" className="text-sm font-medium text-muted">
            Enabled
          </label>
        </div>

        <div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="registrationAllowed"
              checked={form.registrationAllowed}
              onChange={(e) => setForm({ ...form, registrationAllowed: e.target.checked })}
              className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
            />
            <label htmlFor="registrationAllowed" className="text-sm font-medium text-muted">
              User Registration
            </label>
          </div>
          <p className="mt-1 ml-6 text-xs text-subtle">When disabled, users cannot self-register. Only admins can create accounts.</p>
        </div>

        {updateMutation.isSuccess && (
          <div className="rounded-md bg-success-soft p-3 text-sm text-success-fg">
            Realm updated successfully.
          </div>
        )}
        {updateMutation.isError && (
          <div className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
            Failed to update realm.
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
    </div>
  );
}
