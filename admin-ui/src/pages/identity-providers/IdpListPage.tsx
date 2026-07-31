import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { getIdentityProviders } from '../../api/identityProviders';

export default function IdpListPage() {
  const { name } = useParams<{ name: string }>();

  const { data: providers, isLoading, error } = useQuery({
    queryKey: ['identity-providers', name],
    queryFn: () => getIdentityProviders(name!),
    enabled: !!name,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-fg">Identity Providers</h1>
        <Link
          to={`/console/realms/${name}/identity-providers/create`}
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
        <div className="text-subtle">Loading providers...</div>
      ) : !providers || providers.length === 0 ? (
        <div className="rounded-md border border-line bg-surface p-8 text-center text-subtle">
          No identity providers configured.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
          <table className="min-w-full divide-y divide-line">
            <thead className="bg-sunken">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Alias</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Display Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {providers.map((idp) => (
                <tr key={idp.id} className="hover:bg-hover">
                  <td className="whitespace-nowrap px-6 py-4">
                    <Link
                      to={`/console/realms/${name}/identity-providers/${idp.alias}`}
                      className="font-medium text-accent hover:text-accent"
                    >
                      {idp.alias}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-sm text-subtle">
                    {idp.displayName || '-'}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <span className="inline-flex rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-muted">
                      {idp.providerType.toUpperCase()}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        idp.enabled
                          ? 'bg-success-soft text-success-fg'
                          : 'bg-danger-soft text-danger-fg'
                      }`}
                    >
                      {idp.enabled ? 'Enabled' : 'Disabled'}
                    </span>
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
