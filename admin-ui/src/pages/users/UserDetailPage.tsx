import { useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getUserById, deleteUser, impersonateUser, type ImpersonationResult } from '../../api/users';
import ConfirmDialog from '../../components/ConfirmDialog';
import UserProfileSection from '../../components/users/UserProfileSection';
import UserSecuritySection from '../../components/users/UserSecuritySection';
import UserRolesSection from '../../components/users/UserRolesSection';
import UserGroupsSection from '../../components/users/UserGroupsSection';
import UserSessionsSection from '../../components/users/UserSessionsSection';

export default function UserDetailPage() {
  const { name, id } = useParams<{ name: string; id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showDelete, setShowDelete] = useState(false);
  const [impersonationResult, setImpersonationResult] = useState<ImpersonationResult | null>(null);

  const { data: user, isLoading } = useQuery({
    queryKey: ['user', name, id],
    queryFn: () => getUserById(name!, id!),
    enabled: !!name && !!id,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteUser(name!, id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users', name] });
      navigate(`/console/realms/${name}/users`);
    },
  });

  const impersonateMutation = useMutation({
    mutationFn: () => impersonateUser(name!, id!),
    onSuccess: (result) => setImpersonationResult(result),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-subtle">Loading user...</div>
      </div>
    );
  }

  if (!user || !name || !id) {
    return (
      <div className="rounded-md bg-danger-soft p-4 text-sm text-danger-fg">
        User not found.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-fg">{user.username}</h1>
          <p className="mt-1 text-sm text-subtle">{user.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => impersonateMutation.mutate()}
            disabled={impersonateMutation.isPending}
            className="rounded-md border border-warning-soft bg-warning-soft px-4 py-2 text-sm font-medium text-warning-fg hover:bg-warning-soft disabled:opacity-50"
          >
            {impersonateMutation.isPending ? 'Generating...' : 'Impersonate'}
          </button>
          <button
            onClick={() => setShowDelete(true)}
            className="rounded-md border border-danger-soft px-4 py-2 text-sm font-medium text-danger-fg hover:bg-danger-soft"
          >
            Delete User
          </button>
        </div>
      </div>

      {impersonationResult && (
        <div className="rounded-lg border border-warning-soft bg-warning-soft p-4">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-semibold text-warning-fg">Impersonation Tokens</h3>
              <p className="mt-0.5 text-xs text-warning">
                These tokens allow you to act as <span className="font-medium">{user.username}</span>. They expire in {impersonationResult.expiresIn}s. Copy and store securely.
              </p>
            </div>
            <button onClick={() => setImpersonationResult(null)} className="text-amber-400 hover:text-warning">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="mt-3 space-y-2">
            <div>
              <span className="text-xs font-medium text-warning-fg">Access Token</span>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-warning-soft px-2 py-1 text-xs text-amber-900">{impersonationResult.accessToken}</code>
                <button
                  onClick={() => navigator.clipboard.writeText(impersonationResult.accessToken)}
                  className="shrink-0 rounded border border-warning-soft px-2 py-1 text-xs text-warning-fg hover:bg-warning-soft"
                >Copy</button>
              </div>
            </div>
            {impersonationResult.refreshToken && (
              <div>
                <span className="text-xs font-medium text-warning-fg">Refresh Token</span>
                <div className="mt-1 flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-warning-soft px-2 py-1 text-xs text-amber-900">{impersonationResult.refreshToken}</code>
                  <button
                    onClick={() => navigator.clipboard.writeText(impersonationResult.refreshToken)}
                    className="shrink-0 rounded border border-warning-soft px-2 py-1 text-xs text-warning-fg hover:bg-warning-soft"
                  >Copy</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {impersonateMutation.isError && (
        <div className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
          Failed to impersonate user. Ensure impersonation is enabled for this realm.
        </div>
      )}

      <UserProfileSection realmName={name} userId={id} user={user} />
      <UserSecuritySection realmName={name} userId={id} username={user.username} />
      <UserRolesSection realmName={name} userId={id} />
      <UserGroupsSection realmName={name} userId={id} />
      <UserSessionsSection realmName={name} userId={id} />

      <ConfirmDialog
        isOpen={showDelete}
        title="Delete User"
        message={`Are you sure you want to delete user "${user.username}"? This action is irreversible.`}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setShowDelete(false)}
      />
    </div>
  );
}
