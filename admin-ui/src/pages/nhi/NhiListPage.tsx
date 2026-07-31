import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router';
import { getNhiIdentities } from '../../api/nhi';
import type { NhiIdentityType, NhiLifecycleStatus } from '../../types';

const identityTypeColors: Record<NhiIdentityType, string> = {
  IOT_DEVICE: 'bg-info-soft text-info-fg',
  AI_AGENT: 'bg-purple-100 text-purple-700',
  BOT: 'bg-warning-soft text-warning-fg',
  MACHINE_TO_MACHINE: 'bg-success-soft text-success-fg',
};

const statusColors: Record<NhiLifecycleStatus, string> = {
  PROVISIONING: 'bg-warning-soft text-warning-fg',
  ACTIVE: 'bg-success-soft text-success-fg',
  SUSPENDED: 'bg-warning-soft text-warning-fg',
  DECOMMISSIONED: 'bg-sunken text-muted',
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
        <div className="text-subtle">Loading non-human identities...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-danger-soft p-4 text-sm text-danger-fg">
        Failed to load non-human identities.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-fg">Non-Human Identities</h1>
          <p className="mt-1 text-sm text-subtle">
            Manage machine identities in <span className="font-medium">{name}</span>
          </p>
        </div>
        <button
          onClick={() => navigate(`/console/realms/${name}/nhi/new`)}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Create Identity
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
        <table className="min-w-full divide-y divide-line" aria-label="Non-Human Identities">
          <thead className="bg-sunken">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Name
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Type
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Status
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Enabled
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Certificate
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Created
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
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
                  className="cursor-pointer hover:bg-hover focus:outline-none focus:ring-2 focus:ring-inset focus:ring-accent"
                >
                  <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-accent">
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
                          ? 'bg-success-soft text-success-fg'
                          : 'bg-sunken text-muted'
                      }`}
                    >
                      {identity.enabled ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-subtle">
                    {identity.certificateFingerprint ? (
                      <span className="text-success">Active</span>
                    ) : (
                      <span className="text-subtle">None</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-subtle">
                    {new Date(identity.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-sm text-subtle">
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
