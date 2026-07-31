import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { getSamlSps } from '../../api/samlServiceProviders';

export default function SamlSpListPage() {
  const { name } = useParams<{ name: string }>();

  const { data: providers, isLoading, error } = useQuery({
    queryKey: ['saml-service-providers', name],
    queryFn: () => getSamlSps(name!),
    enabled: !!name,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-fg">SAML Service Providers</h1>
        <Link
          to={`/console/realms/${name}/saml-providers/create`}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Add Service Provider
        </Link>
      </div>

      {error && (
        <div role="alert" className="rounded-md bg-danger-soft p-4 text-sm text-danger-fg">
          Failed to load data: {error.message}
        </div>
      )}

      {isLoading ? (
        <div className="text-subtle">Loading service providers...</div>
      ) : !providers || providers.length === 0 ? (
        <div className="rounded-md border border-line bg-surface p-8 text-center text-subtle">
          No SAML service providers configured.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
          <table className="min-w-full divide-y divide-line">
            <thead className="bg-sunken">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Entity ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Enabled</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">ACS URL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {providers.map((sp) => (
                <tr key={sp.id} className="hover:bg-hover">
                  <td className="whitespace-nowrap px-6 py-4">
                    <Link
                      to={`/console/realms/${name}/saml-providers/${sp.id}`}
                      className="font-medium text-accent hover:text-accent"
                    >
                      {sp.name}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-sm text-subtle">
                    {sp.entityId}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        sp.enabled
                          ? 'bg-success-soft text-success-fg'
                          : 'bg-danger-soft text-danger-fg'
                      }`}
                    >
                      {sp.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-subtle truncate max-w-xs">
                    {sp.acsUrl}
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
