import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router';
import { getNhiIdentities } from '../../api/nhi';
import type { NhiIdentityType, NhiLifecycleStatus } from '../../types';

const identityTypeColors: Record<NhiIdentityType, string> = {
  IOT_DEVICE: 'bg-blue-100 text-blue-700',
  AI_AGENT: 'bg-purple-100 text-purple-700',
  BOT: 'bg-amber-100 text-amber-700',
  MACHINE_TO_MACHINE: 'bg-green-100 text-green-700',
};

const statusColors: Record<NhiLifecycleStatus, string> = {
  PROVISIONING: 'bg-yellow-100 text-yellow-700',
  ACTIVE: 'bg-green-100 text-green-700',
  SUSPENDED: 'bg-orange-100 text-orange-700',
  DECOMMISSIONED: 'bg-gray-100 text-gray-700',
};

export default function NhiListPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();

  const { data: identities, isLoading, error } = useQuery({
    queryKey: ['nhi-identities', name],
    queryFn: () => getNhiIdentities(name!),
    enabled: !!name,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading non-human identities...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
        Failed to load non-human identities.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Non-Human Identities</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage machine identities in <span className="font-medium">{name}</span>
          </p>
        </div>
        <button
          onClick={() => navigate(`/console/realms/${name}/nhi/new`)}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Create Identity
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200" aria-label="Non-Human Identities">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Name
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Type
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Status
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Enabled
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Certificate
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Created
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {Array.isArray(identities) && identities.length > 0 ? (
              identities.map((identity) => (
                <tr
                  key={identity.id}
                  onClick={() => navigate(`/console/realms/${name}/nhi/${identity.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(`/console/realms/${name}/nhi/${identity.id}`);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`View identity ${identity.name}`}
                  className="cursor-pointer hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                >
                  <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-indigo-600">
                    {identity.name}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        identityTypeColors[identity.identityType]
                      }`}
                    >
                      {identity.identityType.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        statusColors[identity.lifecycleStatus]
                      }`}
                    >
                      {identity.lifecycleStatus}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        identity.enabled
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {identity.enabled ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {identity.certificateFingerprint ? (
                      <span className="text-green-600">Active</span>
                    ) : (
                      <span className="text-gray-400">None</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {new Date(identity.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500">
                  No non-human identities found in this realm.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
