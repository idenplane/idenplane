import { useState, type FormEvent } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getClientById, updateClient, deleteClient, regenerateSecret, getServiceAccountUser } from '../../api/clients';
import {
  getClientDefaultScopes,
  getClientOptionalScopes,
  getClientScopes,
  assignClientDefaultScope,
  removeClientDefaultScope,
  assignClientOptionalScope,
  removeClientOptionalScope,
} from '../../api/clientScopes';
import ConfirmDialog from '../../components/ConfirmDialog';

export default function ClientDetailPage() {
  const { name, id } = useParams<{ name: string; id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showDelete, setShowDelete] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [selectedDefaultScope, setSelectedDefaultScope] = useState('');
  const [selectedOptionalScope, setSelectedOptionalScope] = useState('');

  const { data: client, isLoading } = useQuery({
    queryKey: ['client', name, id],
    queryFn: () => getClientById(name!, id!),
    enabled: !!name && !!id,
  });

  const { data: allScopes } = useQuery({
    queryKey: ['clientScopes', name],
    queryFn: () => getClientScopes(name!),
    enabled: !!name,
  });

  const { data: defaultScopes, refetch: refetchDefaults } = useQuery({
    queryKey: ['clientDefaultScopes', name, id],
    queryFn: () => getClientDefaultScopes(name!, id!),
    enabled: !!name && !!id,
  });

  const { data: optionalScopes, refetch: refetchOptionals } = useQuery({
    queryKey: ['clientOptionalScopes', name, id],
    queryFn: () => getClientOptionalScopes(name!, id!),
    enabled: !!name && !!id,
  });

  const hasClientCredentials = client?.grantTypes?.includes('client_credentials');

  const { data: serviceAccount } = useQuery({
    queryKey: ['serviceAccount', name, id],
    queryFn: () => getServiceAccountUser(name!, id!),
    enabled: !!name && !!id && !!client?.serviceAccountUserId,
  });

  const [form, setForm] = useState({
    name: '',
    description: '',
    redirectUris: '',
    webOrigins: '',
    grantTypes: '',
    requireConsent: false,
    enabled: true,
    backchannelLogoutUri: '',
    backchannelLogoutSessionRequired: true,
  });

  // Seed the editable form from fetched data when the loaded client changes.
  // Adjusting state during render (vs. an effect) avoids an extra render pass.
  const [seededClient, setSeededClient] = useState(client);
  if (client && client !== seededClient) {
    setSeededClient(client);
    setForm({
      name: client.name || '',
      description: client.description || '',
      redirectUris: (client.redirectUris || []).join('\n'),
      webOrigins: (client.webOrigins || []).join('\n'),
      grantTypes: (client.grantTypes || []).join(', '),
      requireConsent: client.requireConsent,
      enabled: client.enabled,
      backchannelLogoutUri: client.backchannelLogoutUri || '',
      backchannelLogoutSessionRequired: client.backchannelLogoutSessionRequired ?? true,
    });
  }

  const updateMutation = useMutation({
    mutationFn: () =>
      updateClient(name!, id!, {
        name: form.name,
        description: form.description,
        redirectUris: form.redirectUris
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        webOrigins: form.webOrigins
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        grantTypes: form.grantTypes
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        requireConsent: form.requireConsent,
        enabled: form.enabled,
        backchannelLogoutUri: form.backchannelLogoutUri || undefined,
        backchannelLogoutSessionRequired: form.backchannelLogoutSessionRequired,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', name, id] });
      queryClient.invalidateQueries({ queryKey: ['clients', name] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteClient(name!, id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients', name] });
      navigate(`/console/realms/${name}/clients`);
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: () => regenerateSecret(name!, id!),
    onSuccess: (data) => {
      setNewSecret(data.clientSecret);
    },
  });

  const addDefaultScopeMutation = useMutation({
    mutationFn: (scopeId: string) => assignClientDefaultScope(name!, id!, scopeId),
    onSuccess: () => {
      refetchDefaults();
      setSelectedDefaultScope('');
    },
  });

  const removeDefaultScopeMutation = useMutation({
    mutationFn: (scopeId: string) => removeClientDefaultScope(name!, id!, scopeId),
    onSuccess: () => refetchDefaults(),
  });

  const addOptionalScopeMutation = useMutation({
    mutationFn: (scopeId: string) => assignClientOptionalScope(name!, id!, scopeId),
    onSuccess: () => {
      refetchOptionals();
      setSelectedOptionalScope('');
    },
  });

  const removeOptionalScopeMutation = useMutation({
    mutationFn: (scopeId: string) => removeClientOptionalScope(name!, id!, scopeId),
    onSuccess: () => refetchOptionals(),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    updateMutation.mutate();
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-subtle">Loading client...</div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="rounded-md bg-danger-soft p-4 text-sm text-danger-fg">
        Client not found.
      </div>
    );
  }

  const assignedDefaultIds = new Set(defaultScopes?.map((s) => s.id) ?? []);
  const assignedOptionalIds = new Set(optionalScopes?.map((s) => s.id) ?? []);
  const assignedAll = new Set([...assignedDefaultIds, ...assignedOptionalIds]);
  const availableForDefault = allScopes?.filter((s) => !assignedAll.has(s.id)) ?? [];
  const availableForOptional = allScopes?.filter((s) => !assignedAll.has(s.id)) ?? [];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-fg">{client.clientId}</h1>
          <p className="mt-1 text-sm text-subtle">
            {client.name || 'No display name'} &middot;{' '}
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                client.clientType === 'CONFIDENTIAL'
                  ? 'bg-purple-100 text-purple-700'
                  : 'bg-info-soft text-info-fg'
              }`}
            >
              {client.clientType}
            </span>
          </p>
        </div>
        <button
          onClick={() => setShowDelete(true)}
          className="rounded-md border border-danger-soft px-4 py-2 text-sm font-medium text-danger-fg hover:bg-danger-soft"
        >
          Delete Client
        </button>
      </div>

      {/* Settings form */}
      <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-line bg-surface p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-fg">Settings</h2>

        <div>
          <label htmlFor="field-client-clientId" className="mb-1.5 block text-sm font-medium text-muted">Client ID</label>
          <input
            id="field-client-clientId"
            type="text"
            value={client.clientId}
            disabled
            className="w-full rounded-md border border-line bg-sunken px-3 py-2 text-sm text-subtle"
          />
        </div>

        <div>
          <label htmlFor="field-client-clientType" className="mb-1.5 block text-sm font-medium text-muted">Client Type</label>
          <input
            id="field-client-clientType"
            type="text"
            value={client.clientType}
            disabled
            className="w-full rounded-md border border-line bg-sunken px-3 py-2 text-sm text-subtle"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="field-client-name" className="mb-1.5 block text-sm font-medium text-muted">Name</label>
            <input
              id="field-client-name"
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="field-client-description" className="mb-1.5 block text-sm font-medium text-muted">Description</label>
            <input
              id="field-client-description"
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label htmlFor="field-client-redirectUris" className="mb-1.5 block text-sm font-medium text-muted">
            Redirect URIs (one per line)
          </label>
          <textarea
            id="field-client-redirectUris"
            value={form.redirectUris}
            onChange={(e) => setForm({ ...form, redirectUris: e.target.value })}
            rows={3}
            className="w-full rounded-md border border-line-strong px-3 py-2 text-sm font-mono shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="field-client-webOrigins" className="mb-1.5 block text-sm font-medium text-muted">
            Web Origins (one per line)
          </label>
          <textarea
            id="field-client-webOrigins"
            value={form.webOrigins}
            onChange={(e) => setForm({ ...form, webOrigins: e.target.value })}
            rows={2}
            className="w-full rounded-md border border-line-strong px-3 py-2 text-sm font-mono shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="field-client-grantTypes" className="mb-1.5 block text-sm font-medium text-muted">
            Grant Types (comma-separated)
          </label>
          <input
            id="field-client-grantTypes"
            type="text"
            value={form.grantTypes}
            onChange={(e) => setForm({ ...form, grantTypes: e.target.value })}
            className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="requireConsent"
              checked={form.requireConsent}
              onChange={(e) => setForm({ ...form, requireConsent: e.target.checked })}
              className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
            />
            <label htmlFor="requireConsent" className="text-sm font-medium text-muted">
              Require Consent
            </label>
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
        </div>

        <div className="border-t border-line pt-4">
          <h3 className="mb-3 text-sm font-semibold text-fg">Backchannel Logout</h3>
          <div>
            <label htmlFor="field-client-backchannelLogoutUri" className="mb-1.5 block text-sm font-medium text-muted">
              Backchannel Logout URI
            </label>
            <input
              id="field-client-backchannelLogoutUri"
              type="url"
              value={form.backchannelLogoutUri}
              onChange={(e) => setForm({ ...form, backchannelLogoutUri: e.target.value })}
              placeholder="https://example.com/backchannel-logout"
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
            <p className="mt-1 text-xs text-subtle">
              URL that will receive a logout token when the user logs out.
            </p>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input
              type="checkbox"
              id="backchannelLogoutSessionRequired"
              checked={form.backchannelLogoutSessionRequired}
              onChange={(e) => setForm({ ...form, backchannelLogoutSessionRequired: e.target.checked })}
              className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
            />
            <label htmlFor="backchannelLogoutSessionRequired" className="text-sm font-medium text-muted">
              Include session ID in logout token
            </label>
          </div>
        </div>

        {updateMutation.isSuccess && (
          <div className="rounded-md bg-success-soft p-3 text-sm text-success-fg">
            Client updated successfully.
          </div>
        )}

        {updateMutation.isError && (
          <div className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
            Failed to update client.
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

      {/* Credentials section (only for CONFIDENTIAL) */}
      {client.clientType === 'CONFIDENTIAL' && (
        <div className="space-y-4 rounded-lg border border-line bg-surface p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-fg">Credentials</h2>
          <p className="text-sm text-muted">
            This is a confidential client. You can regenerate the client secret below.
          </p>

          {newSecret && (
            <div className="rounded-md border border-success-soft bg-success-soft p-4">
              <p className="mb-2 text-sm font-medium text-success-fg">
                New secret generated. Save it now -- it will not be shown again.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md border border-success-soft bg-surface px-3 py-2 text-sm font-mono text-fg">
                  {newSecret}
                </code>
                <button
                  onClick={() => navigator.clipboard.writeText(newSecret)}
                  className="rounded-md border border-success-soft bg-surface px-3 py-2 text-sm font-medium text-success-fg hover:bg-success-soft"
                >
                  Copy
                </button>
              </div>
            </div>
          )}

          <button
            onClick={() => regenerateMutation.mutate()}
            disabled={regenerateMutation.isPending}
            className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {regenerateMutation.isPending ? 'Regenerating...' : 'Regenerate Secret'}
          </button>
        </div>
      )}

      {/* Client Scopes */}
      <div className="space-y-4 rounded-lg border border-line bg-surface p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-fg">Client Scopes</h2>

        {/* Default Scopes */}
        <div>
          <h3 className="mb-2 text-sm font-medium text-muted">Default Scopes</h3>
          <p className="mb-2 text-xs text-subtle">Always included in token requests for this client.</p>
          {defaultScopes && defaultScopes.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {defaultScopes.map((scope) => (
                <span
                  key={scope.id}
                  className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-3 py-1 text-sm font-medium text-accent"
                >
                  {scope.name}
                  <button
                    type="button"
                    onClick={() => removeDefaultScopeMutation.mutate(scope.id)}
                    className="ml-1 text-accent hover:text-accent"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-subtle">No default scopes assigned.</p>
          )}
        </div>

        {availableForDefault.length > 0 && (
          <div className="flex items-end gap-3 border-t border-line pt-4">
            <div className="flex-1">
              <label htmlFor="field-client-addDefaultScope" className="mb-1.5 block text-sm font-medium text-muted">Add Default Scope</label>
              <select
                id="field-client-addDefaultScope"
                value={selectedDefaultScope}
                onChange={(e) => setSelectedDefaultScope(e.target.value)}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              >
                <option value="">Select a scope...</option>
                {availableForDefault.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => selectedDefaultScope && addDefaultScopeMutation.mutate(selectedDefaultScope)}
              disabled={!selectedDefaultScope || addDefaultScopeMutation.isPending}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              Assign
            </button>
          </div>
        )}

        {/* Optional Scopes */}
        <div className="border-t border-line pt-4">
          <h3 className="mb-2 text-sm font-medium text-muted">Optional Scopes</h3>
          <p className="mb-2 text-xs text-subtle">Included only when explicitly requested in the scope parameter.</p>
          {optionalScopes && optionalScopes.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {optionalScopes.map((scope) => (
                <span
                  key={scope.id}
                  className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-3 py-1 text-sm font-medium text-warning-fg"
                >
                  {scope.name}
                  <button
                    type="button"
                    onClick={() => removeOptionalScopeMutation.mutate(scope.id)}
                    className="ml-1 text-amber-400 hover:text-warning"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-subtle">No optional scopes assigned.</p>
          )}
        </div>

        {availableForOptional.length > 0 && (
          <div className="flex items-end gap-3 border-t border-line pt-4">
            <div className="flex-1">
              <label htmlFor="field-client-addOptionalScope" className="mb-1.5 block text-sm font-medium text-muted">Add Optional Scope</label>
              <select
                id="field-client-addOptionalScope"
                value={selectedOptionalScope}
                onChange={(e) => setSelectedOptionalScope(e.target.value)}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              >
                <option value="">Select a scope...</option>
                {availableForOptional.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => selectedOptionalScope && addOptionalScopeMutation.mutate(selectedOptionalScope)}
              disabled={!selectedOptionalScope || addOptionalScopeMutation.isPending}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              Assign
            </button>
          </div>
        )}
      </div>

      {/* Service Account (only when client_credentials grant) */}
      {hasClientCredentials && (
        <div className="space-y-4 rounded-lg border border-line bg-surface p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-fg">Service Account</h2>
          <p className="text-sm text-muted">
            This client supports client_credentials grant. A service account user is linked to this client.
          </p>
          {serviceAccount ? (
            <div className="flex items-center gap-4">
              <div>
                <p className="text-sm font-medium text-fg">{serviceAccount.username}</p>
                <p className="text-xs text-subtle">ID: {serviceAccount.id}</p>
              </div>
              <Link
                to={`/console/realms/${name}/users/${serviceAccount.id}`}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
              >
                Manage Roles
              </Link>
            </div>
          ) : (
            <p className="text-sm text-subtle">No service account user found.</p>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={showDelete}
        title="Delete Client"
        message={`Are you sure you want to delete client "${client.clientId}"? This action is irreversible.`}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setShowDelete(false)}
      />
    </div>
  );
}
