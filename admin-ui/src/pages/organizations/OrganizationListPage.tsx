import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { getOrganizations } from '../../api/organizations';

export default function OrganizationListPage() {
  const { name } = useParams<{ name: string }>();

  const { data: organizations, isLoading, error } = useQuery({
    queryKey: ['organizations', name],
    queryFn: () => getOrganizations(name!),
    enabled: !!name,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-fg">Organizations</h1>
        <Link
          to={`/console/realms/${name}/organizations/new`}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Create Organization
        </Link>
      </div>

      {error && (
        <div role="alert" className="rounded-md bg-danger-soft p-4 text-sm text-danger-fg">
          Failed to load data: {error.message}
        </div>
      )}

      {isLoading ? (
        <div className="text-subtle">Loading organizations...</div>
      ) : !organizations || organizations.length === 0 ? (
        <div className="rounded-md border border-line bg-surface p-8 text-center text-subtle">
          No organizations configured.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
          <table className="min-w-full divide-y divide-line">
            <thead className="bg-sunken">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Display Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Members</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {organizations.map((org) => (
                <tr key={org.id} className="hover:bg-hover">
                  <td className="whitespace-nowrap px-6 py-4">
                    <Link
                      to={`/console/realms/${name}/organizations/${org.slug}`}
                      className="font-medium text-accent hover:text-accent"
                    >
                      {org.name}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-sm text-subtle">
                    {org.displayName || '-'}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-subtle">
                    -
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        org.enabled
                          ? 'bg-success-soft text-success-fg'
                          : 'bg-danger-soft text-danger-fg'
                      }`}
                    >
                      {org.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-subtle">
                    {new Date(org.createdAt).toLocaleDateString()}
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
