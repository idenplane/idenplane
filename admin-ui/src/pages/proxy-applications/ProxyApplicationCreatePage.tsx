import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router';
import { createProxyApplication } from '../../api/proxyApplications';
import { getClients } from '../../api/clients';
import { getErrorMessage } from '../../utils/getErrorMessage';
import { suggestCookieDomain } from '../../utils/suggestCookieDomain';

export default function ProxyApplicationCreatePage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [slug, setSlug] = useState('');
  const [appName, setAppName] = useState('');
  const [clientId, setClientId] = useState('');
  const [redirectUris, setRedirectUris] = useState('');
  const [cookieDomain, setCookieDomain] = useState('');
  const [cookieDomainTouched, setCookieDomainTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: clients } = useQuery({
    queryKey: ['clients', name],
    queryFn: () => getClients(name!),
    enabled: !!name,
  });

  const mutation = useMutation({
    mutationFn: () =>
      createProxyApplication(name!, {
        slug,
        name: appName,
        clientId,
        allowedRedirectUris: redirectUris
          .split('\n')
          .map((u) => u.trim())
          .filter(Boolean),
        cookieDomain,
      }),
    onSuccess: (view) => {
      void queryClient.invalidateQueries({
        queryKey: ['proxy-applications', name],
      });
      navigate(
        `/console/realms/${name}/proxy-applications/${view.application.slug}`,
      );
    },
    onError: (e) =>
      setError(getErrorMessage(e, 'Failed to create proxy application.')),
  });

  /** Fill the cookie domain from the first redirect URI until the admin edits it themselves. */
  function handleRedirectUrisChange(value: string) {
    setRedirectUris(value);
    if (cookieDomainTouched) return;

    const first = value.split('\n')[0]?.trim();
    if (first) setCookieDomain(suggestCookieDomain(first));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    mutation.mutate();
  }

  const field =
    'mt-1 block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-fg shadow-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent';
  const label = 'block text-sm font-medium text-fg';
  const hint = 'mt-1 text-xs text-subtle';

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-fg">Add Proxy Application</h1>
        <p className="mt-1 text-sm text-subtle">
          Protect an application at Traefik, nginx or Caddy without changing its
          code
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-6 rounded-md bg-danger-soft p-4 text-sm text-danger-fg"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="slug" className={label}>
            Slug
          </label>
          <input
            id="slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
            pattern="[a-z0-9][a-z0-9-]*"
            placeholder="grafana"
            className={field}
          />
          <p className={hint}>
            Used in the proxy endpoints:{' '}
            <code>
              /realms/{name}/proxy/{slug || '<slug>'}/verify
            </code>
            . Cannot be changed later — it lives in your proxy config.
          </p>
        </div>

        <div>
          <label htmlFor="app-name" className={label}>
            Name
          </label>
          <input
            id="app-name"
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
            required
            placeholder="Grafana"
            className={field}
          />
        </div>

        <div>
          <label htmlFor="client-id" className={label}>
            OAuth Client
          </label>
          <select
            id="client-id"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            required
            className={field}
          >
            <option value="">Select a client...</option>
            {clients?.map((c) => (
              <option key={c.id} value={c.clientId}>
                {c.clientId}
                {c.name ? ` — ${c.name}` : ''}
              </option>
            ))}
          </select>
          <p className={hint}>
            Login runs through this client, so MFA, step-up and consent apply
            exactly as they do anywhere else. Its redirect URIs must include the
            callback URL shown after you save.
          </p>
        </div>

        <div>
          <label htmlFor="redirect-uris" className={label}>
            Allowed Redirect URIs
          </label>
          <textarea
            id="redirect-uris"
            value={redirectUris}
            onChange={(e) => handleRedirectUrisChange(e.target.value)}
            required
            rows={3}
            placeholder={'https://grafana.example.com/*'}
            className={`${field} font-mono`}
          />
          <p className={hint}>
            One per line. A user is only ever sent back to a URL matching one of
            these. Supports a trailing <code>/*</code> wildcard.
          </p>
        </div>

        <div>
          <label htmlFor="cookie-domain" className={label}>
            Cookie Domain
          </label>
          <input
            id="cookie-domain"
            value={cookieDomain}
            onChange={(e) => {
              setCookieDomainTouched(true);
              setCookieDomain(e.target.value);
            }}
            required
            placeholder=".example.com"
            className={field}
          />
          <p className={hint}>
            Must be a parent domain of every host above, or the browser will
            never send the session cookie to the application — which looks like
            an endless redirect to login. Suggested from your first redirect
            URI.
          </p>
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {mutation.isPending ? 'Creating...' : 'Create Application'}
          </button>
          <button
            type="button"
            onClick={() =>
              navigate(`/console/realms/${name}/proxy-applications`)
            }
            className="rounded-md border border-line px-4 py-2 text-sm font-medium text-fg hover:bg-hover"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
