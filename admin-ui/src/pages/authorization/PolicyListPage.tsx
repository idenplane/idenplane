import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { getPolicies } from '../../api/authorization';
import { getErrorMessage } from '../../utils/getErrorMessage';

export default function PolicyListPage() {
  const { name } = useParams<{ name: string }>();

  const { data: policies, isLoading, error } = useQuery({
    queryKey: ['policies', name],
    queryFn: () => getPolicies(name!),
    enabled: !!name,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-fg">Authorization Policies</h1>
        <Link
          to={`/console/realms/${name}/authorization-policies/new`}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Create Policy
        </Link>
      </div>

      {error && (
        <div role="alert" className="rounded-md bg-danger-soft p-4 text-sm text-danger-fg">
          {getErrorMessage(error, 'Failed to load policies.')}
        </div>
      )}

      {isLoading ? (
        <div className="text-subtle">Loading policies...</div>
      ) : !policies || policies.length === 0 ? (
        <div className="rounded-md border border-line bg-surface p-8 text-center text-subtle">
          No authorization policies defined for this realm.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
          <table className="min-w-full divide-y divide-line">
            <thead className="bg-sunken">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Effect</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Conditions</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {policies.map((policy) => {
                const conditionsSnippet = JSON.stringify(policy.conditions);
                return (
                  <tr key={policy.id} className="hover:bg-hover">
                    <td className="whitespace-nowrap px-6 py-4">
                      <Link
                        to={`/console/realms/${name}/authorization-policies/${policy.id}`}
                        className="font-medium text-accent hover:text-accent"
                      >
                        {policy.name}
                      </Link>
                      {policy.description && (
                        <p className="mt-0.5 text-xs text-subtle">{policy.description}</p>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          policy.effect === 'allow'
                            ? 'bg-success-soft text-success-fg'
                            : 'bg-danger-soft text-danger-fg'
                        }`}
                      >
                        {policy.effect}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-subtle">
                      <code className="block max-w-xs truncate font-mono text-xs">
                        {conditionsSnippet.length > 80
                          ? conditionsSnippet.slice(0, 80) + '…'
                          : conditionsSnippet}
                      </code>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          policy.enabled
                            ? 'bg-success-soft text-success-fg'
                            : 'bg-sunken text-muted'
                        }`}
                      >
                        {policy.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
