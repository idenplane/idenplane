import { useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
  const { name, id } = useParams<{ name: string; id: string }>();
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
    return <div className="text-gray-500">Loading service account...</div>;
  }

  if (!account) {
    return <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">Service account not found.</div>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{account.name}</h1>
          {account.description && (
            <p className="mt-1 text-sm text-gray-500">{account.description}</p>
          )}
        </div>
        <button
          onClick={() => setShowDelete(true)}
          className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
        >
          Delete
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="space-y-4">
          <div>
            <label htmlFor="field-sa-name" className="mb-1.5 block text-sm font-medium text-gray-700">Name *</label>
            <input
              id="field-sa-name"
              type="text"
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="field-sa-description" className="mb-1.5 block text-sm font-medium text-gray-700">Description</label>
            <input
              id="field-sa-description"
              type="text"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="field-sa-allowedIps" className="mb-1.5 block text-sm font-medium text-gray-700">Allowed IPs</label>
            <textarea
              id="field-sa-allowedIps"
              rows={4}
              value={form.allowedIps}
              onChange={(e) => set('allowedIps', e.target.value)}
              placeholder="One IP or CIDR per line"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="field-sa-enabled"
              checked={form.enabled}
              onChange={(e) => set('enabled', e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <label htmlFor="field-sa-enabled" className="text-sm font-medium text-gray-700">Enabled</label>
          </div>
        </div>

        {updateMutation.isSuccess && (
          <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
            Service account updated successfully.
          </div>
        )}
        {updateMutation.isError && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            Failed to update service account.
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

      {newKey && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 space-y-2">
          <p className="text-sm font-semibold text-yellow-800">
            Copy your API key now — it will not be shown again.
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={newKey.plainKey}
              className="flex-1 rounded-md border border-yellow-300 bg-white px-3 py-2 font-mono text-sm text-gray-800 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleCopy}
              className="rounded-md border border-yellow-300 bg-white px-3 py-2 text-sm font-medium text-yellow-800 hover:bg-yellow-100"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setNewKey(null)}
            className="text-xs text-yellow-700 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">API Keys</h2>
          {!showKeyForm && (
            <button
              type="button"
              onClick={() => setShowKeyForm(true)}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Generate API Key
            </button>
          )}
        </div>

        {showKeyForm && (
          <form
            onSubmit={handleKeyFormSubmit}
            className="space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
          >
            <h3 className="text-base font-semibold text-gray-900">New API Key</h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="field-key-name" className="mb-1.5 block text-sm font-medium text-gray-700">Name</label>
                <input
                  id="field-key-name"
                  type="text"
                  value={keyForm.name}
                  onChange={(e) => setKey('name', e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="field-key-scopes" className="mb-1.5 block text-sm font-medium text-gray-700">Scopes</label>
                <input
                  id="field-key-scopes"
                  type="text"
                  value={keyForm.scopes}
                  onChange={(e) => setKey('scopes', e.target.value)}
                  placeholder="Comma-separated"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label htmlFor="field-key-expiresAt" className="mb-1.5 block text-sm font-medium text-gray-700">Expires At</label>
              <input
                id="field-key-expiresAt"
                type="date"
                value={keyForm.expiresAt}
                onChange={(e) => setKey('expiresAt', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label htmlFor="field-key-rpm" className="mb-1.5 block text-sm font-medium text-gray-700">Rate limit / min</label>
                <input
                  id="field-key-rpm"
                  type="number"
                  min={1}
                  value={keyForm.rateLimitPerMinute}
                  onChange={(e) => setKey('rateLimitPerMinute', e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="field-key-rpd" className="mb-1.5 block text-sm font-medium text-gray-700">Max req / day</label>
                <input
                  id="field-key-rpd"
                  type="number"
                  min={1}
                  value={keyForm.maxRequestsPerDay}
                  onChange={(e) => setKey('maxRequestsPerDay', e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="field-key-rpm2" className="mb-1.5 block text-sm font-medium text-gray-700">Max req / month</label>
                <input
                  id="field-key-rpm2"
                  type="number"
                  min={1}
                  value={keyForm.maxRequestsPerMonth}
                  onChange={(e) => setKey('maxRequestsPerMonth', e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            {createKeyMutation.isError && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
                {(createKeyMutation.error as Error)?.message || 'Failed to generate API key.'}
              </div>
            )}

            <div className="flex justify-end gap-3 border-t border-gray-200 pt-4">
              <button
                type="button"
                onClick={() => setShowKeyForm(false)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createKeyMutation.isPending}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {createKeyMutation.isPending ? 'Generating...' : 'Generate'}
              </button>
            </div>
          </form>
        )}

        {apiKeys && apiKeys.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Prefix</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Scopes</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Expires</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {apiKeys.map((key) => (
                  <tr key={key.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-6 py-4 font-mono text-sm text-gray-700">
                      {key.keyPrefix ?? '-'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                      {key.name ?? '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {key.scopes.length > 0 ? key.scopes.join(', ') : '-'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                      {key.expiresAt ? new Date(key.expiresAt).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          key.revoked
                            ? 'bg-red-100 text-red-700'
                            : key.enabled
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-700'
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
                            className="text-red-600 hover:text-red-800 disabled:opacity-50"
                          >
                            Revoke
                          </button>
                        )}
                        {!key.revoked && (
                          <button
                            type="button"
                            onClick={() => rotateMutation.mutate(key.id)}
                            disabled={rotateMutation.isPending}
                            className="text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
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
          <div className="rounded-md border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
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
