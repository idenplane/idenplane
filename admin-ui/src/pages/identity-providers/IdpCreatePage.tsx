import { useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createIdentityProvider } from '../../api/identityProviders';
import PasswordInput from '../../components/PasswordInput';

export default function IdpCreatePage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    alias: '',
    displayName: '',
    providerType: 'oidc',
    clientId: '',
    clientSecret: '',
    authorizationUrl: '',
    tokenUrl: '',
    userinfoUrl: '',
    jwksUrl: '',
    issuer: '',
    defaultScopes: 'openid email profile',
    enabled: true,
    trustEmail: false,
    linkOnly: false,
    syncUserProfile: true,
  });

  const mutation = useMutation({
    mutationFn: () =>
      createIdentityProvider(name!, {
        alias: form.alias,
        displayName: form.displayName || undefined,
        providerType: form.providerType,
        clientId: form.clientId,
        clientSecret: form.clientSecret,
        authorizationUrl: form.authorizationUrl,
        tokenUrl: form.tokenUrl,
        userinfoUrl: form.userinfoUrl || undefined,
        jwksUrl: form.jwksUrl || undefined,
        issuer: form.issuer || undefined,
        defaultScopes: form.defaultScopes || undefined,
        enabled: form.enabled,
        trustEmail: form.trustEmail,
        linkOnly: form.linkOnly,
        syncUserProfile: form.syncUserProfile,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['identity-providers', name] });
      navigate(`/console/realms/${name}/identity-providers`);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  const set = (field: string, value: string | boolean) =>
    setForm((f) => ({ ...f, [field]: value }));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Add Identity Provider</h1>

      <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        {/* General */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">General</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="field-idp-alias" className="mb-1.5 block text-sm font-medium text-gray-700">Alias *</label>
              <input
                id="field-idp-alias"
                type="text"
                required
                pattern="^[a-z0-9-]+$"
                title="Lowercase alphanumeric with hyphens"
                value={form.alias}
                onChange={(e) => set('alias', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="field-idp-displayName" className="mb-1.5 block text-sm font-medium text-gray-700">Display Name</label>
              <input
                id="field-idp-displayName"
                type="text"
                value={form.displayName}
                onChange={(e) => set('displayName', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="field-idp-providerType" className="mb-1.5 block text-sm font-medium text-gray-700">Provider Type</label>
              <select
                id="field-idp-providerType"
                value={form.providerType}
                onChange={(e) => set('providerType', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              >
                <option value="oidc">OpenID Connect</option>
                <option value="saml">SAML</option>
                <option value="oauth2">OAuth 2.0</option>
              </select>
            </div>
            <div className="flex items-end gap-2 pb-1">
              <input
                type="checkbox"
                id="enabled"
                checked={form.enabled}
                onChange={(e) => set('enabled', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <label htmlFor="enabled" className="text-sm font-medium text-gray-700">
                Enabled
              </label>
            </div>
          </div>
        </div>

        {/* OIDC Configuration */}
        <div className="space-y-4 border-t border-gray-200 pt-4">
          <h2 className="text-lg font-semibold text-gray-900">OIDC Configuration</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="field-idp-clientId" className="mb-1.5 block text-sm font-medium text-gray-700">Client ID *</label>
              <input
                id="field-idp-clientId"
                type="text"
                required
                value={form.clientId}
                onChange={(e) => set('clientId', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="field-idp-clientSecret" className="mb-1.5 block text-sm font-medium text-gray-700">Client Secret *</label>
              <PasswordInput
                id="field-idp-clientSecret"
                required
                value={form.clientSecret}
                onChange={(e) => set('clientSecret', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="field-idp-authorizationUrl" className="mb-1.5 block text-sm font-medium text-gray-700">Authorization URL *</label>
            <input
              id="field-idp-authorizationUrl"
              type="url"
              required
              value={form.authorizationUrl}
              onChange={(e) => set('authorizationUrl', e.target.value)}
              placeholder="https://provider.com/authorize"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="field-idp-tokenUrl" className="mb-1.5 block text-sm font-medium text-gray-700">Token URL *</label>
            <input
              id="field-idp-tokenUrl"
              type="url"
              required
              value={form.tokenUrl}
              onChange={(e) => set('tokenUrl', e.target.value)}
              placeholder="https://provider.com/token"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="field-idp-userinfoUrl" className="mb-1.5 block text-sm font-medium text-gray-700">Userinfo URL</label>
              <input
                id="field-idp-userinfoUrl"
                type="url"
                value={form.userinfoUrl}
                onChange={(e) => set('userinfoUrl', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="field-idp-jwksUrl" className="mb-1.5 block text-sm font-medium text-gray-700">JWKS URL</label>
              <input
                id="field-idp-jwksUrl"
                type="url"
                value={form.jwksUrl}
                onChange={(e) => set('jwksUrl', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="field-idp-issuer" className="mb-1.5 block text-sm font-medium text-gray-700">Issuer</label>
              <input
                id="field-idp-issuer"
                type="text"
                value={form.issuer}
                onChange={(e) => set('issuer', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="field-idp-defaultScopes" className="mb-1.5 block text-sm font-medium text-gray-700">Default Scopes</label>
              <input
                id="field-idp-defaultScopes"
                type="text"
                value={form.defaultScopes}
                onChange={(e) => set('defaultScopes', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Behavior */}
        <div className="space-y-3 border-t border-gray-200 pt-4">
          <h2 className="text-lg font-semibold text-gray-900">Behavior</h2>

          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.trustEmail}
                onChange={(e) => set('trustEmail', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm text-gray-700">Trust email from provider</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.syncUserProfile}
                onChange={(e) => set('syncUserProfile', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm text-gray-700">Sync user profile on login</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.linkOnly}
                onChange={(e) => set('linkOnly', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm text-gray-700">Link only (don&apos;t create new users)</span>
            </label>
          </div>
        </div>

        {mutation.isError && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {(mutation.error as Error)?.message || 'Failed to create identity provider.'}
          </div>
        )}

        <div className="flex justify-end gap-3 border-t border-gray-200 pt-4">
          <button
            type="button"
            onClick={() => navigate(`/console/realms/${name}/identity-providers`)}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {mutation.isPending ? 'Creating...' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
