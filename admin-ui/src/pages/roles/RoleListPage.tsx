import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRealmRoles, createRealmRole, deleteRealmRole } from '../../api/roles';
import ConfirmDialog from '../../components/ConfirmDialog';
import { getErrorMessage } from '../../utils/getErrorMessage';

export default function RoleListPage() {
  const { name } = useParams<{ name: string }>();
  const queryClient = useQueryClient();

  const [showCreate, setShowCreate] = useState(false);
  const [newRole, setNewRole] = useState({ name: '', description: '' });
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const { data: roles, isLoading, error } = useQuery({
    queryKey: ['roles', name],
    queryFn: () => getRealmRoles(name!),
    enabled: !!name,
  });

  const createMutation = useMutation({
    mutationFn: () => createRealmRole(name!, newRole),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles', name] });
      setNewRole({ name: '', description: '' });
      setShowCreate(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (roleName: string) => deleteRealmRole(name!, roleName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles', name] });
      setDeleteTarget(null);
    },
  });

  function handleCreateSubmit(e: FormEvent) {
    e.preventDefault();
    createMutation.mutate();
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-subtle">Loading roles...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-danger-soft p-4 text-sm text-danger-fg">
        {getErrorMessage(error, 'Failed to load roles.')}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-fg">Roles</h1>
          <p className="mt-1 text-sm text-subtle">
            Manage realm roles for <span className="font-medium">{name}</span>
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Create Role
        </button>
      </div>

      {/* Create role inline form */}
      {showCreate && (
        <form
          onSubmit={handleCreateSubmit}
          className="mb-6 space-y-4 rounded-lg border border-line bg-surface p-6 shadow-sm"
        >
          <h2 className="text-lg font-semibold text-fg">New Role</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="new-role-name" className="mb-1.5 block text-sm font-medium text-muted">
                Role Name
              </label>
              <input
                id="new-role-name"
                type="text"
                required
                value={newRole.name}
                onChange={(e) => setNewRole({ ...newRole, name: e.target.value })}
                placeholder="e.g. admin"
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="new-role-description" className="mb-1.5 block text-sm font-medium text-muted">
                Description
              </label>
              <input
                id="new-role-description"
                type="text"
                value={newRole.description}
                onChange={(e) => setNewRole({ ...newRole, description: e.target.value })}
                placeholder="Optional description"
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              />
            </div>
          </div>

          {createMutation.isError && (
            <div className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
              {getErrorMessage(createMutation.error, 'Failed to create role.')}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setShowCreate(false);
                setNewRole({ name: '', description: '' });
              }}
              className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-muted hover:bg-hover"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      )}

      {/* Role table */}
      <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
        <table aria-label="Roles list" className="min-w-full divide-y divide-line">
          <thead className="bg-sunken">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Description
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Created
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-subtle">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {roles && roles.length > 0 ? (
              roles.map((role) => (
                <tr key={role.id} className="hover:bg-hover">
                  <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-fg">
                    {role.name}
                  </td>
                  <td className="px-6 py-4 text-sm text-muted">
                    {role.description || '-'}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-subtle">
                    {new Date(role.createdAt).toLocaleDateString()}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right">
                    <button
                      onClick={() => setDeleteTarget(role.name)}
                      className="text-sm font-medium text-danger hover:text-danger-fg"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-sm text-subtle">
                  No roles found in this realm.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {deleteMutation.isError && (
          <div className="mb-4 rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
            {getErrorMessage(deleteMutation.error, 'Failed to delete role.')}
          </div>
        )}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="Delete Role"
        message={`Are you sure you want to delete the role "${deleteTarget}"? Users with this role will lose it.`}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
