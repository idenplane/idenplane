import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router';
import { getClients } from '../../api/clients';
import { getErrorMessage } from '../../utils/getErrorMessage';

export default function ClientListPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();

  const { data: clients, isLoading, error } = useQuery({
    queryKey: ['clients', name],
    queryFn: () => getClients(name!),
    enabled: !!name,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-subtle">Loading clients...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-danger-soft p-4 text-sm text-danger-fg">
        {getErrorMessage(error, 'Failed to load clients.')}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-fg">Clients</h1>
          <p className="mt-1 text-sm text-subtle">
            Manage clients in <span className="font-medium">{name}</span>
          </p>
        </div>
        <button
          onClick={() => navigate(`/console/realms/${name}/clients/new`)}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Create Client
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
        <table className="min-w-full divide-y divide-line" aria-label="Clients">
          <thead className="bg-sunken">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Client ID
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Name
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Type
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Enabled
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Created
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {clients && clients.length > 0 ? (
              clients.map((client) => (
                <tr
                  key={client.id}
                  onClick={() => navigate(`/console/realms/${name}/clients/${client.clientId}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(`/console/realms/${name}/clients/${client.clientId}`);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`View client ${client.name || client.clientId}`}
                  className="cursor-pointer hover:bg-hover focus:outline-none focus:ring-2 focus:ring-inset focus:ring-accent"
                >
                  <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-accent">
                    {client.clientId}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-muted">
                    {client.name || '-'}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        client.clientType === 'CONFIDENTIAL'
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-info-soft text-info-fg'
                      }`}
                    >
                      {client.clientType}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        client.enabled
                          ? 'bg-success-soft text-success-fg'
                          : 'bg-sunken text-muted'
                      }`}
                    >
                      {client.enabled ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-subtle">
                    {new Date(client.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-sm text-subtle">
                  No clients found in this realm.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
