import { useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFederation } from '../../api/userFederation';
import PasswordInput from '../../components/PasswordInput';

export default function FederationCreatePage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    name: '',
    connectionUrl: '',
    bindDn: '',
    bindCredential: '',
    usersDn: '',
  });

  const mutation = useMutation({
    mutationFn: () =>
      createFederation(name!, {
        name: form.name,
        connectionUrl: form.connectionUrl,
        bindDn: form.bindDn,
        bindCredential: form.bindCredential,
        usersDn: form.usersDn,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['user-federations', name] });
      navigate(`/console/realms/${name}/user-federation/${data.id}`);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  const set = (field: string, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-fg">Add Federation Provider</h1>

      <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-line bg-surface p-6 shadow-sm">
        {/* General */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-fg">General</h2>

          <div>
            <label htmlFor="field-federation-name" className="mb-1.5 block text-sm font-medium text-muted">Name *</label>
            <input
              id="field-federation-name"
              type="text"
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>
        </div>

        {/* Connection */}
        <div className="space-y-4 border-t border-line pt-4">
          <h2 className="text-lg font-semibold text-fg">Connection</h2>

          <div>
            <label htmlFor="field-federation-connectionUrl" className="mb-1.5 block text-sm font-medium text-muted">Connection URL *</label>
            <input
              id="field-federation-connectionUrl"
              type="text"
              required
              value={form.connectionUrl}
              onChange={(e) => set('connectionUrl', e.target.value)}
              placeholder="ldap://localhost:389"
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="field-federation-bindDn" className="mb-1.5 block text-sm font-medium text-muted">Bind DN *</label>
              <input
                id="field-federation-bindDn"
                type="text"
                required
                value={form.bindDn}
                onChange={(e) => set('bindDn', e.target.value)}
                placeholder="cn=admin,dc=example,dc=org"
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="field-federation-bindCredential" className="mb-1.5 block text-sm font-medium text-muted">Bind Credential *</label>
              <PasswordInput
                id="field-federation-bindCredential"
                required
                value={form.bindCredential}
                onChange={(e) => set('bindCredential', e.target.value)}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="field-federation-usersDn" className="mb-1.5 block text-sm font-medium text-muted">Users DN *</label>
            <input
              id="field-federation-usersDn"
              type="text"
              required
              value={form.usersDn}
              onChange={(e) => set('usersDn', e.target.value)}
              placeholder="ou=users,dc=example,dc=org"
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>
        </div>

        {mutation.isError && (
          <div className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
            {(mutation.error as Error)?.message || 'Failed to create federation provider.'}
          </div>
        )}

        <div className="flex justify-end gap-3 border-t border-line pt-4">
          <button
            type="button"
            onClick={() => navigate(`/console/realms/${name}/user-federation`)}
            className="rounded-md border border-line-strong px-4 py-2 text-sm font-medium text-muted hover:bg-hover"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {mutation.isPending ? 'Creating...' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
