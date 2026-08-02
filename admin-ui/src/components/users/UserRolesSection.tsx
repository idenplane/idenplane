import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  getRealmRoles,
  getUserRealmRoles,
  assignUserRealmRoles,
  removeUserRealmRoles,
  getClientRoles,
  getUserClientRoles,
  assignUserClientRoles,
  removeUserClientRoles,
} from '../../api/roles';
import { getClients } from '../../api/clients';

type UserRolesSectionProps = {
  realmName: string;
  userId: string;
};

export default function UserRolesSection({ realmName, userId }: UserRolesSectionProps) {
  const [selectedRole, setSelectedRole] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedClientRole, setSelectedClientRole] = useState('');

  const { data: allRoles } = useQuery({
    queryKey: ['roles', realmName],
    queryFn: () => getRealmRoles(realmName),
  });

  const { data: userRoles, refetch: refetchUserRoles } = useQuery({
    queryKey: ['userRoles', realmName, userId],
    queryFn: () => getUserRealmRoles(realmName, userId),
  });

  const assignRoleMutation = useMutation({
    mutationFn: (roleName: string) => assignUserRealmRoles(realmName, userId, [roleName]),
    onSuccess: () => {
      refetchUserRoles();
      setSelectedRole('');
    },
  });

  const removeRoleMutation = useMutation({
    mutationFn: (roleName: string) => removeUserRealmRoles(realmName, userId, [roleName]),
    onSuccess: () => refetchUserRoles(),
  });

  const { data: allClients } = useQuery({
    queryKey: ['clients', realmName],
    queryFn: () => getClients(realmName),
  });

  const { data: clientRoles } = useQuery({
    queryKey: ['clientRoles', realmName, selectedClientId],
    queryFn: () => getClientRoles(realmName, selectedClientId),
    enabled: !!selectedClientId,
  });

  const { data: userClientRoles, refetch: refetchUserClientRoles } = useQuery({
    queryKey: ['userClientRoles', realmName, userId, selectedClientId],
    queryFn: () => getUserClientRoles(realmName, userId, selectedClientId),
    enabled: !!selectedClientId,
  });

  const assignClientRoleMutation = useMutation({
    mutationFn: (roleName: string) =>
      assignUserClientRoles(realmName, userId, selectedClientId, [roleName]),
    onSuccess: () => {
      refetchUserClientRoles();
      setSelectedClientRole('');
    },
  });

  const removeClientRoleMutation = useMutation({
    mutationFn: (roleName: string) =>
      removeUserClientRoles(realmName, userId, selectedClientId, [roleName]),
    onSuccess: () => refetchUserClientRoles(),
  });

  const assignedRoleNames = new Set(userRoles?.map((r) => r.name) ?? []);
  const availableRoles = allRoles?.filter((r) => !assignedRoleNames.has(r.name)) ?? [];

  const assignedClientRoleNames = new Set(userClientRoles?.map((r) => r.name) ?? []);
  const availableClientRoles = clientRoles?.filter((r) => !assignedClientRoleNames.has(r.name)) ?? [];

  return (
    <>
      {/* Role Mappings */}
      <div className="space-y-4 rounded-lg border border-line bg-surface p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-fg">Role Mappings</h2>

        {/* Assigned roles */}
        <div>
          <h3 className="mb-2 text-sm font-medium text-muted">Assigned Roles</h3>
          {userRoles && userRoles.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {userRoles.map((role) => (
                <span
                  key={role.id}
                  className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-3 py-1 text-sm font-medium text-accent"
                >
                  {role.name}
                  <button
                    type="button"
                    onClick={() => removeRoleMutation.mutate(role.name)}
                    className="ml-1 text-accent hover:text-accent"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-subtle">No roles assigned.</p>
          )}
        </div>

        {/* Add role */}
        {availableRoles.length > 0 && (
          <div className="flex items-end gap-3 border-t border-line pt-4">
            <div className="flex-1">
              <label htmlFor="field-user-addRole" className="mb-1.5 block text-sm font-medium text-muted">
                Add Role
              </label>
              <select
                id="field-user-addRole"
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
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
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              Assign
            </button>
          </div>
        )}
      </div>

      {/* Client Role Mappings */}
      <div className="space-y-4 rounded-lg border border-line bg-surface p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-fg">Client Role Mappings</h2>

        {/* Client selector */}
        <div>
          <label htmlFor="field-user-client" className="mb-1.5 block text-sm font-medium text-muted">Client</label>
          <select
            id="field-user-client"
            value={selectedClientId}
            onChange={(e) => {
              setSelectedClientId(e.target.value);
              setSelectedClientRole('');
            }}
            className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          >
            <option value="">Select a client...</option>
            {allClients?.map((client) => (
              <option key={client.id} value={client.clientId}>
                {client.clientId}
              </option>
            ))}
          </select>
        </div>

        {/* Client roles (shown when a client is selected) */}
        {selectedClientId && (
          <>
            <div>
              <h3 className="mb-2 text-sm font-medium text-muted">
                Assigned Roles for <span className="font-semibold text-fg">{selectedClientId}</span>
              </h3>
              {userClientRoles && userClientRoles.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {userClientRoles.map((role) => (
                    <span
                      key={role.id}
                      className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-3 py-1 text-sm font-medium text-violet-700"
                    >
                      {role.name}
                      <button
                        type="button"
                        onClick={() => removeClientRoleMutation.mutate(role.name)}
                        className="ml-1 text-violet-400 hover:text-violet-600"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-subtle">No client roles assigned.</p>
              )}
            </div>

            {/* Add client role */}
            {availableClientRoles.length > 0 && (
              <div className="flex items-end gap-3 border-t border-line pt-4">
                <div className="flex-1">
                  <label htmlFor="field-user-addClientRole" className="mb-1.5 block text-sm font-medium text-muted">
                    Add Client Role
                  </label>
                  <select
                    id="field-user-addClientRole"
                    value={selectedClientRole}
                    onChange={(e) => setSelectedClientRole(e.target.value)}
                    className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                  >
                    <option value="">Select a role...</option>
                    {availableClientRoles.map((role) => (
                      <option key={role.id} value={role.name}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => selectedClientRole && assignClientRoleMutation.mutate(selectedClientRole)}
                  disabled={!selectedClientRole || assignClientRoleMutation.isPending}
                  className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  Assign
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
