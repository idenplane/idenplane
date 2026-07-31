import { useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getServiceAccount,
  updateServiceAccount,
  deleteServiceAccount,
  getApiKeys,
  createApiKey,
  revokeApiKey,
  rotateApiKey,
  type ApiKeyCreateResult,
} from '../../api/serviceAccounts';
import ConfirmDialog from '../../components/ConfirmDialog';

export default function ServiceAccountDetailPage() {
  const { name, accountId: id } = useParams<{ name: string; accountId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showDelete, setShowDelete] = useState(false);
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [newKey, setNewKey] = useState<ApiKeyCreateResult | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: account, isLoading } = useQuery({
    queryKey: ['service-account', name, id],
    queryFn: () => getServiceAccount(name!, id!),
    enabled: !!name && !!id,
  });

  const { data: apiKeys } = useQuery({
    queryKey: ['api-keys', name, id],
    queryFn: () => getApiKeys(name!, id!),
    enabled: !!name && !!id,
  });

  const [form, setForm] = useState({
    name: '',
    description: '',
    allowedIps: '',
    enabled: true,
  });

  const [seededAccount, setSeededAccount] = useState(account);
  if (account && account !== seededAccount) {
    setSeededAccount(account);
    setForm({
      name: account.name,
      description: account.description ?? '',
      allowedIps: account.allowedIps.join('\n'),
      enabled: account.enabled,
    });
  }

  const [keyForm, setKeyForm] = useState({
    name: '',
    scopes: '',
    expiresAt: '',
    maxRequestsPerDay: '',
    maxRequestsPerMonth: '',
    rateLimitPerMinute: '',
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      updateServiceAccount(name!, id!, {
        name: form.name,
        description: form.description || undefined,
        allowedIps: form.allowedIps
          ? form.allowedIps.split('\n').map((s) => s.trim()).filter(Boolean)
          : [],
        enabled: form.enabled,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-account', name, id] });
      queryClient.invalidateQueries({ queryKey: ['service-accounts', name] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteServiceAccount(name!, id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-accounts', name] });
      navigate(`/console/realms/${name}/service-accounts`);
    },
  });

  const createKeyMutation = useMutation({
    mutationFn: () =>
      createApiKey(name!, id!, {
        name: keyForm.name || undefined,
        scopes: keyForm.scopes ? keyForm.scopes.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        expiresAt: keyForm.expiresAt || undefined,
        maxRequestsPerDay: keyForm.maxRequestsPerDay ? Number(keyForm.maxRequestsPerDay) : undefined,
        maxRequestsPerMonth: keyForm.maxRequestsPerMonth ? Number(keyForm.maxRequestsPerMonth) : undefined,
        rateLimitPerMinute: keyForm.rateLimitPerMinute ? Number(keyForm.rateLimitPerMinute) : undefined,
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['api-keys', name, id] });
      setNewKey(result);
      setShowKeyForm(false);
      setKeyForm({ name: '', scopes: '', expiresAt: '', maxRequestsPerDay: '', maxRequestsPerMonth: '', rateLimitPerMinute: '' });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (keyId: string) => revokeApiKey(name!, id!, keyId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-keys', name, id] }),
  });

  const rotateMutation = useMutation({
    mutationFn: (keyId: string) => rotateApiKey(name!, id!, keyId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['api-keys', name, id] });
      setNewKey(result);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    updateMutation.mutate();
  }

  function handleKeyFormSubmit(e: FormEvent) {
    e.preventDefault();
    createKeyMutation.mutate();
  }

  function handleCopy() {
    if (newKey) {
      navigator.clipboard.writeText(newKey.plainKey).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }

  const set = (field: string, value: string | boolean) =>
    setForm((f) => ({ ...f, [field]: value }));

  const setKey = (field: string, value: string) =>
    setKeyForm((f) => ({ ...f, [field]: value }));

  if (isLoading) {
    return <div className="text-subtle">Loading service account...</div>;
  }

  if (!account) {
    return <div className="rounded-md bg-danger-soft p-4 text-sm text-danger-fg">Service account not found.</div>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-fg">{account.name}</h1>
          {account.description && (
            <p className="mt-1 text-sm text-subtle">{account.description}</p>
          )}
        </div>
        <button
          onClick={() => setShowDelete(true)}
          className="rounded-md border border-danger-soft px-4 py-2 text-sm font-medium text-danger-fg hover:bg-danger-soft"
        >
          Delete
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-line bg-surface p-6 shadow-sm">
        <div className="space-y-4">
          <div>
            <label htmlFor="field-sa-name" className="mb-1.5 block text-sm font-medium text-muted">Name *</label>
            <input
              id="field-sa-name"
              type="text"
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="field-sa-description" className="mb-1.5 block text-sm font-medium text-muted">Description</label>
            <input
              id="field-sa-description"
              type="text"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="field-sa-allowedIps" className="mb-1.5 block text-sm font-medium text-muted">Allowed IPs</label>
            <textarea
              id="field-sa-allowedIps"
              rows={4}
              value={form.allowedIps}
              onChange={(e) => set('allowedIps', e.target.value)}
              placeholder="One IP or CIDR per line"
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="field-sa-enabled"
              checked={form.enabled}
              onChange={(e) => set('enabled', e.target.checked)}
              className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
            />
            <label htmlFor="field-sa-enabled" className="text-sm font-medium text-muted">Enabled</label>
          </div>
        </div>

        {updateMutation.isSuccess && (
          <div className="rounded-md bg-success-soft p-3 text-sm text-success-fg">
            Service account updated successfully.
          </div>
        )}
        {updateMutation.isError && (
          <div className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
            Failed to update service account.
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

      {newKey && (
        <div className="rounded-lg border border-warning-soft bg-warning-soft p-4 space-y-2">
          <p className="text-sm font-semibold text-warning-fg">
            Copy your API key now — it will not be shown again.
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={newKey.plainKey}
              className="flex-1 rounded-md border border-warning-soft bg-surface px-3 py-2 font-mono text-sm text-fg focus:outline-none"
            />
            <button
              type="button"
              onClick={handleCopy}
              className="rounded-md border border-warning-soft bg-surface px-3 py-2 text-sm font-medium text-warning-fg hover:bg-warning-soft"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setNewKey(null)}
            className="text-xs text-warning-fg underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-fg">API Keys</h2>
          {!showKeyForm && (
            <button
              type="button"
              onClick={() => setShowKeyForm(true)}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
            >
              Generate API Key
            </button>
          )}
        </div>

        {showKeyForm && (
          <form
            onSubmit={handleKeyFormSubmit}
            className="space-y-4 rounded-lg border border-line bg-surface p-6 shadow-sm"
          >
            <h3 className="text-base font-semibold text-fg">New API Key</h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="field-key-name" className="mb-1.5 block text-sm font-medium text-muted">Name</label>
                <input
                  id="field-key-name"
                  type="text"
                  value={keyForm.name}
                  onChange={(e) => setKey('name', e.target.value)}
                  className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="field-key-scopes" className="mb-1.5 block text-sm font-medium text-muted">Scopes</label>
                <input
                  id="field-key-scopes"
                  type="text"
                  value={keyForm.scopes}
                  onChange={(e) => setKey('scopes', e.target.value)}
                  placeholder="Comma-separated"
                  className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label htmlFor="field-key-expiresAt" className="mb-1.5 block text-sm font-medium text-muted">Expires At</label>
              <input
                id="field-key-expiresAt"
                type="date"
                value={keyForm.expiresAt}
                onChange={(e) => setKey('expiresAt', e.target.value)}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label htmlFor="field-key-rpm" className="mb-1.5 block text-sm font-medium text-muted">Rate limit / min</label>
                <input
                  id="field-key-rpm"
                  type="number"
                  min={1}
                  value={keyForm.rateLimitPerMinute}
                  onChange={(e) => setKey('rateLimitPerMinute', e.target.value)}
                  className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="field-key-rpd" className="mb-1.5 block text-sm font-medium text-muted">Max req / day</label>
                <input
                  id="field-key-rpd"
                  type="number"
                  min={1}
                  value={keyForm.maxRequestsPerDay}
                  onChange={(e) => setKey('maxRequestsPerDay', e.target.value)}
                  className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="field-key-rpm2" className="mb-1.5 block text-sm font-medium text-muted">Max req / month</label>
                <input
                  id="field-key-rpm2"
                  type="number"
                  min={1}
                  value={keyForm.maxRequestsPerMonth}
                  onChange={(e) => setKey('maxRequestsPerMonth', e.target.value)}
                  className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                />
              </div>
            </div>

            {createKeyMutation.isError && (
              <div className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
                {(createKeyMutation.error as Error)?.message || 'Failed to generate API key.'}
              </div>
            )}

            <div className="flex justify-end gap-3 border-t border-line pt-4">
              <button
                type="button"
                onClick={() => setShowKeyForm(false)}
                className="rounded-md border border-line-strong px-4 py-2 text-sm font-medium text-muted hover:bg-hover"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createKeyMutation.isPending}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {createKeyMutation.isPending ? 'Generating...' : 'Generate'}
              </button>
            </div>
          </form>
        )}

        {apiKeys && apiKeys.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
            <table className="min-w-full divide-y divide-line">
              <thead className="bg-sunken">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Prefix</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Scopes</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Expires</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {apiKeys.map((key) => (
                  <tr key={key.id} className="hover:bg-hover">
                    <td className="whitespace-nowrap px-6 py-4 font-mono text-sm text-muted">
                      {key.keyPrefix ?? '-'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-muted">
                      {key.name ?? '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-subtle">
                      {key.scopes.length > 0 ? key.scopes.join(', ') : '-'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-subtle">
                      {key.expiresAt ? new Date(key.expiresAt).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          key.revoked
                            ? 'bg-danger-soft text-danger-fg'
                            : key.enabled
                            ? 'bg-success-soft text-success-fg'
                            : 'bg-sunken text-muted'
                        }`}
                      >
                        {key.revoked ? 'Revoked' : key.enabled ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm">
                      <div className="flex items-center gap-2">
                        {!key.revoked && (
                          <button
                            type="button"
                            onClick={() => revokeMutation.mutate(key.id)}
                            disabled={revokeMutation.isPending}
                            className="text-danger hover:text-danger-fg disabled:opacity-50"
                          >
                            Revoke
                          </button>
                        )}
                        {!key.revoked && (
                          <button
                            type="button"
                            onClick={() => rotateMutation.mutate(key.id)}
                            disabled={rotateMutation.isPending}
                            className="text-accent hover:text-indigo-800 disabled:opacity-50"
                          >
                            Rotate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {apiKeys && apiKeys.length === 0 && (
          <div className="rounded-md border border-line bg-surface p-6 text-center text-sm text-subtle">
            No API keys yet.
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={showDelete}
        title="Delete Service Account"
        message={`Are you sure you want to delete service account "${account.name}"?`}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setShowDelete(false)}
      />
    </div>
  );
}
