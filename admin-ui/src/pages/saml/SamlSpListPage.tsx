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
        <h1 className="text-2xl font-bold text-gray-900">SAML Service Providers</h1>
        <Link
          to={`/console/realms/${name}/saml-providers/create`}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Add Service Provider
        </Link>
      </div>

      {error && (
        <div role="alert" className="rounded-md bg-red-50 p-4 text-sm text-red-700">
          Failed to load data: {error.message}
        </div>
      )}

      {isLoading ? (
        <div className="text-gray-500">Loading service providers...</div>
      ) : !providers || providers.length === 0 ? (
        <div className="rounded-md border border-gray-200 bg-white p-8 text-center text-gray-500">
          No SAML service providers configured.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Entity ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Enabled</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">ACS URL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {providers.map((sp) => (
                <tr key={sp.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-6 py-4">
                    <Link
                      to={`/console/realms/${name}/saml-providers/${sp.id}`}
                      className="font-medium text-indigo-600 hover:text-indigo-900"
                    >
                      {sp.name}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {sp.entityId}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        sp.enabled
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {sp.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 truncate max-w-xs">
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
