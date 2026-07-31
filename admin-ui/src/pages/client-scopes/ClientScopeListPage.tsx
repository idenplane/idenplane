import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router';
import type { ClientScope } from '../../types';
import { getClientScopes } from '../../api/clientScopes';

export default function ClientScopeListPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();

  const { data: clientScopes, isLoading, error } = useQuery({
    queryKey: ['clientScopes', name],
    queryFn: () => getClientScopes(name!),
    enabled: !!name,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-subtle">Loading client scopes...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-danger-soft p-4 text-sm text-danger-fg">
        Failed to load client scopes.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-fg">Client Scopes</h1>
          <p className="mt-1 text-sm text-subtle">
            Manage client scopes in <span className="font-medium">{name}</span>
          </p>
        </div>
        <button
          onClick={() => navigate(`/console/realms/${name}/client-scopes/create`)}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Create Client Scope
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
        <table className="min-w-full divide-y divide-line">
          <thead className="bg-sunken">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Description
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Protocol
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Built-in
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Created
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {clientScopes && clientScopes.length > 0 ? (
              clientScopes.map((scope: ClientScope) => (
                <tr
                  key={scope.id}
                  onClick={() => navigate(`/console/realms/${name}/client-scopes/${scope.id}`)}
                  className="cursor-pointer hover:bg-hover"
                >
                  <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-accent">
                    {scope.name}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-muted">
                    {scope.description || '-'}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-muted">
                    {scope.protocol}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        scope.builtIn
                          ? 'bg-success-soft text-success-fg'
                          : 'bg-sunken text-muted'
                      }`}
                    >
                      {scope.builtIn ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-subtle">
                    {new Date(scope.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-sm text-subtle">
                  No client scopes found in this realm.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
