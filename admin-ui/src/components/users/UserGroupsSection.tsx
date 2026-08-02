import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { getUserGroups, getGroups, addUserToGroup, removeUserFromGroup } from '../../api/groups';

type UserGroupsSectionProps = {
  realmName: string;
  userId: string;
};

export default function UserGroupsSection({ realmName, userId }: UserGroupsSectionProps) {
  const [selectedGroup, setSelectedGroup] = useState('');

  const { data: userGroups, refetch: refetchUserGroups } = useQuery({
    queryKey: ['userGroups', realmName, userId],
    queryFn: () => getUserGroups(realmName, userId),
  });

  const { data: allGroups } = useQuery({
    queryKey: ['groups', realmName],
    queryFn: () => getGroups(realmName),
  });

  const addGroupMutation = useMutation({
    mutationFn: (groupId: string) => addUserToGroup(realmName, userId, groupId),
    onSuccess: () => {
      refetchUserGroups();
      setSelectedGroup('');
    },
  });

  const removeGroupMutation = useMutation({
    mutationFn: (groupId: string) => removeUserFromGroup(realmName, userId, groupId),
    onSuccess: () => refetchUserGroups(),
  });

  const assignedGroupIds = new Set(userGroups?.map((g) => g.id) ?? []);
  const availableGroups = allGroups?.filter((g) => !assignedGroupIds.has(g.id)) ?? [];

  return (
    <div className="space-y-4 rounded-lg border border-line bg-surface p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-fg">Groups</h2>

      {/* Assigned groups */}
      <div>
        <h3 className="mb-2 text-sm font-medium text-muted">Member of</h3>
        {userGroups && userGroups.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {userGroups.map((group) => (
              <span
                key={group.id}
                className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-700"
              >
                {group.name}
                <button
                  type="button"
                  onClick={() => removeGroupMutation.mutate(group.id)}
                  className="ml-1 text-emerald-400 hover:text-emerald-600"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-subtle">Not a member of any group.</p>
        )}
      </div>

      {/* Add to group */}
      {availableGroups.length > 0 && (
        <div className="flex items-end gap-3 border-t border-line pt-4">
          <div className="flex-1">
            <label htmlFor="field-user-addToGroup" className="mb-1.5 block text-sm font-medium text-muted">
              Add to Group
            </label>
            <select
              id="field-user-addToGroup"
              value={selectedGroup}
              onChange={(e) => setSelectedGroup(e.target.value)}
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            >
              <option value="">Select a group...</option>
              {availableGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => selectedGroup && addGroupMutation.mutate(selectedGroup)}
            disabled={!selectedGroup || addGroupMutation.isPending}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
