import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router';
import { getProxyApplications } from '../../api/proxyApplications';
import { getErrorMessage } from '../../utils/getErrorMessage';

export default function ProxyApplicationListPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();

  const {
    data: applications,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['proxy-applications', name],
    queryFn: () => getProxyApplications(name!),
    enabled: !!name,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-subtle">Loading proxy applications...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-danger-soft p-4 text-sm text-danger-fg">
        {getErrorMessage(error, 'Failed to load proxy applications.')}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-fg">Proxy Applications</h1>
          <p className="mt-1 text-sm text-subtle">
            Applications protected at the reverse proxy in{' '}
            <span className="font-medium">{name}</span> — no code change needed
            in the application itself
          </p>
        </div>
        <button
          onClick={() =>
            navigate(`/console/realms/${name}/proxy-applications/new`)
          }
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Add Application
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
        <table
          className="min-w-full divide-y divide-line"
          aria-label="Proxy applications"
        >
          <thead className="bg-sunken">
            <tr>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle"
              >
                Slug
              </th>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle"
              >
                Name
              </th>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle"
              >
                Cookie Domain
              </th>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle"
              >
                Enabled
              </th>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle"
              >
                Callback
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {applications && applications.length > 0 ? (
              applications.map(
                ({ application, callbackRegistered }) => (
                  <tr
                    key={application.id}
                    onClick={() =>
                      navigate(
                        `/console/realms/${name}/proxy-applications/${application.slug}`,
                      )
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigate(
                          `/console/realms/${name}/proxy-applications/${application.slug}`,
                        );
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`View proxy application ${application.name || application.slug}`}
                    className="cursor-pointer hover:bg-hover focus:outline-none focus:ring-2 focus:ring-inset focus:ring-accent"
                  >
                    <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-accent">
                      {application.slug}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-muted">
                      {application.name || '-'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-muted">
                      {application.cookieDomain}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          application.enabled
                            ? 'bg-success-soft text-success-fg'
                            : 'bg-danger-soft text-danger-fg'
                        }`}
                      >
                        {application.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                    {/*
                      Surfaced in the list, not just on the detail page: an
                      unregistered callback means login fails at the very last
                      step, and an admin should be able to see that at a glance
                      rather than after a user reports it.
                    */}
                    <td className="whitespace-nowrap px-6 py-4 text-sm">
                      {callbackRegistered ? (
                        <span className="inline-flex rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success-fg">
                          Registered
                        </span>
                      ) : (
                        <span
                          className="inline-flex rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning-fg"
                          title="The callback URL is not in the OAuth client's redirect URIs. Logins will fail."
                        >
                          Not registered
                        </span>
                      )}
                    </td>
                  </tr>
                ),
              )
            ) : (
              <tr>
                <td
                  colSpan={5}
                  className="px-6 py-12 text-center text-sm text-subtle"
                >
                  No proxy applications yet. Add one to protect an app behind
                  Traefik, nginx or Caddy without changing its code.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
