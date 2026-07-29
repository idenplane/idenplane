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
        <h1 className="text-2xl font-bold text-gray-900">Sessions</h1>
        <span className="text-sm text-gray-500">
          {sessions?.length ?? 0} active session{sessions?.length !== 1 ? 's' : ''}
        </span>
      </div>

      {error && (
        <div role="alert" className="rounded-md bg-red-50 p-4 text-sm text-red-700">
          Failed to load data: {error.message}
        </div>
      )}

      {isLoading ? (
        <div className="text-gray-500">Loading sessions...</div>
      ) : !sessions || sessions.length === 0 ? (
        <div className="rounded-md border border-gray-200 bg-white p-8 text-center text-gray-500">
          No active sessions.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200" aria-label="Active sessions">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">User</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Type</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">IP Address</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">User Agent</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Started</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Expires</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {sessions.map((session) => (
                <tr key={`${session.type}-${session.id}`} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <Link
                      to={`/console/realms/${name}/users/${session.userId}`}
                      className="font-medium text-indigo-600 hover:text-indigo-900"
                    >
                      {session.username}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
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
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {session.ipAddress || '-'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500" title={session.userAgent || undefined}>
                    {parseUserAgent(session.userAgent)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {formatDate(session.createdAt)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
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
                      className="text-sm text-red-600 hover:text-red-800 disabled:opacity-50"
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
