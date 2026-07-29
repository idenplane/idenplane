import { useState, type FormEvent } from 'react';
import { useParams, Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../../api/client';
import ConfirmDialog from '../../components/ConfirmDialog';
import { getErrorMessage } from '../../utils/getErrorMessage';

// ─── Types ───────────────────────────────────────────────────────────────────

interface RiskPolicy {
  id: string;
  realmId: string;
  clientId: string | null;
  name: string;
  description: string | null;
  enabled: boolean;
  priority: number;
  conditions: Record<string, unknown>;
  action: 'NO_ACTION' | 'STEP_UP' | 'TERMINATE' | 'NOTIFY';
  actionData: Record<string, unknown> | null;
  riskScoreContribution: number;
  cooldownSeconds: number;
  createdAt: string;
  updatedAt: string;
}

interface CreatePolicyDto {
  name: string;
  description?: string;
  clientId?: string;
  enabled?: boolean;
  priority?: number;
  conditions: Record<string, unknown>;
  action?: 'NO_ACTION' | 'STEP_UP' | 'TERMINATE' | 'NOTIFY';
  actionData?: Record<string, unknown>;
  riskScoreContribution?: number;
  cooldownSeconds?: number;
}

interface UpdatePolicyDto {
  name?: string;
  description?: string;
  clientId?: string | null;
  enabled?: boolean;
  priority?: number;
  conditions?: Record<string, unknown>;
  action?: 'NO_ACTION' | 'STEP_UP' | 'TERMINATE' | 'NOTIFY';
  actionData?: Record<string, unknown> | null;
  riskScoreContribution?: number;
  cooldownSeconds?: number;
}

// ─── API functions ────────────────────────────────────────────────────────────

async function getRiskPolicies(realmName: string): Promise<RiskPolicy[]> {
  const { data } = await apiClient.get<RiskPolicy[]>(
    `/realms/${realmName}/risk-policies`,
  );
  return data;
}

async function createRiskPolicy(
  realmName: string,
  dto: CreatePolicyDto,
): Promise<RiskPolicy> {
  const { data } = await apiClient.post<RiskPolicy>(
    `/realms/${realmName}/risk-policies`,
    dto,
  );
  return data;
}

async function updateRiskPolicy(
  realmName: string,
  id: string,
  dto: UpdatePolicyDto,
): Promise<RiskPolicy> {
  const { data } = await apiClient.put<RiskPolicy>(
    `/realms/${realmName}/risk-policies/${id}`,
    dto,
  );
  return data;
}

async function deleteRiskPolicy(
  realmName: string,
  id: string,
): Promise<void> {
  await apiClient.delete(`/realms/${realmName}/risk-policies/${id}`);
}

async function toggleRiskPolicy(
  realmName: string,
  id: string,
  enabled: boolean,
): Promise<RiskPolicy> {
  const { data } = await apiClient.patch<RiskPolicy>(
    `/realms/${realmName}/risk-policies/${id}/toggle`,
    { enabled },
  );
  return data;
}

// ─── Action Badge ─────────────────────────────────────────────────────────────

function ActionBadge({ action }: { action: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    NO_ACTION: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'No Action' },
    STEP_UP: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Step-up' },
    TERMINATE: { bg: 'bg-red-100', text: 'text-red-700', label: 'Terminate' },
    NOTIFY: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Notify' },
  };
  const c = config[action] ?? { bg: 'bg-gray-100', text: 'text-gray-600', label: action };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function RiskPolicyListPage() {
  const { name: realmName } = useParams<{ name: string }>();
  const queryClient = useQueryClient();

  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RiskPolicy | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Create form state
  const [newPolicy, setNewPolicy] = useState<CreatePolicyDto>({
    name: '',
    description: '',
    conditions: {},
    action: 'NO_ACTION',
    riskScoreContribution: 0,
    cooldownSeconds: 300,
    enabled: true,
  });

  // Edit form state
  const [editPolicy, setEditPolicy] = useState<UpdatePolicyDto>({});

  const { data: policies, isLoading, error } = useQuery<RiskPolicy[]>({
    queryKey: ['riskPolicies', realmName],
    queryFn: () => getRiskPolicies(realmName!),
    enabled: !!realmName,
  });

  const createMutation = useMutation({
    mutationFn: () => createRiskPolicy(realmName!, newPolicy),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['riskPolicies', realmName] });
      setNewPolicy({
        name: '',
        description: '',
        conditions: {},
        action: 'NO_ACTION',
        riskScoreContribution: 0,
        cooldownSeconds: 300,
        enabled: true,
      });
      setShowCreate(false);
      setFormError(null);
    },
    onError: (err) => {
      setFormError(getErrorMessage(err, 'Failed to create policy.'));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdatePolicyDto }) =>
      updateRiskPolicy(realmName!, id, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['riskPolicies', realmName] });
      setEditingId(null);
      setEditPolicy({});
      setFormError(null);
    },
    onError: (err) => {
      setFormError(getErrorMessage(err, 'Failed to update policy.'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteRiskPolicy(realmName!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['riskPolicies', realmName] });
      setDeleteTarget(null);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      toggleRiskPolicy(realmName!, id, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['riskPolicies', realmName] });
    },
  });

  function handleCreateSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    createMutation.mutate();
  }

  function handleEditSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setFormError(null);
    updateMutation.mutate({ id: editingId, dto: editPolicy });
  }

  function startEditing(policy: RiskPolicy) {
    setEditingId(policy.id);
    setEditPolicy({
      name: policy.name,
      description: policy.description ?? '',
      enabled: policy.enabled,
      priority: policy.priority,
      action: policy.action as 'NO_ACTION' | 'STEP_UP' | 'TERMINATE' | 'NOTIFY',
      riskScoreContribution: policy.riskScoreContribution,
      cooldownSeconds: policy.cooldownSeconds,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditPolicy({});
    setFormError(null);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading risk policies...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
        Failed to load risk policies.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Risk Policies</h1>
          <p className="mt-1 text-sm text-gray-500">
            Configure continuous session verification policies for{' '}
            <span className="font-medium">{realmName}</span>
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            to={`/console/realms/${realmName}/risk-dashboard`}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Dashboard
          </Link>
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Create Policy
          </button>
        </div>
      </div>

      {/* Create policy inline form */}
      {showCreate && (
        <form
          onSubmit={handleCreateSubmit}
          className="mb-6 space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
        >
          <h2 className="text-lg font-semibold text-gray-900">New Risk Policy</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="policy-name" className="mb-1.5 block text-sm font-medium text-gray-700">
                Policy Name <span className="text-red-500">*</span>
              </label>
              <input
                id="policy-name"
                type="text"
                required
                value={newPolicy.name}
                onChange={(e) => setNewPolicy({ ...newPolicy, name: e.target.value })}
                placeholder="e.g. Unencrypted Device Block"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="policy-action" className="mb-1.5 block text-sm font-medium text-gray-700">
                Action
              </label>
              <select
                id="policy-action"
                value={newPolicy.action}
                onChange={(e) => setNewPolicy({ ...newPolicy, action: e.target.value as CreatePolicyDto['action'] })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              >
                <option value="NO_ACTION">No Action</option>
                <option value="NOTIFY">Notify</option>
                <option value="STEP_UP">Step-up</option>
                <option value="TERMINATE">Terminate</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="policy-description" className="mb-1.5 block text-sm font-medium text-gray-700">
                Description
              </label>
              <input
                id="policy-description"
                type="text"
                value={newPolicy.description ?? ''}
                onChange={(e) => setNewPolicy({ ...newPolicy, description: e.target.value })}
                placeholder="Optional description"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="policy-client" className="mb-1.5 block text-sm font-medium text-gray-700">
                Client ID (optional)
              </label>
              <input
                id="policy-client"
                type="text"
                value={newPolicy.clientId ?? ''}
                onChange={(e) => setNewPolicy({ ...newPolicy, clientId: e.target.value || undefined })}
                placeholder="Leave empty for realm-wide"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label htmlFor="policy-priority" className="mb-1.5 block text-sm font-medium text-gray-700">
                Priority
              </label>
              <input
                id="policy-priority"
                type="number"
                value={newPolicy.priority ?? 0}
                onChange={(e) => setNewPolicy({ ...newPolicy, priority: parseInt(e.target.value, 10) || 0 })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="policy-risk-contribution" className="mb-1.5 block text-sm font-medium text-gray-700">
                Risk Score Contribution
              </label>
              <input
                id="policy-risk-contribution"
                type="number"
                value={newPolicy.riskScoreContribution ?? 0}
                onChange={(e) => setNewPolicy({ ...newPolicy, riskScoreContribution: parseFloat(e.target.value) || 0 })}
                min="0"
                max="100"
                step="0.1"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="policy-cooldown" className="mb-1.5 block text-sm font-medium text-gray-700">
                Cooldown (seconds)
              </label>
              <input
                id="policy-cooldown"
                type="number"
                value={newPolicy.cooldownSeconds ?? 300}
                onChange={(e) => setNewPolicy({ ...newPolicy, cooldownSeconds: parseInt(e.target.value, 10) || 300 })}
                min="0"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          {formError && showCreate && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              {formError}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setShowCreate(false);
                setFormError(null);
              }}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      )}

      {/* Policy table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Name
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Action
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Priority
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Risk Score
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Cooldown
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Enabled
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Updated
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {policies && policies.length > 0 ? (
              policies.map((policy) => (
                <tr key={policy.id} className="hover:bg-gray-50">
                  <td className="px-4 py-4">
                    <div className="text-sm font-medium text-gray-900">{policy.name}</div>
                    {policy.description && (
                      <div className="text-xs text-gray-500">{policy.description}</div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4">
                    <ActionBadge action={policy.action} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-700">
                    {policy.priority}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-700">
                    {policy.riskScoreContribution}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-700">
                    {policy.cooldownSeconds}s
                  </td>
                  <td className="whitespace-nowrap px-4 py-4">
                    <button
                      onClick={() => toggleMutation.mutate({ id: policy.id, enabled: !policy.enabled })}
                      disabled={toggleMutation.isPending}
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        policy.enabled
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {policy.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-500">
                    {new Date(policy.updatedAt).toLocaleDateString()}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 text-right">
                    <div className="flex justify-end gap-3">
                      <button
                        onClick={() => startEditing(policy)}
                        className="text-sm font-medium text-indigo-600 hover:text-indigo-900"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteTarget(policy)}
                        className="text-sm font-medium text-red-600 hover:text-red-800"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="px-6 py-8 text-center text-sm text-gray-500">
                  No risk policies found in this realm.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Edit policy modal */}
      {editingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">Edit Risk Policy</h2>
            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="edit-name" className="mb-1.5 block text-sm font-medium text-gray-700">
                    Policy Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="edit-name"
                    type="text"
                    required
                    value={editPolicy.name ?? ''}
                    onChange={(e) => setEditPolicy({ ...editPolicy, name: e.target.value })}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="edit-action" className="mb-1.5 block text-sm font-medium text-gray-700">
                    Action
                  </label>
                  <select
                    id="edit-action"
                    value={editPolicy.action ?? 'NO_ACTION'}
                    onChange={(e) => setEditPolicy({ ...editPolicy, action: e.target.value as UpdatePolicyDto['action'] })}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  >
                    <option value="NO_ACTION">No Action</option>
                    <option value="NOTIFY">Notify</option>
                    <option value="STEP_UP">Step-up</option>
                    <option value="TERMINATE">Terminate</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="edit-description" className="mb-1.5 block text-sm font-medium text-gray-700">
                  Description
                </label>
                <input
                  id="edit-description"
                  type="text"
                  value={editPolicy.description ?? ''}
                  onChange={(e) => setEditPolicy({ ...editPolicy, description: e.target.value })}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label htmlFor="edit-priority" className="mb-1.5 block text-sm font-medium text-gray-700">
                    Priority
                  </label>
                  <input
                    id="edit-priority"
                    type="number"
                    value={editPolicy.priority ?? 0}
                    onChange={(e) => setEditPolicy({ ...editPolicy, priority: parseInt(e.target.value, 10) || 0 })}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="edit-risk" className="mb-1.5 block text-sm font-medium text-gray-700">
                    Risk Score
                  </label>
                  <input
                    id="edit-risk"
                    type="number"
                    value={editPolicy.riskScoreContribution ?? 0}
                    onChange={(e) => setEditPolicy({ ...editPolicy, riskScoreContribution: parseFloat(e.target.value) || 0 })}
                    min="0"
                    max="100"
                    step="0.1"
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="edit-cooldown" className="mb-1.5 block text-sm font-medium text-gray-700">
                    Cooldown (s)
                  </label>
                  <input
                    id="edit-cooldown"
                    type="number"
                    value={editPolicy.cooldownSeconds ?? 300}
                    onChange={(e) => setEditPolicy({ ...editPolicy, cooldownSeconds: parseInt(e.target.value, 10) || 300 })}
                    min="0"
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              {formError && editingId && (
                <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
                  {formError}
                </div>
              )}

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updateMutation.isPending}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="Delete Risk Policy"
        message={
          deleteTarget
            ? `Are you sure you want to delete the policy "${deleteTarget.name}"? This action cannot be undone.`
            : ''
        }
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}