import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router';
import { getAuthFlows, createAuthFlow, deleteAuthFlow, type AuthFlow } from '../../api/authFlows';
import { getErrorMessage } from '../../utils/getErrorMessage';
import ConfirmDialog from '../../components/ConfirmDialog';

export default function AuthFlowListPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [deleteTarget, setDeleteTarget] = useState<AuthFlow | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newFlowName, setNewFlowName] = useState('');

  const { data: flows, isLoading, error } = useQuery({
    queryKey: ['auth-flows', name],
    queryFn: () => getAuthFlows(name!),
    enabled: !!name,
  });

  const createMutation = useMutation({
    mutationFn: (flowName: string) =>
      createAuthFlow(name!, {
        name: flowName,
        description: '',
        isDefault: false,
        steps: [],
      }),
    onSuccess: (flow) => {
      qc.invalidateQueries({ queryKey: ['auth-flows', name] });
      navigate(`/console/realms/${name}/auth-flows/${flow.id}`);
    },
    onError: (err) => setCreateError(getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAuthFlow(name!, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auth-flows', name] });
      setDeleteTarget(null);
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: (flow: AuthFlow) =>
      createAuthFlow(name!, {
        name: `${flow.name} (copy)`,
        description: flow.description ?? '',
        isDefault: false,
        steps: flow.steps,
      }),
    onSuccess: (flow) => {
      qc.invalidateQueries({ queryKey: ['auth-flows', name] });
      navigate(`/console/realms/${name}/auth-flows/${flow.id}`);
    },
  });

  function handleCreate() {
    setNewFlowName('');
    setCreateError(null);
    setShowCreateModal(true);
  }

  function handleCreateConfirm() {
    if (!newFlowName.trim()) return;
    setCreateError(null);
    createMutation.mutate(newFlowName.trim(), {
      onSuccess: () => setShowCreateModal(false),
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-subtle">Loading authentication flows...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-danger-soft p-4 text-sm text-danger-fg">
        Failed to load authentication flows.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-fg">Authentication Flows</h1>
          <p className="mt-1 text-sm text-subtle">
            Design and manage authentication flows for{' '}
            <span className="font-medium">{name}</span>
          </p>
        </div>
        <button
          onClick={handleCreate}
          disabled={createMutation.isPending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
        >
          {createMutation.isPending ? 'Creating...' : 'Create Flow'}
        </button>
      </div>

      {createError && (
        <div className="mb-4 rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
          {createError}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
        <table className="min-w-full divide-y divide-line">
          <thead className="bg-sunken">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Description
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Steps
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Default
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Last Modified
              </th>
              <th className="px-6 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {flows && flows.length > 0 ? (
              flows.map((flow) => (
                <tr
                  key={flow.id}
                  className="hover:bg-hover"
                >
                  <td className="whitespace-nowrap px-6 py-4">
                    <button
                      onClick={() => navigate(`/console/realms/${name}/auth-flows/${flow.id}`)}
                      className="text-sm font-medium text-accent hover:text-accent"
                    >
                      {flow.name}
                    </button>
                  </td>
                  <td className="px-6 py-4 text-sm text-subtle max-w-xs truncate">
                    {flow.description || '-'}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-muted">
                    {flow.steps.length}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    {flow.isDefault && (
                      <span className="inline-flex rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success-fg">
                        Default
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-subtle">
                    {new Date(flow.updatedAt).toLocaleDateString()}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right text-sm">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => navigate(`/console/realms/${name}/auth-flows/${flow.id}`)}
                        className="rounded px-2 py-1 text-xs font-medium text-accent hover:bg-accent-soft"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => duplicateMutation.mutate(flow)}
                        disabled={duplicateMutation.isPending}
                        className="rounded px-2 py-1 text-xs font-medium text-muted hover:bg-hover"
                      >
                        Duplicate
                      </button>
                      <button
                        onClick={() => setDeleteTarget(flow)}
                        className="rounded px-2 py-1 text-xs font-medium text-danger hover:bg-danger-soft"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-sm text-subtle">
                  No authentication flows found. Create one to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="Delete Authentication Flow"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setShowCreateModal(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-flow-dialog-title"
            className="relative z-10 w-full max-w-md rounded-lg bg-surface p-6 shadow-xl"
          >
            <h3 id="create-flow-dialog-title" className="text-lg font-semibold text-fg">
              Create Authentication Flow
            </h3>
            <div className="mt-4">
              <label htmlFor="new-flow-name" className="mb-1.5 block text-sm font-medium text-muted">
                Flow Name
              </label>
              <input
                id="new-flow-name"
                type="text"
                value={newFlowName}
                onChange={(e) => setNewFlowName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateConfirm()}
                autoFocus
                placeholder="e.g. browser-flow"
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              />
            </div>
            {createError && (
              <p className="mt-2 text-sm text-danger">{createError}</p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-muted hover:bg-hover"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateConfirm}
                disabled={!newFlowName.trim() || createMutation.isPending}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
              >
                {createMutation.isPending ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
