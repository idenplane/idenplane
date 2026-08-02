import { useQuery, useMutation } from '@tanstack/react-query';
import { getUserSessions, revokeSession, revokeAllUserSessions } from '../../api/sessions';
import type { SessionInfo } from '../../api/sessions';
import { getOfflineSessions, revokeOfflineSession } from '../../api/users';

type UserSessionsSectionProps = {
  realmName: string;
  userId: string;
};

export default function UserSessionsSection({ realmName, userId }: UserSessionsSectionProps) {
  const { data: userSessions, refetch: refetchSessions } = useQuery({
    queryKey: ['userSessions', realmName, userId],
    queryFn: () => getUserSessions(realmName, userId),
  });

  const revokeSessionMutation = useMutation({
    mutationFn: (session: SessionInfo) => revokeSession(realmName, session.id, session.type),
    onSuccess: () => refetchSessions(),
  });

  const revokeAllMutation = useMutation({
    mutationFn: () => revokeAllUserSessions(realmName, userId),
    onSuccess: () => refetchSessions(),
  });

  const { data: offlineSessions, refetch: refetchOffline } = useQuery({
    queryKey: ['offlineSessions', realmName, userId],
    queryFn: () => getOfflineSessions(realmName, userId),
  });

  const revokeOfflineMutation = useMutation({
    mutationFn: (tokenId: string) => revokeOfflineSession(realmName, userId, tokenId),
    onSuccess: () => refetchOffline(),
  });

  return (
    <>
      {/* Sessions */}
      <div className="space-y-4 rounded-lg border border-line bg-surface p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-fg">Active Sessions</h2>
          {userSessions && userSessions.length > 0 && (
            <button
              onClick={() => revokeAllMutation.mutate()}
              disabled={revokeAllMutation.isPending}
              className="rounded-md border border-danger-soft px-3 py-1.5 text-sm font-medium text-danger-fg hover:bg-danger-soft disabled:opacity-50"
            >
              Revoke All
            </button>
          )}
        </div>

        {userSessions && userSessions.length > 0 ? (
          <div className="overflow-hidden rounded-md border border-line">
            <table className="min-w-full divide-y divide-line">
              <thead className="bg-sunken">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">IP Address</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Started</th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-subtle">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {userSessions.map((session) => (
                  <tr key={`${session.type}-${session.id}`} className="hover:bg-hover">
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          session.type === 'sso'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-info-soft text-info-fg'
                        }`}
                      >
                        {session.type === 'sso' ? 'SSO' : 'OAuth'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-subtle">
                      {session.ipAddress || '-'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-subtle">
                      {new Date(session.createdAt).toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button
                        onClick={() => revokeSessionMutation.mutate(session)}
                        className="text-sm text-danger hover:text-danger-fg"
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
          <p className="text-sm text-subtle">No active sessions.</p>
        )}
      </div>

      {/* Offline Sessions */}
      <div className="space-y-4 rounded-lg border border-line bg-surface p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-fg">Offline Sessions</h2>
        <p className="text-xs text-subtle">
          Offline tokens persist beyond regular session logout. Revoke them individually here.
        </p>

        {offlineSessions && offlineSessions.length > 0 ? (
          <div className="overflow-hidden rounded-md border border-line">
            <table className="min-w-full divide-y divide-line">
              <thead className="bg-sunken">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Session</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Expires</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Created</th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-subtle">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {offlineSessions.map((session) => (
                  <tr key={session.id} className="hover:bg-hover">
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-fg">
                      {session.sessionId.slice(0, 8)}...
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-subtle">
                      {new Date(session.expiresAt).toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-subtle">
                      {new Date(session.createdAt).toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button
                        onClick={() => revokeOfflineMutation.mutate(session.id)}
                        className="text-sm text-danger hover:text-danger-fg"
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
          <p className="text-sm text-subtle">No offline sessions.</p>
        )}
      </div>
    </>
  );
}
