import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
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
        <div className="text-gray-500">Loading roles...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
        {getErrorMessage(error, 'Failed to load roles.')}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Roles</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage realm roles for <span className="font-medium">{name}</span>
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Create Role
        </button>
      </div>

      {/* Create role inline form */}
      {showCreate && (
        <form
          onSubmit={handleCreateSubmit}
          className="mb-6 space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
        >
          <h2 className="text-lg font-semibold text-gray-900">New Role</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="new-role-name" className="mb-1.5 block text-sm font-medium text-gray-700">
                Role Name
              </label>
              <input
                id="new-role-name"
                type="text"
                required
                value={newRole.name}
                onChange={(e) => setNewRole({ ...newRole, name: e.target.value })}
                placeholder="e.g. admin"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="new-role-description" className="mb-1.5 block text-sm font-medium text-gray-700">
                Description
              </label>
              <input
                id="new-role-description"
                type="text"
                value={newRole.description}
                onChange={(e) => setNewRole({ ...newRole, description: e.target.value })}
                placeholder="Optional description"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          {createMutation.isError && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
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

      {/* Role table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table aria-label="Roles list" className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Description
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Created
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {roles && roles.length > 0 ? (
              roles.map((role) => (
                <tr key={role.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                    {role.name}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-700">
                    {role.description || '-'}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {new Date(role.createdAt).toLocaleDateString()}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right">
                    <button
                      onClick={() => setDeleteTarget(role.name)}
                      className="text-sm font-medium text-red-600 hover:text-red-800"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-sm text-gray-500">
                  No roles found in this realm.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {deleteMutation.isError && (
          <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
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
