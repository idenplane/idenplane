import { useParams, Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRealmSessions, revokeSession } from '../../api/sessions';

function formatDate(date: string) {
  return new Date(date).toLocaleString();
}

function parseUserAgent(ua: string | null): string {
  if (!ua) return '-';
  // Extract browser/client name simply
  if (ua.length > 60) return ua.slice(0, 60) + '...';
  return ua;
}

export default function SessionListPage() {
  const { name } = useParams<{ name: string }>();
  const queryClient = useQueryClient();

  const { data: sessions, isLoading, error } = useQuery({
    queryKey: ['sessions', name],
    queryFn: () => getRealmSessions(name!),
    enabled: !!name,
    refetchInterval: 30000,
  });

  const revokeMutation = useMutation({
    mutationFn: ({ sessionId, type }: { sessionId: string; type: 'oauth' | 'sso' }) =>
      revokeSession(name!, sessionId, type),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions', name] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-fg">Sessions</h1>
        <span className="text-sm text-subtle">
          {sessions?.length ?? 0} active session{sessions?.length !== 1 ? 's' : ''}
        </span>
      </div>

      {error && (
        <div role="alert" className="rounded-md bg-danger-soft p-4 text-sm text-danger-fg">
          Failed to load data: {error.message}
        </div>
      )}

      {isLoading ? (
        <div className="text-subtle">Loading sessions...</div>
      ) : !sessions || sessions.length === 0 ? (
        <div className="rounded-md border border-line bg-surface p-8 text-center text-subtle">
          No active sessions.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
          <table className="min-w-full divide-y divide-line" aria-label="Active sessions">
            <thead className="bg-sunken">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">User</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Type</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">IP Address</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">User Agent</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Started</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Expires</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-subtle">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sessions.map((session) => (
                <tr key={`${session.type}-${session.id}`} className="hover:bg-hover">
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <Link
                      to={`/console/realms/${name}/users/${session.userId}`}
                      className="font-medium text-accent hover:text-accent"
                    >
                      {session.username}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
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
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-subtle">
                    {session.ipAddress || '-'}
                  </td>
                  <td className="px-6 py-4 text-sm text-subtle" title={session.userAgent || undefined}>
                    {parseUserAgent(session.userAgent)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-subtle">
                    {formatDate(session.createdAt)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-subtle">
                    {formatDate(session.expiresAt)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right">
                    <button
                      onClick={() =>
                        revokeMutation.mutate({
                          sessionId: session.id,
                          type: session.type,
                        })
                      }
                      disabled={revokeMutation.isPending}
                      aria-label={`Revoke session for ${session.username}`}
                      className="text-sm text-danger hover:text-danger-fg disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
