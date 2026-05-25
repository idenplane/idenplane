import { useState, type FormEvent } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getGroupById,
  updateGroup,
  deleteGroup,
  getGroupMembers,
  removeUserFromGroup,
  getGroupRoles,
  assignGroupRoles,
  removeGroupRoles,
  getGroups,
} from '../../api/groups';
import { getRealmRoles } from '../../api/roles';
import ConfirmDialog from '../../components/ConfirmDialog';

export default function GroupDetailPage() {
  const { name, groupId } = useParams<{ name: string; groupId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showDelete, setShowDelete] = useState(false);
  const [selectedRole, setSelectedRole] = useState('');
  const [activeTab, setActiveTab] = useState<'settings' | 'members' | 'roles'>('settings');

  const { data: group, isLoading } = useQuery({
    queryKey: ['group', name, groupId],
    queryFn: () => getGroupById(name!, groupId!),
    enabled: !!name && !!groupId,
  });

  const { data: groups } = useQuery({
    queryKey: ['groups', name],
    queryFn: () => getGroups(name!),
    enabled: !!name,
  });

  const { data: members, refetch: refetchMembers } = useQuery({
    queryKey: ['groupMembers', name, groupId],
    queryFn: () => getGroupMembers(name!, groupId!),
    enabled: !!name && !!groupId && activeTab === 'members',
  });

  const { data: groupRoles, refetch: refetchGroupRoles } = useQuery({
    queryKey: ['groupRoles', name, groupId],
    queryFn: () => getGroupRoles(name!, groupId!),
    enabled: !!name && !!groupId && activeTab === 'roles',
  });

  const { data: allRoles } = useQuery({
    queryKey: ['roles', name],
    queryFn: () => getRealmRoles(name!),
    enabled: !!name && activeTab === 'roles',
  });

  const [form, setForm] = useState({ name: '', description: '', parentId: '' });

  // Seed the editable form from fetched data when the loaded group changes.
  // Adjusting state during render (vs. an effect) avoids an extra render pass.
  const [seededGroup, setSeededGroup] = useState(group);
  if (group && group !== seededGroup) {
    setSeededGroup(group);
    setForm({
      name: group.name,
      description: group.description ?? '',
      parentId: group.parentId ?? '',
    });
  }

  const updateMutation = useMutation({
    mutationFn: () =>
      updateGroup(name!, groupId!, {
        name: form.name,
        description: form.description || undefined,
        parentId: form.parentId || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['group', name, groupId] });
      queryClient.invalidateQueries({ queryKey: ['groups', name] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteGroup(name!, groupId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups', name] });
      navigate(`/console/realms/${name}/groups`);
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => removeUserFromGroup(name!, userId, groupId!),
    onSuccess: () => refetchMembers(),
  });

  const assignRoleMutation = useMutation({
    mutationFn: (roleName: string) => assignGroupRoles(name!, groupId!, [roleName]),
    onSuccess: () => {
      refetchGroupRoles();
      setSelectedRole('');
    },
  });

  const removeRoleMutation = useMutation({
    mutationFn: (roleName: string) => removeGroupRoles(name!, groupId!, [roleName]),
    onSuccess: () => refetchGroupRoles(),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    updateMutation.mutate();
  }

  if (isLoading) {
    return <div className="text-gray-500">Loading group...</div>;
  }

  if (!group) {
    return <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">Group not found.</div>;
  }

  // Filter out self and descendants for parent selector
  const availableParents = groups?.filter((g) => g.id !== groupId) ?? [];
  const assignedRoleNames = new Set(groupRoles?.map((r) => r.name) ?? []);
  const availableRoles = allRoles?.filter((r) => !assignedRoleNames.has(r.name)) ?? [];

  const tabs = [
    { key: 'settings' as const, label: 'Settings' },
    { key: 'members' as const, label: 'Members' },
    { key: 'roles' as const, label: 'Role Mappings' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{group.name}</h1>
          {group.description && (
            <p className="mt-1 text-sm text-gray-500">{group.description}</p>
          )}
        </div>
        <button
          onClick={() => setShowDelete(true)}
          className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
        >
          Delete Group
        </button>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`border-b-2 py-3 text-sm font-medium ${
                activeTab === tab.key
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div>
            <label htmlFor="field-group-name" className="mb-1.5 block text-sm font-medium text-gray-700">Group Name</label>
            <input
              id="field-group-name"
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="field-group-description" className="mb-1.5 block text-sm font-medium text-gray-700">Description</label>
            <textarea
              id="field-group-description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="field-group-parentId" className="mb-1.5 block text-sm font-medium text-gray-700">Parent Group</label>
            <select
              id="field-group-parentId"
              value={form.parentId}
              onChange={(e) => setForm({ ...form, parentId: e.target.value })}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            >
              <option value="">None (top-level)</option>
              {availableParents.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          {updateMutation.isSuccess && (
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">Group updated successfully.</div>
          )}
          {updateMutation.isError && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">Failed to update group.</div>
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
      )}

      {/* Members Tab */}
      {activeTab === 'members' && (
        <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Members</h2>
          {members && members.length > 0 ? (
            <div className="overflow-hidden rounded-md border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Username</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Email</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {members.map((user) => (
                    <tr key={user.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm">
                        <Link
                          to={`/console/realms/${name}/users/${user.id}`}
                          className="font-medium text-indigo-600 hover:text-indigo-900"
                        >
                          {user.username}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{user.email || '-'}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => removeMemberMutation.mutate(user.id)}
                          className="text-sm text-red-600 hover:text-red-800"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No members in this group.</p>
          )}
          <p className="text-xs text-gray-400">
            To add users to this group, go to a user's detail page.
          </p>
        </div>
      )}

      {/* Roles Tab */}
      {activeTab === 'roles' && (
        <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Role Mappings</h2>
          <p className="text-sm text-gray-500">
            Roles assigned to this group are inherited by all members.
          </p>

          {/* Assigned roles */}
          <div>
            <h3 className="mb-2 text-sm font-medium text-gray-700">Assigned Roles</h3>
            {groupRoles && groupRoles.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {groupRoles.map((role) => (
                  <span
                    key={role.id}
                    className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-3 py-1 text-sm font-medium text-indigo-700"
                  >
                    {role.name}
                    <button
                      type="button"
                      onClick={() => removeRoleMutation.mutate(role.name)}
                      className="ml-1 text-indigo-400 hover:text-indigo-600"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No roles assigned.</p>
            )}
          </div>

          {/* Add role */}
          {availableRoles.length > 0 && (
            <div className="flex items-end gap-3 border-t border-gray-200 pt-4">
              <div className="flex-1">
                <label htmlFor="field-group-addRole" className="mb-1.5 block text-sm font-medium text-gray-700">Add Role</label>
                <select
                  id="field-group-addRole"
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                >
                  <option value="">Select a role...</option>
                  {availableRoles.map((role) => (
                    <option key={role.id} value={role.name}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => selectedRole && assignRoleMutation.mutate(selectedRole)}
                disabled={!selectedRole || assignRoleMutation.isPending}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Assign
              </button>
            </div>
          )}
        </div>
      )}

      {/* Children */}
      {group.children && group.children.length > 0 && (
        <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Sub-Groups</h2>
          <div className="space-y-1">
            {group.children.map((child) => (
              <Link
                key={child.id}
                to={`/console/realms/${name}/groups/${child.id}`}
                className="block rounded-md px-3 py-2 text-sm font-medium text-indigo-600 hover:bg-gray-50"
              >
                {child.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={showDelete}
        title="Delete Group"
        message={`Are you sure you want to delete group "${group.name}"? This will also remove all sub-groups.`}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setShowDelete(false)}
      />
    </div>
  );
}
