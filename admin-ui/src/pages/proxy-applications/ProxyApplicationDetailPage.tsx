import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router';
import {
  getProxyApplication,
  updateProxyApplication,
  deleteProxyApplication,
  revokeProxyApplicationSessions,
} from '../../api/proxyApplications';
import { getErrorMessage } from '../../utils/getErrorMessage';

export default function ProxyApplicationDetailPage() {
  const { name, slug } = useParams<{ name: string; slug: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['proxy-application', name, slug],
    queryFn: () => getProxyApplication(name!, slug!),
    enabled: !!name && !!slug,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: ['proxy-application', name, slug],
    });
    void queryClient.invalidateQueries({
      queryKey: ['proxy-applications', name],
    });
  };

  const toggleEnabled = useMutation({
    mutationFn: (enabled: boolean) =>
      updateProxyApplication(name!, slug!, { enabled }),
    onSuccess: invalidate,
    onError: (e) => setError(getErrorMessage(e, 'Failed to update.')),
  });

  const revoke = useMutation({
    mutationFn: () => revokeProxyApplicationSessions(name!, slug!),
    onSuccess: ({ revoked }) =>
      setMessage(
        `Revoked ${revoked} session${revoked === 1 ? '' : 's'}. Users will be sent back through login on their next request.`,
      ),
    onError: (e) => setError(getErrorMessage(e, 'Failed to revoke sessions.')),
  });

  const remove = useMutation({
    mutationFn: () => deleteProxyApplication(name!, slug!),
    onSuccess: () => {
      invalidate();
      navigate(`/console/realms/${name}/proxy-applications`);
    },
    onError: (e) => setError(getErrorMessage(e, 'Failed to delete.')),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-subtle">Loading...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-md bg-danger-soft p-4 text-sm text-danger-fg">
        Proxy application not found.
      </div>
    );
  }

  const { application, callbackUrl, callbackRegistered } = data;
  const verifyUrl = `/realms/${name}/proxy/${application.slug}/verify`;
  const card = 'rounded-lg border border-line bg-surface p-6 shadow-sm';
  const dt = 'text-xs font-medium uppercase tracking-wider text-subtle';
  const dd = 'mt-1 text-sm text-fg';

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-fg">{application.name}</h1>
          <p className="mt-1 font-mono text-sm text-subtle">
            {application.slug}
          </p>
        </div>
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
            application.enabled
              ? 'bg-success-soft text-success-fg'
              : 'bg-danger-soft text-danger-fg'
          }`}
        >
          {application.enabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md bg-danger-soft p-4 text-sm text-danger-fg"
        >
          {error}
        </div>
      )}
      {message && (
        <div
          role="status"
          className="rounded-md bg-success-soft p-4 text-sm text-success-fg"
        >
          {message}
        </div>
      )}

      {/*
        The one thing on this page that silently breaks a deployment. The
        callback is only reachable if it is registered on the OAuth client, and
        the symptom of forgetting is a redirect_uri mismatch at the very end of
        a login the user has already completed — so it gets a warning banner,
        not a green tick hidden in a table.
      */}
      {!callbackRegistered && (
        <div
          role="alert"
          className="rounded-md bg-warning-soft p-4 text-sm text-warning-fg"
        >
          <p className="font-medium">Callback URL is not registered</p>
          <p className="mt-1">
            Add this to the redirect URIs of client{' '}
            <code className="font-mono">{application.clientId}</code>, or logins
            will fail at the final redirect:
          </p>
          <code className="mt-2 block break-all font-mono text-xs">
            {callbackUrl}
          </code>
        </div>
      )}

      <div className={card}>
        <h2 className="mb-4 text-lg font-semibold text-fg">
          Proxy configuration
        </h2>
        <dl className="space-y-4">
          <div>
            <dt className={dt}>Forward-auth endpoint</dt>
            <dd className={`${dd} break-all font-mono text-xs`}>{verifyUrl}</dd>
            <p className="mt-1 text-xs text-subtle">
              Point your proxy's forward-auth / <code>auth_request</code> at
              this path.
            </p>
          </div>
          <div>
            <dt className={dt}>Callback URL</dt>
            <dd className={`${dd} break-all font-mono text-xs`}>
              {callbackUrl}{' '}
              {callbackRegistered && (
                <span className="ml-1 inline-flex rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success-fg">
                  Registered
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className={dt}>OAuth client</dt>
            <dd className={dd}>{application.clientId}</dd>
          </div>
          <div>
            <dt className={dt}>Cookie domain</dt>
            <dd className={dd}>{application.cookieDomain}</dd>
          </div>
          <div>
            <dt className={dt}>Session lifetime</dt>
            <dd className={dd}>
              {Math.round(application.cookieTtl / 3600)} hours
            </dd>
          </div>
          <div>
            <dt className={dt}>Allowed redirect URIs</dt>
            <dd className={dd}>
              <ul className="space-y-1 font-mono text-xs">
                {application.allowedRedirectUris.map((uri) => (
                  <li key={uri} className="break-all">
                    {uri}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        </dl>
      </div>

      <div className={card}>
        <h2 className="mb-1 text-lg font-semibold text-fg">
          Identity headers
        </h2>
        <p className="mb-4 text-sm text-subtle">
          Set on every successful check. Configure your proxy to copy these from
          the auth response to the upstream request — and to strip any the
          client sent itself.
        </p>
        <dl className="space-y-3 font-mono text-xs">
          <div>
            <dt className={dt}>User</dt>
            <dd className={dd}>{application.userHeader}</dd>
          </div>
          <div>
            <dt className={dt}>Email</dt>
            <dd className={dd}>{application.emailHeader}</dd>
          </div>
          <div>
            <dt className={dt}>Display name</dt>
            <dd className={dd}>{application.nameHeader}</dd>
          </div>
          <div>
            <dt className={dt}>Groups</dt>
            <dd className={dd}>{application.groupsHeader}</dd>
          </div>
        </dl>
      </div>

      <div className={card}>
        <h2 className="mb-4 text-lg font-semibold text-fg">Actions</h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => toggleEnabled.mutate(!application.enabled)}
            disabled={toggleEnabled.isPending}
            className="rounded-md border border-line px-4 py-2 text-sm font-medium text-fg hover:bg-hover disabled:opacity-50"
          >
            {application.enabled ? 'Disable' : 'Enable'}
          </button>
          <button
            onClick={() => revoke.mutate()}
            disabled={revoke.isPending}
            className="rounded-md border border-line px-4 py-2 text-sm font-medium text-fg hover:bg-hover disabled:opacity-50"
          >
            {revoke.isPending ? 'Revoking...' : 'Revoke all sessions'}
          </button>
          <button
            onClick={() => {
              if (
                window.confirm(
                  `Delete "${application.name}"? Its live sessions are deleted with it, and your proxy will start getting 404s from ${verifyUrl}.`,
                )
              ) {
                remove.mutate();
              }
            }}
            disabled={remove.isPending}
            className="rounded-md bg-danger-soft px-4 py-2 text-sm font-medium text-danger-fg hover:opacity-80 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
