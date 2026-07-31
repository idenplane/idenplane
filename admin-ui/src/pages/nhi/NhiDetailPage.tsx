import { useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router';
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
  IOT_DEVICE: 'bg-info-soft text-info-fg',
  AI_AGENT: 'bg-purple-100 text-purple-700',
  BOT: 'bg-warning-soft text-warning-fg',
  MACHINE_TO_MACHINE: 'bg-success-soft text-success-fg',
};

const statusColors: Record<NhiLifecycleStatus, string> = {
  PROVISIONING: 'bg-warning-soft text-warning-fg',
  ACTIVE: 'bg-success-soft text-success-fg',
  SUSPENDED: 'bg-warning-soft text-warning-fg',
  DECOMMISSIONED: 'bg-sunken text-muted',
};

const credentialTypeColors: Record<NhiCredentialType, string> = {
  API_KEY: 'bg-accent-soft text-accent',
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
        <div className="text-subtle">Loading identity...</div>
      </div>
    );
  }

  if (!identity) {
    return (
      <div className="rounded-md bg-danger-soft p-4 text-sm text-danger-fg">
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
            <h1 className="text-2xl font-bold text-fg">{identity.name}</h1>
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
          <p className="mt-1 text-sm text-subtle">
            {identity.description || 'No description'}
            {identity.certificateFingerprint && (
              <span className="ml-2 text-success">· Certificate active</span>
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
                  className="rounded-md border border-warning-soft px-4 py-2 text-sm font-medium text-warning-fg hover:bg-warning-soft disabled:opacity-50"
                >
                  {suspendMutation.isPending ? 'Suspending...' : 'Suspend'}
                </button>
              )}
              {isSuspended && (
                <button
                  onClick={() => reactivateMutation.mutate()}
                  disabled={reactivateMutation.isPending}
                  className="rounded-md border border-success-soft px-4 py-2 text-sm font-medium text-success-fg hover:bg-success-soft disabled:opacity-50"
                >
                  {reactivateMutation.isPending ? 'Reactivating...' : 'Reactivate'}
                </button>
              )}
              <button
                onClick={() => decommissionMutation.mutate()}
                disabled={decommissionMutation.isPending}
                className="rounded-md border border-danger-soft px-4 py-2 text-sm font-medium text-danger-fg hover:bg-danger-soft disabled:opacity-50"
              >
                {decommissionMutation.isPending ? 'Decommissioning...' : 'Decommission'}
              </button>
            </>
          )}
          {!isDecommissioned && (
            <button
              onClick={() => setShowDelete(true)}
              className="rounded-md border border-danger-soft px-4 py-2 text-sm font-medium text-danger-fg hover:bg-danger-soft"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Settings form */}
      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-lg border border-line bg-surface p-6 shadow-sm"
      >
        <h2 className="text-lg font-semibold text-fg">Settings</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="field-nhi-name"
              className="mb-1.5 block text-sm font-medium text-muted"
            >
              Name
            </label>
            <input
              id="field-nhi-name"
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              disabled={isDecommissioned}
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none disabled:cursor-not-allowed disabled:bg-sunken disabled:text-subtle"
            />
          </div>
          <div>
            <label
              htmlFor="field-nhi-agentPurpose"
              className="mb-1.5 block text-sm font-medium text-muted"
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
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none disabled:cursor-not-allowed disabled:bg-sunken disabled:text-subtle"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="field-nhi-description"
            className="mb-1.5 block text-sm font-medium text-muted"
          >
            Description
          </label>
          <textarea
            id="field-nhi-description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            disabled={isDecommissioned}
            rows={2}
            className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none disabled:cursor-not-allowed disabled:bg-sunken disabled:text-subtle"
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
              className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent disabled:cursor-not-allowed"
            />
            <label
              htmlFor="nhi-enabled"
              className="text-sm font-medium text-muted"
            >
              Enabled
            </label>
          </div>
        </div>

        {/* Permission Scopes */}
        {identity.permissionScopes && identity.permissionScopes.length > 0 && (
          <div className="border-t border-line pt-4">
            <h3 className="mb-2 text-sm font-medium text-fg">Permission Scopes</h3>
            <div className="flex flex-wrap gap-2">
              {identity.permissionScopes.map((scope) => (
                <span
                  key={scope}
                  className="inline-flex items-center rounded-full bg-sunken px-3 py-1 text-sm font-medium text-muted"
                >
                  {scope}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Tags */}
        {identity.tags && identity.tags.length > 0 && (
          <div className="border-t border-line pt-4">
            <h3 className="mb-2 text-sm font-medium text-fg">Tags</h3>
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
          <div className="rounded-md bg-success-soft p-3 text-sm text-success-fg">
            Identity updated successfully.
          </div>
        )}

        {updateMutation.isError && (
          <div className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
            Failed to update identity.
          </div>
        )}

        <div className="flex justify-end border-t border-line pt-4">
          <button
            type="submit"
            disabled={updateMutation.isPending || isDecommissioned}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>

      {/* Certificate info */}
      {identity.certificateFingerprint && (
        <div className="space-y-4 rounded-lg border border-line bg-surface p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-fg">Certificate</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-subtle">Fingerprint</dt>
              <dd className="mt-0.5 font-mono text-fg break-all">
                {identity.certificateFingerprint}
              </dd>
            </div>
            {identity.certificateSubject && (
              <div>
                <dt className="text-subtle">Subject</dt>
                <dd className="mt-0.5 font-mono text-fg">{identity.certificateSubject}</dd>
              </div>
            )}
            {identity.certificateNotBefore && (
              <div>
                <dt className="text-subtle">Valid From</dt>
                <dd className="mt-0.5 text-fg">
                  {new Date(identity.certificateNotBefore).toLocaleString()}
                </dd>
              </div>
            )}
            {identity.certificateNotAfter && (
              <div>
                <dt className="text-subtle">Valid Until</dt>
                <dd className="mt-0.5 text-fg">
                  {new Date(identity.certificateNotAfter).toLocaleString()}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {/* Credentials section */}
      <div className="space-y-4 rounded-lg border border-line bg-surface p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-fg">Credentials</h2>
          {!isDecommissioned && (
            <button
              onClick={() => setShowCreateCredential(true)}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
            >
              Create Credential
            </button>
          )}
        </div>

        {credentials && credentials.length > 0 ? (
          <div className="overflow-hidden rounded-lg border border-line">
            <table className="min-w-full divide-y divide-line" aria-label="Credentials">
              <thead className="bg-sunken">
                <tr>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle"
                  >
                    Name
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle"
                  >
                    Type
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle"
                  >
                    Key Prefix
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle"
                  >
                    Expires
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle"
                  >
                    Status
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle"
                  >
                    Rotation
                  </th>
                  <th scope="col" className="relative px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-surface">
                {credentials.map((cred) => (
                  <tr key={cred.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-fg">
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
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-mono text-subtle">
                      {cred.keyPrefix ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-subtle">
                      {cred.expiresAt
                        ? new Date(cred.expiresAt).toLocaleDateString()
                        : 'Never'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      {cred.revoked ? (
                        <span className="inline-flex rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger-fg">
                          Revoked
                        </span>
                      ) : cred.enabled ? (
                        <span className="inline-flex rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success-fg">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-muted">
                          Disabled
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      {cred.rotationRequired ? (
                        <span className="text-warning">Required</span>
                      ) : (
                        <span className="text-subtle">Optional</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm">
                      {!cred.revoked && !isDecommissioned && (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => rotateCredentialMutation.mutate(cred.id)}
                            disabled={rotateCredentialMutation.isPending}
                            className="rounded-md border border-line-strong px-2 py-1 text-xs font-medium text-muted hover:bg-hover disabled:opacity-50"
                          >
                            Rotate
                          </button>
                          <button
                            onClick={() => setSelectedCredentialId(cred.id)}
                            className="rounded-md border border-danger-soft px-2 py-1 text-xs font-medium text-danger-fg hover:bg-danger-soft"
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
          <p className="py-4 text-center text-sm text-subtle">No credentials created yet.</p>
        )}
      </div>

      {/* Metadata */}
      <div className="rounded-lg border border-line bg-surface p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-fg">Metadata</h2>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-subtle">ID</dt>
            <dd className="mt-0.5 font-mono text-fg break-all">{identity.id}</dd>
          </div>
          <div>
            <dt className="text-subtle">Realm ID</dt>
            <dd className="mt-0.5 font-mono text-fg break-all">{identity.realmId}</dd>
          </div>
          <div>
            <dt className="text-subtle">Created</dt>
            <dd className="mt-0.5 text-fg">{new Date(identity.createdAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-subtle">Last Updated</dt>
            <dd className="mt-0.5 text-fg">{new Date(identity.updatedAt).toLocaleString()}</dd>
          </div>
          {identity.suspendedAt && (
            <div>
              <dt className="text-subtle">Suspended At</dt>
              <dd className="mt-0.5 text-fg">{new Date(identity.suspendedAt).toLocaleString()}</dd>
            </div>
          )}
          {identity.decommissionedAt && (
            <div>
              <dt className="text-subtle">Decommissioned At</dt>
              <dd className="mt-0.5 text-fg">{new Date(identity.decommissionedAt).toLocaleString()}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* New credential result banner */}
      {newCredentialResult && (
        <div className="rounded-md border border-success-soft bg-success-soft p-4">
          <p className="mb-2 text-sm font-medium text-success-fg">
            New credential created. Save the key now — it will not be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md border border-success-soft bg-surface px-3 py-2 text-sm font-mono text-fg">
              {newCredentialResult.key}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(newCredentialResult.key)}
              className="rounded-md border border-success-soft bg-surface px-3 py-2 text-sm font-medium text-success-fg hover:bg-success-soft"
            >
              Copy
            </button>
            <button
              onClick={() => setNewCredentialResult(null)}
              className="rounded-md border border-success-soft bg-surface px-3 py-2 text-sm font-medium text-success-fg hover:bg-success-soft"
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
          <div className="relative z-10 w-full max-w-md rounded-lg bg-surface p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-fg">Create Credential</h3>
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
                  className="mb-1.5 block text-sm font-medium text-muted"
                >
                  Credential Type
                </label>
                <select
                  id="field-cred-type"
                  value={credForm.credentialType}
                  onChange={(e) =>
                    setCredForm({ ...credForm, credentialType: e.target.value as NhiCredentialType })
                  }
                  className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                >
                  <option value="API_KEY">API Key</option>
                  <option value="CERTIFICATE">Certificate</option>
                  <option value="JWT_BEARER">JWT Bearer</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="field-cred-name"
                  className="mb-1.5 block text-sm font-medium text-muted"
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
                  className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="field-cred-expires"
                  className="mb-1.5 block text-sm font-medium text-muted"
                >
                  Expires At (optional)
                </label>
                <input
                  id="field-cred-expires"
                  type="date"
                  value={credForm.expiresAt}
                  onChange={(e) => setCredForm({ ...credForm, expiresAt: e.target.value })}
                  className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="field-cred-rotation"
                  checked={credForm.rotationRequired}
                  onChange={(e) => setCredForm({ ...credForm, rotationRequired: e.target.checked })}
                  className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
                />
                <label htmlFor="field-cred-rotation" className="text-sm font-medium text-muted">
                  Require periodic rotation
                </label>
              </div>

              {createCredentialMutation.isError && (
                <div className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
                  Failed to create credential.
                </div>
              )}

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateCredential(false)}
                  className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-muted hover:bg-hover"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createCredentialMutation.isPending}
                  className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
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