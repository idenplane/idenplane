import { Link, useParams } from 'react-router-dom';
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
        <h1 className="text-2xl font-bold text-gray-900">Authorization Policies</h1>
        <Link
          to={`/console/realms/${name}/authorization-policies/new`}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Create Policy
        </Link>
      </div>

      {error && (
        <div role="alert" className="rounded-md bg-red-50 p-4 text-sm text-red-700">
          {getErrorMessage(error, 'Failed to load policies.')}
        </div>
      )}

      {isLoading ? (
        <div className="text-gray-500">Loading policies...</div>
      ) : !policies || policies.length === 0 ? (
        <div className="rounded-md border border-gray-200 bg-white p-8 text-center text-gray-500">
          No authorization policies defined for this realm.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Effect</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Conditions</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {policies.map((policy) => {
                const conditionsSnippet = JSON.stringify(policy.conditions);
                return (
                  <tr key={policy.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-6 py-4">
                      <Link
                        to={`/console/realms/${name}/authorization-policies/${policy.id}`}
                        className="font-medium text-indigo-600 hover:text-indigo-900"
                      >
                        {policy.name}
                      </Link>
                      {policy.description && (
                        <p className="mt-0.5 text-xs text-gray-500">{policy.description}</p>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          policy.effect === 'allow'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {policy.effect}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
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
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-600'
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
