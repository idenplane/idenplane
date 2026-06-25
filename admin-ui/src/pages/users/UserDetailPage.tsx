import { useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getUserById, updateUser, deleteUser, resetPassword, getMfaStatus, resetMfa, getOfflineSessions, revokeOfflineSession, impersonateUser, type ImpersonationResult } from '../../api/users';
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
import { getUserGroups, getGroups, addUserToGroup, removeUserFromGroup } from '../../api/groups';
import { getUserSessions, revokeSession, revokeAllUserSessions } from '../../api/sessions';
import type { SessionInfo } from '../../api/sessions';
import ConfirmDialog from '../../components/ConfirmDialog';
import PasswordInput from '../../components/PasswordInput';

export default function UserDetailPage() {
  const { name, id } = useParams<{ name: string; id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showDelete, setShowDelete] = useState(false);
  const [showResetMfa, setShowResetMfa] = useState(false);
  const [impersonationResult, setImpersonationResult] = useState<ImpersonationResult | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState('');
  const [selectedRole, setSelectedRole] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedClientRole, setSelectedClientRole] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('');

  const { data: user, isLoading } = useQuery({
    queryKey: ['user', name, id],
    queryFn: () => getUserById(name!, id!),
    enabled: !!name && !!id,
  });

  const { data: allRoles } = useQuery({
    queryKey: ['roles', name],
    queryFn: () => getRealmRoles(name!),
    enabled: !!name,
  });

  const { data: userRoles, refetch: refetchUserRoles } = useQuery({
    queryKey: ['userRoles', name, id],
    queryFn: () => getUserRealmRoles(name!, id!),
    enabled: !!name && !!id,
  });

  const { data: mfaStatus } = useQuery({
    queryKey: ['mfaStatus', name, id],
    queryFn: () => getMfaStatus(name!, id!),
    enabled: !!name && !!id,
  });

  const [form, setForm] = useState({
    email: '',
    emailVerified: false,
    firstName: '',
    lastName: '',
    enabled: true,
  });

  // Seed the editable form from fetched data when the loaded user changes.
  // Adjusting state during render (vs. an effect) avoids an extra render pass.
  const [seededUser, setSeededUser] = useState(user);
  if (user && user !== seededUser) {
    setSeededUser(user);
    setForm({
      email: user.email ?? '',
      emailVerified: user.emailVerified,
      firstName: user.firstName ?? '',
      lastName: user.lastName ?? '',
      enabled: user.enabled,
    });
  }

  const updateMutation = useMutation({
    mutationFn: () => updateUser(name!, id!, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user', name, id] });
      queryClient.invalidateQueries({ queryKey: ['users', name] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteUser(name!, id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users', name] });
      navigate(`/console/realms/${name}/users`);
    },
  });

  const resetPwMutation = useMutation({
    mutationFn: () => resetPassword(name!, id!, newPassword),
    onSuccess: () => {
      setNewPassword('');
      setPasswordMsg('Password reset successfully.');
    },
    onError: () => {
      setPasswordMsg('Failed to reset password.');
    },
  });

  const resetMfaMutation = useMutation({
    mutationFn: () => resetMfa(name!, id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mfaStatus', name, id] });
      setShowResetMfa(false);
    },
  });

  const assignRoleMutation = useMutation({
    mutationFn: (roleName: string) => assignUserRealmRoles(name!, id!, [roleName]),
    onSuccess: () => {
      refetchUserRoles();
      setSelectedRole('');
    },
  });

  const removeRoleMutation = useMutation({
    mutationFn: (roleName: string) => removeUserRealmRoles(name!, id!, [roleName]),
    onSuccess: () => {
      refetchUserRoles();
    },
  });

  // Client Roles
  const { data: allClients } = useQuery({
    queryKey: ['clients', name],
    queryFn: () => getClients(name!),
    enabled: !!name,
  });

  const { data: clientRoles } = useQuery({
    queryKey: ['clientRoles', name, selectedClientId],
    queryFn: () => getClientRoles(name!, selectedClientId),
    enabled: !!name && !!selectedClientId,
  });

  const { data: userClientRoles, refetch: refetchUserClientRoles } = useQuery({
    queryKey: ['userClientRoles', name, id, selectedClientId],
    queryFn: () => getUserClientRoles(name!, id!, selectedClientId),
    enabled: !!name && !!id && !!selectedClientId,
  });

  const assignClientRoleMutation = useMutation({
    mutationFn: (roleName: string) =>
      assignUserClientRoles(name!, id!, selectedClientId, [roleName]),
    onSuccess: () => {
      refetchUserClientRoles();
      setSelectedClientRole('');
    },
  });

  const removeClientRoleMutation = useMutation({
    mutationFn: (roleName: string) =>
      removeUserClientRoles(name!, id!, selectedClientId, [roleName]),
    onSuccess: () => refetchUserClientRoles(),
  });

  // Groups
  const { data: userGroups, refetch: refetchUserGroups } = useQuery({
    queryKey: ['userGroups', name, id],
    queryFn: () => getUserGroups(name!, id!),
    enabled: !!name && !!id,
  });

  const { data: allGroups } = useQuery({
    queryKey: ['groups', name],
    queryFn: () => getGroups(name!),
    enabled: !!name,
  });

  const addGroupMutation = useMutation({
    mutationFn: (groupId: string) => addUserToGroup(name!, id!, groupId),
    onSuccess: () => {
      refetchUserGroups();
      setSelectedGroup('');
    },
  });

  const removeGroupMutation = useMutation({
    mutationFn: (groupId: string) => removeUserFromGroup(name!, id!, groupId),
    onSuccess: () => refetchUserGroups(),
  });

  // Sessions
  const { data: userSessions, refetch: refetchSessions } = useQuery({
    queryKey: ['userSessions', name, id],
    queryFn: () => getUserSessions(name!, id!),
    enabled: !!name && !!id,
  });

  const revokeSessionMutation = useMutation({
    mutationFn: (session: SessionInfo) => revokeSession(name!, session.id, session.type),
    onSuccess: () => refetchSessions(),
  });

  const revokeAllMutation = useMutation({
    mutationFn: () => revokeAllUserSessions(name!, id!),
    onSuccess: () => refetchSessions(),
  });

  // Offline sessions
  const { data: offlineSessions, refetch: refetchOffline } = useQuery({
    queryKey: ['offlineSessions', name, id],
    queryFn: () => getOfflineSessions(name!, id!),
    enabled: !!name && !!id,
  });

  const revokeOfflineMutation = useMutation({
    mutationFn: (tokenId: string) => revokeOfflineSession(name!, id!, tokenId),
    onSuccess: () => refetchOffline(),
  });

  const impersonateMutation = useMutation({
    mutationFn: () => impersonateUser(name!, id!),
    onSuccess: (result) => setImpersonationResult(result),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    updateMutation.mutate();
  }

  function handleResetPassword(e: FormEvent) {
    e.preventDefault();
    setPasswordMsg('');
    resetPwMutation.mutate();
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading user...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
        User not found.
      </div>
    );
  }

  const assignedRoleNames = new Set(userRoles?.map((r) => r.name) ?? []);
  const availableRoles = allRoles?.filter((r) => !assignedRoleNames.has(r.name)) ?? [];
  const assignedGroupIds = new Set(userGroups?.map((g) => g.id) ?? []);
  const availableGroups = allGroups?.filter((g) => !assignedGroupIds.has(g.id)) ?? [];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{user.username}</h1>
          <p className="mt-1 text-sm text-gray-500">{user.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => impersonateMutation.mutate()}
            disabled={impersonateMutation.isPending}
            className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
          >
            {impersonateMutation.isPending ? 'Generating...' : 'Impersonate'}
          </button>
          <button
            onClick={() => setShowDelete(true)}
            className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            Delete User
          </button>
        </div>
      </div>

      {impersonationResult && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-semibold text-amber-800">Impersonation Tokens</h3>
              <p className="mt-0.5 text-xs text-amber-600">
                These tokens allow you to act as <span className="font-medium">{user.username}</span>. They expire in {impersonationResult.expiresIn}s. Copy and store securely.
              </p>
            </div>
            <button onClick={() => setImpersonationResult(null)} className="text-amber-400 hover:text-amber-600">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="mt-3 space-y-2">
            <div>
              <span className="text-xs font-medium text-amber-700">Access Token</span>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-amber-100 px-2 py-1 text-xs text-amber-900">{impersonationResult.accessToken}</code>
                <button
                  onClick={() => navigator.clipboard.writeText(impersonationResult.accessToken)}
                  className="shrink-0 rounded border border-amber-300 px-2 py-1 text-xs text-amber-700 hover:bg-amber-100"
                >Copy</button>
              </div>
            </div>
            {impersonationResult.refreshToken && (
              <div>
                <span className="text-xs font-medium text-amber-700">Refresh Token</span>
                <div className="mt-1 flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-amber-100 px-2 py-1 text-xs text-amber-900">{impersonationResult.refreshToken}</code>
                  <button
                    onClick={() => navigator.clipboard.writeText(impersonationResult.refreshToken)}
                    className="shrink-0 rounded border border-amber-300 px-2 py-1 text-xs text-amber-700 hover:bg-amber-100"
                  >Copy</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {impersonateMutation.isError && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          Failed to impersonate user. Ensure impersonation is enabled for this realm.
        </div>
      )}

      {/* Profile form */}
      <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Profile</h2>

        <div>
          <label htmlFor="field-user-username" className="mb-1.5 block text-sm font-medium text-gray-700">Username</label>
          <input
            id="field-user-username"
            type="text"
            value={user.username}
            disabled
            className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="field-user-email" className="mb-1.5 block text-sm font-medium text-gray-700">Email</label>
            <input
              id="field-user-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
          <div className="flex items-end gap-2 pb-1">
            <input
              type="checkbox"
              id="emailVerified"
              checked={form.emailVerified}
              onChange={(e) => setForm({ ...form, emailVerified: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <label htmlFor="emailVerified" className="text-sm font-medium text-gray-700">
              Email Verified
            </label>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="field-user-firstName" className="mb-1.5 block text-sm font-medium text-gray-700">First Name</label>
            <input
              id="field-user-firstName"
              type="text"
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="field-user-lastName" className="mb-1.5 block text-sm font-medium text-gray-700">Last Name</label>
            <input
              id="field-user-lastName"
              type="text"
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="enabled"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          <label htmlFor="enabled" className="text-sm font-medium text-gray-700">
            Enabled
          </label>
        </div>

        {updateMutation.isSuccess && (
          <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
            User updated successfully.
          </div>
        )}

        {updateMutation.isError && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            Failed to update user.
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

      {/* Set Password */}
      <form onSubmit={handleResetPassword} className="space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Set Password</h2>

        <div>
          <label htmlFor="field-user-newPassword" className="mb-1.5 block text-sm font-medium text-gray-700">New Password</label>
          <PasswordInput
            id="field-user-newPassword"
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          />
        </div>

        {passwordMsg && (
          <div
            className={`rounded-md p-3 text-sm ${
              passwordMsg.includes('success')
                ? 'bg-green-50 text-green-700'
                : 'bg-red-50 text-red-700'
            }`}
          >
            {passwordMsg}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={resetPwMutation.isPending}
            className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {resetPwMutation.isPending ? 'Resetting...' : 'Reset Password'}
          </button>
        </div>
      </form>

      {/* Security - MFA Status */}
      <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Security</h2>

        <div>
          <h3 className="mb-2 text-sm font-medium text-gray-700">MFA Status</h3>
          <div className="flex items-center gap-3">
            {mfaStatus?.enabled ? (
              <>
                <span className="inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                  Enabled
                </span>
                <button
                  type="button"
                  onClick={() => setShowResetMfa(true)}
                  className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
                >
                  Reset MFA
                </button>
              </>
            ) : (
              <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                Not configured
              </span>
            )}
          </div>
        </div>

        {resetMfaMutation.isSuccess && (
          <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
            MFA has been reset successfully.
          </div>
        )}
        {resetMfaMutation.isError && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            Failed to reset MFA.
          </div>
        )}
      </div>

      {/* Role Mappings */}
      <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Role Mappings</h2>

        {/* Assigned roles */}
        <div>
          <h3 className="mb-2 text-sm font-medium text-gray-700">Assigned Roles</h3>
          {userRoles && userRoles.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {userRoles.map((role) => (
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
              <label htmlFor="field-user-addRole" className="mb-1.5 block text-sm font-medium text-gray-700">
                Add Role
              </label>
              <select
                id="field-user-addRole"
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

      {/* Client Role Mappings */}
      <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Client Role Mappings</h2>

        {/* Client selector */}
        <div>
          <label htmlFor="field-user-client" className="mb-1.5 block text-sm font-medium text-gray-700">Client</label>
          <select
            id="field-user-client"
            value={selectedClientId}
            onChange={(e) => {
              setSelectedClientId(e.target.value);
              setSelectedClientRole('');
            }}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
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
              <h3 className="mb-2 text-sm font-medium text-gray-700">
                Assigned Roles for <span className="font-semibold text-gray-900">{selectedClientId}</span>
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
                <p className="text-sm text-gray-500">No client roles assigned.</p>
              )}
            </div>

            {/* Add client role */}
            {(() => {
              const assignedClientRoleNames = new Set(userClientRoles?.map((r) => r.name) ?? []);
              const availableClientRoles = clientRoles?.filter((r) => !assignedClientRoleNames.has(r.name)) ?? [];
              return availableClientRoles.length > 0 ? (
                <div className="flex items-end gap-3 border-t border-gray-200 pt-4">
                  <div className="flex-1">
                    <label htmlFor="field-user-addClientRole" className="mb-1.5 block text-sm font-medium text-gray-700">
                      Add Client Role
                    </label>
                    <select
                      id="field-user-addClientRole"
                      value={selectedClientRole}
                      onChange={(e) => setSelectedClientRole(e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
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
              ) : null;
            })()}
          </>
        )}
      </div>

      {/* Groups */}
      <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Groups</h2>

        {/* Assigned groups */}
        <div>
          <h3 className="mb-2 text-sm font-medium text-gray-700">Member of</h3>
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
            <p className="text-sm text-gray-500">Not a member of any group.</p>
          )}
        </div>

        {/* Add to group */}
        {availableGroups.length > 0 && (
          <div className="flex items-end gap-3 border-t border-gray-200 pt-4">
            <div className="flex-1">
              <label htmlFor="field-user-addToGroup" className="mb-1.5 block text-sm font-medium text-gray-700">
                Add to Group
              </label>
              <select
                id="field-user-addToGroup"
                value={selectedGroup}
                onChange={(e) => setSelectedGroup(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
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
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        )}
      </div>

      {/* Sessions */}
      <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Active Sessions</h2>
          {userSessions && userSessions.length > 0 && (
            <button
              onClick={() => revokeAllMutation.mutate()}
              disabled={revokeAllMutation.isPending}
              className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Revoke All
            </button>
          )}
        </div>

        {userSessions && userSessions.length > 0 ? (
          <div className="overflow-hidden rounded-md border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">IP Address</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Started</th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {userSessions.map((session) => (
                  <tr key={`${session.type}-${session.id}`} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          session.type === 'sso'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}
                      >
                        {session.type === 'sso' ? 'SSO' : 'OAuth'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                      {session.ipAddress || '-'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                      {new Date(session.createdAt).toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button
                        onClick={() => revokeSessionMutation.mutate(session)}
                        className="text-sm text-red-600 hover:text-red-800"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-500">No active sessions.</p>
        )}
      </div>

      {/* Offline Sessions */}
      <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Offline Sessions</h2>
        <p className="text-xs text-gray-500">
          Offline tokens persist beyond regular session logout. Revoke them individually here.
        </p>

        {offlineSessions && offlineSessions.length > 0 ? (
          <div className="overflow-hidden rounded-md border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Session</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Expires</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Created</th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {offlineSessions.map((session) => (
                  <tr key={session.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                      {session.sessionId.slice(0, 8)}...
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                      {new Date(session.expiresAt).toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                      {new Date(session.createdAt).toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button
                        onClick={() => revokeOfflineMutation.mutate(session.id)}
                        className="text-sm text-red-600 hover:text-red-800"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-500">No offline sessions.</p>
        )}
      </div>

      <ConfirmDialog
        isOpen={showDelete}
        title="Delete User"
        message={`Are you sure you want to delete user "${user.username}"? This action is irreversible.`}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setShowDelete(false)}
      />

      <ConfirmDialog
        isOpen={showResetMfa}
        title="Reset MFA"
        message={`Are you sure you want to reset MFA for user "${user.username}"? They will need to set up TOTP again on their next login.`}
        onConfirm={() => resetMfaMutation.mutate()}
        onCancel={() => setShowResetMfa(false)}
      />
    </div>
  );
}
