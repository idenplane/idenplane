import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { getServiceAccounts } from '../../api/serviceAccounts';

export default function ServiceAccountListPage() {
  const { name } = useParams<{ name: string }>();

  const { data: accounts, isLoading, error } = useQuery({
    queryKey: ['service-accounts', name],
    queryFn: () => getServiceAccounts(name!),
    enabled: !!name,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-fg">Service Accounts</h1>
        <Link
          to={`/console/realms/${name}/service-accounts/new`}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Create Service Account
        </Link>
      </div>

      {error && (
        <div role="alert" className="rounded-md bg-danger-soft p-4 text-sm text-danger-fg">
          Failed to load data: {error.message}
        </div>
      )}

      {isLoading ? (
        <div className="text-subtle">Loading service accounts...</div>
      ) : !accounts || accounts.length === 0 ? (
        <div className="rounded-md border border-line bg-surface p-8 text-center text-subtle">
          No service accounts configured.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
          <table className="min-w-full divide-y divide-line">
            <thead className="bg-sunken">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Description</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {accounts.map((account) => (
                <tr key={account.id} className="hover:bg-hover">
                  <td className="whitespace-nowrap px-6 py-4">
                    <Link
                      to={`/console/realms/${name}/service-accounts/${account.id}`}
                      className="font-medium text-accent hover:text-accent"
                    >
                      {account.name}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-sm text-subtle">
                    {account.description || '-'}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        account.enabled
                          ? 'bg-success-soft text-success-fg'
                          : 'bg-danger-soft text-danger-fg'
                      }`}
                    >
                      {account.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-subtle">
                    {new Date(account.createdAt).toLocaleDateString()}
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
