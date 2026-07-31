import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { getFederations } from '../../api/userFederation';

export default function FederationListPage() {
  const { name } = useParams<{ name: string }>();

  const { data: federations, isLoading, error } = useQuery({
    queryKey: ['user-federations', name],
    queryFn: () => getFederations(name!),
    enabled: !!name,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-fg">User Federation</h1>
        <Link
          to={`/console/realms/${name}/user-federation/create`}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Add Provider
        </Link>
      </div>

      {error && (
        <div role="alert" className="rounded-md bg-danger-soft p-4 text-sm text-danger-fg">
          Failed to load data: {error.message}
        </div>
      )}

      {isLoading ? (
        <div className="text-subtle">Loading federation providers...</div>
      ) : !federations || federations.length === 0 ? (
        <div className="rounded-md border border-line bg-surface p-8 text-center text-subtle">
          No user federation providers configured.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
          <table className="min-w-full divide-y divide-line">
            <thead className="bg-sunken">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Provider Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Enabled</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Priority</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Last Sync</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {federations.map((fed) => (
                <tr key={fed.id} className="hover:bg-hover">
                  <td className="whitespace-nowrap px-6 py-4">
                    <Link
                      to={`/console/realms/${name}/user-federation/${fed.id}`}
                      className="font-medium text-accent hover:text-accent"
                    >
                      {fed.name}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <span className="inline-flex rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-muted">
                      {fed.providerType.toUpperCase()}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        fed.enabled
                          ? 'bg-success-soft text-success-fg'
                          : 'bg-danger-soft text-danger-fg'
                      }`}
                    >
                      {fed.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-subtle">
                    {fed.priority}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-subtle">
                    {fed.lastSyncAt
                      ? new Date(fed.lastSyncAt).toLocaleString()
                      : 'Never'}
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
