import { useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getNhiIdentityById,
  updateNhiIdentity,
  deleteNhiIdentity,
  suspendNhiIdentity,
  reactivateNhiIdentity,
  decommissionNhiIdentity,
  getNhiCredentials,
  revokeNhiCredential,
  rotateNhiCredential,
  createNhiCredential,
} from '../../api/nhi';
import type { NhiIdentityType, NhiLifecycleStatus, NhiCredentialType } from '../../types';
import ConfirmDialog from '../../components/ConfirmDialog';

// ── Helpers ───────────────────────────────────────────────────────────────────

const identityTypeColors: Record<NhiIdentityType, string> = {
  IOT_DEVICE: 'bg-blue-100 text-blue-700',
  AI_AGENT: 'bg-purple-100 text-purple-700',
  BOT: 'bg-amber-100 text-amber-700',
  MACHINE_TO_MACHINE: 'bg-green-100 text-green-700',
};

const statusColors: Record<NhiLifecycleStatus, string> = {
  PROVISIONING: 'bg-yellow-100 text-yellow-700',
  ACTIVE: 'bg-green-100 text-green-700',
  SUSPENDED: 'bg-orange-100 text-orange-700',
  DECOMMISSIONED: 'bg-gray-100 text-gray-700',
};

const credentialTypeColors: Record<NhiCredentialType, string> = {
  API_KEY: 'bg-indigo-100 text-indigo-700',
  CERTIFICATE: 'bg-emerald-100 text-emerald-700',
  JWT_BEARER: 'bg-rose-100 text-rose-700',
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function NhiDetailPage() {
  const { name, id } = useParams<{ name: string; id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showDelete, setShowDelete] = useState(false);
  const [showCreateCredential, setShowCreateCredential] = useState(false);
  const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(null);
  const [newCredentialResult, setNewCredentialResult] = useState<{ key: string } | null>(null);

  // Create credential form state
  const [credForm, setCredForm] = useState({
    credentialType: 'API_KEY' as NhiCredentialType,
    name: '',
    expiresAt: '',
    rotationRequired: false,
  });

  const { data: identity, isLoading } = useQuery({
    queryKey: ['nhi-identity', name, id],
    queryFn: () => getNhiIdentityById(name!, id!),
    enabled: !!name && !!id,
  });

  const { data: credentials } = useQuery({
    queryKey: ['nhi-credentials', name, id],
    queryFn: () => getNhiCredentials(name!, id!),
    enabled: !!name && !!id,
  });

  const [form, setForm] = useState({
    name: '',
    description: '',
    agentPurpose: '',
    enabled: true,
  });

  // Seed the editable form from fetched data when the loaded identity changes.
  // Adjusting state during render (vs. an effect) avoids an extra render pass.
  const [seededIdentity, setSeededIdentity] = useState(identity);
  if (identity && identity !== seededIdentity) {
    setSeededIdentity(identity);
    setForm({
      name: identity.name || '',
      description: identity.description || '',
      agentPurpose: identity.agentPurpose || '',
      enabled: identity.enabled,
    });
  }

  const updateMutation = useMutation({
    mutationFn: () =>
      updateNhiIdentity(name!, id!, {
        name: form.name,
        description: form.description || undefined,
        agentPurpose: form.agentPurpose || undefined,
        enabled: form.enabled,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nhi-identity', name, id] });
      queryClient.invalidateQueries({ queryKey: ['nhi-identities', name] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteNhiIdentity(name!, id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nhi-identities', name] });
      navigate(`/console/realms/${name}/nhi`);
    },
  });

  const suspendMutation = useMutation({
    mutationFn: () => suspendNhiIdentity(name!, id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nhi-identity', name, id] });
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: () => reactivateNhiIdentity(name!, id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nhi-identity', name, id] });
    },
  });

  const decommissionMutation = useMutation({
    mutationFn: () => decommissionNhiIdentity(name!, id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nhi-identity', name, id] });
    },
  });

  const revokeCredentialMutation = useMutation({
    mutationFn: (credentialId: string) => revokeNhiCredential(name!, id!, credentialId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nhi-credentials', name, id] });
      setSelectedCredentialId(null);
    },
  });

  const rotateCredentialMutation = useMutation({
    mutationFn: (credentialId: string) => rotateNhiCredential(name!, id!, credentialId),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['nhi-credentials', name, id] });
      setNewCredentialResult({ key: data.newCredential.keyPrefix || data.newCredential.id });
      setSelectedCredentialId(null);
    },
  });

  const createCredentialMutation = useMutation({
    mutationFn: () =>
      createNhiCredential(name!, id!, {
        credentialType: credForm.credentialType,
        name: credForm.name,
        expiresAt: credForm.expiresAt || undefined,
        rotationRequired: credForm.rotationRequired,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['nhi-credentials', name, id] });
      setShowCreateCredential(false);
      setCredForm({ credentialType: 'API_KEY', name: '', expiresAt: '', rotationRequired: false });
      if (data.keyPrefix) {
        setNewCredentialResult({ key: data.keyPrefix });
      }
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    updateMutation.mutate();
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading identity...</div>
      </div>
    );
  }

  if (!identity) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
        Identity not found.
      </div>
    );
  }

  const isActive = identity.lifecycleStatus === 'ACTIVE';
  const isSuspended = identity.lifecycleStatus === 'SUSPENDED';
  const isDecommissioned = identity.lifecycleStatus === 'DECOMMISSIONED';

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{identity.name}</h1>
            <span
              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                identityTypeColors[identity.identityType]
              }`}
            >
              {identity.identityType.replace(/_/g, ' ')}
            </span>
            <span
              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                statusColors[identity.lifecycleStatus]
              }`}
            >
              {identity.lifecycleStatus}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {identity.description || 'No description'}
            {identity.certificateFingerprint && (
              <span className="ml-2 text-green-600">· Certificate active</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!isDecommissioned && (
            <>
              {isActive && (
                <button
                  onClick={() => suspendMutation.mutate()}
                  disabled={suspendMutation.isPending}
                  className="rounded-md border border-orange-300 px-4 py-2 text-sm font-medium text-orange-700 hover:bg-orange-50 disabled:opacity-50"
                >
                  {suspendMutation.isPending ? 'Suspending...' : 'Suspend'}
                </button>
              )}
              {isSuspended && (
                <button
                  onClick={() => reactivateMutation.mutate()}
                  disabled={reactivateMutation.isPending}
                  className="rounded-md border border-green-300 px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-50 disabled:opacity-50"
                >
                  {reactivateMutation.isPending ? 'Reactivating...' : 'Reactivate'}
                </button>
              )}
              <button
                onClick={() => decommissionMutation.mutate()}
                disabled={decommissionMutation.isPending}
                className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                {decommissionMutation.isPending ? 'Decommissioning...' : 'Decommission'}
              </button>
            </>
          )}
          {!isDecommissioned && (
            <button
              onClick={() => setShowDelete(true)}
              className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Settings form */}
      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
      >
        <h2 className="text-lg font-semibold text-gray-900">Settings</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="field-nhi-name"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              Name
            </label>
            <input
              id="field-nhi-name"
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              disabled={isDecommissioned}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
            />
          </div>
          <div>
            <label
              htmlFor="field-nhi-agentPurpose"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              Agent Purpose
            </label>
            <input
              id="field-nhi-agentPurpose"
              type="text"
              value={form.agentPurpose}
              onChange={(e) => setForm({ ...form, agentPurpose: e.target.value })}
              disabled={isDecommissioned}
              placeholder="e.g., data pipeline, monitoring"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="field-nhi-description"
            className="mb-1.5 block text-sm font-medium text-gray-700"
          >
            Description
          </label>
          <textarea
            id="field-nhi-description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            disabled={isDecommissioned}
            rows={2}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
          />
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="nhi-enabled"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              disabled={isDecommissioned}
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 disabled:cursor-not-allowed"
            />
            <label
              htmlFor="nhi-enabled"
              className="text-sm font-medium text-gray-700"
            >
              Enabled
            </label>
          </div>
        </div>

        {/* Permission Scopes */}
        {identity.permissionScopes && identity.permissionScopes.length > 0 && (
          <div className="border-t border-gray-200 pt-4">
            <h3 className="mb-2 text-sm font-medium text-gray-900">Permission Scopes</h3>
            <div className="flex flex-wrap gap-2">
              {identity.permissionScopes.map((scope) => (
                <span
                  key={scope}
                  className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700"
                >
                  {scope}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Tags */}
        {identity.tags && identity.tags.length > 0 && (
          <div className="border-t border-gray-200 pt-4">
            <h3 className="mb-2 text-sm font-medium text-gray-900">Tags</h3>
            <div className="flex flex-wrap gap-2">
              {identity.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {updateMutation.isSuccess && (
          <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
            Identity updated successfully.
          </div>
        )}

        {updateMutation.isError && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            Failed to update identity.
          </div>
        )}

        <div className="flex justify-end border-t border-gray-200 pt-4">
          <button
            type="submit"
            disabled={updateMutation.isPending || isDecommissioned}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>

      {/* Certificate info */}
      {identity.certificateFingerprint && (
        <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Certificate</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-gray-500">Fingerprint</dt>
              <dd className="mt-0.5 font-mono text-gray-900 break-all">
                {identity.certificateFingerprint}
              </dd>
            </div>
            {identity.certificateSubject && (
              <div>
                <dt className="text-gray-500">Subject</dt>
                <dd className="mt-0.5 font-mono text-gray-900">{identity.certificateSubject}</dd>
              </div>
            )}
            {identity.certificateNotBefore && (
              <div>
                <dt className="text-gray-500">Valid From</dt>
                <dd className="mt-0.5 text-gray-900">
                  {new Date(identity.certificateNotBefore).toLocaleString()}
                </dd>
              </div>
            )}
            {identity.certificateNotAfter && (
              <div>
                <dt className="text-gray-500">Valid Until</dt>
                <dd className="mt-0.5 text-gray-900">
                  {new Date(identity.certificateNotAfter).toLocaleString()}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {/* Credentials section */}
      <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Credentials</h2>
          {!isDecommissioned && (
            <button
              onClick={() => setShowCreateCredential(true)}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Create Credential
            </button>
          )}
        </div>

        {credentials && credentials.length > 0 ? (
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200" aria-label="Credentials">
              <thead className="bg-gray-50">
                <tr>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                  >
                    Name
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                  >
                    Type
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                  >
                    Key Prefix
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                  >
                    Expires
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                  >
                    Status
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                  >
                    Rotation
                  </th>
                  <th scope="col" className="relative px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {credentials.map((cred) => (
                  <tr key={cred.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                      {cred.name}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          credentialTypeColors[cred.credentialType]
                        }`}
                      >
                        {cred.credentialType.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-mono text-gray-500">
                      {cred.keyPrefix ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                      {cred.expiresAt
                        ? new Date(cred.expiresAt).toLocaleDateString()
                        : 'Never'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      {cred.revoked ? (
                        <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                          Revoked
                        </span>
                      ) : cred.enabled ? (
                        <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                          Disabled
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      {cred.rotationRequired ? (
                        <span className="text-amber-600">Required</span>
                      ) : (
                        <span className="text-gray-400">Optional</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm">
                      {!cred.revoked && !isDecommissioned && (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => rotateCredentialMutation.mutate(cred.id)}
                            disabled={rotateCredentialMutation.isPending}
                            className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          >
                            Rotate
                          </button>
                          <button
                            onClick={() => setSelectedCredentialId(cred.id)}
                            className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                          >
                            Revoke
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-4 text-center text-sm text-gray-500">No credentials created yet.</p>
        )}
      </div>

      {/* Metadata */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Metadata</h2>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-gray-500">ID</dt>
            <dd className="mt-0.5 font-mono text-gray-900 break-all">{identity.id}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Realm ID</dt>
            <dd className="mt-0.5 font-mono text-gray-900 break-all">{identity.realmId}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Created</dt>
            <dd className="mt-0.5 text-gray-900">{new Date(identity.createdAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Last Updated</dt>
            <dd className="mt-0.5 text-gray-900">{new Date(identity.updatedAt).toLocaleString()}</dd>
          </div>
          {identity.suspendedAt && (
            <div>
              <dt className="text-gray-500">Suspended At</dt>
              <dd className="mt-0.5 text-gray-900">{new Date(identity.suspendedAt).toLocaleString()}</dd>
            </div>
          )}
          {identity.decommissionedAt && (
            <div>
              <dt className="text-gray-500">Decommissioned At</dt>
              <dd className="mt-0.5 text-gray-900">{new Date(identity.decommissionedAt).toLocaleString()}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* New credential result banner */}
      {newCredentialResult && (
        <div className="rounded-md border border-green-200 bg-green-50 p-4">
          <p className="mb-2 text-sm font-medium text-green-800">
            New credential created. Save the key now — it will not be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md border border-green-300 bg-white px-3 py-2 text-sm font-mono text-gray-900">
              {newCredentialResult.key}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(newCredentialResult.key)}
              className="rounded-md border border-green-300 bg-white px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-50"
            >
              Copy
            </button>
            <button
              onClick={() => setNewCredentialResult(null)}
              className="rounded-md border border-green-300 bg-white px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-50"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Create credential dialog */}
      {showCreateCredential && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowCreateCredential(false)} />
          <div className="relative z-10 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Create Credential</h3>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createCredentialMutation.mutate();
              }}
              className="mt-4 space-y-4"
            >
              <div>
                <label
                  htmlFor="field-cred-type"
                  className="mb-1.5 block text-sm font-medium text-gray-700"
                >
                  Credential Type
                </label>
                <select
                  id="field-cred-type"
                  value={credForm.credentialType}
                  onChange={(e) =>
                    setCredForm({ ...credForm, credentialType: e.target.value as NhiCredentialType })
                  }
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                >
                  <option value="API_KEY">API Key</option>
                  <option value="CERTIFICATE">Certificate</option>
                  <option value="JWT_BEARER">JWT Bearer</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="field-cred-name"
                  className="mb-1.5 block text-sm font-medium text-gray-700"
                >
                  Name
                </label>
                <input
                  id="field-cred-name"
                  type="text"
                  value={credForm.name}
                  onChange={(e) => setCredForm({ ...credForm, name: e.target.value })}
                  required
                  placeholder="e.g., production key"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="field-cred-expires"
                  className="mb-1.5 block text-sm font-medium text-gray-700"
                >
                  Expires At (optional)
                </label>
                <input
                  id="field-cred-expires"
                  type="date"
                  value={credForm.expiresAt}
                  onChange={(e) => setCredForm({ ...credForm, expiresAt: e.target.value })}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="field-cred-rotation"
                  checked={credForm.rotationRequired}
                  onChange={(e) => setCredForm({ ...credForm, rotationRequired: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="field-cred-rotation" className="text-sm font-medium text-gray-700">
                  Require periodic rotation
                </label>
              </div>

              {createCredentialMutation.isError && (
                <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
                  Failed to create credential.
                </div>
              )}

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateCredential(false)}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createCredentialMutation.isPending}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {createCredentialMutation.isPending ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Revoke confirmation */}
      <ConfirmDialog
        isOpen={!!selectedCredentialId}
        title="Revoke Credential"
        message="Are you sure you want to revoke this credential? This action cannot be undone."
        onConfirm={() => selectedCredentialId && revokeCredentialMutation.mutate(selectedCredentialId)}
        onCancel={() => setSelectedCredentialId(null)}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={showDelete}
        title="Delete Identity"
        message={`Are you sure you want to delete identity "${identity.name}"? This action is irreversible.`}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setShowDelete(false)}
      />
    </div>
  );
}