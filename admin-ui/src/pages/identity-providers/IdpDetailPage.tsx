import { useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getIdentityProvider,
  updateIdentityProvider,
  deleteIdentityProvider,
} from '../../api/identityProviders';
import ConfirmDialog from '../../components/ConfirmDialog';
import PasswordInput from '../../components/PasswordInput';

export default function IdpDetailPage() {
  const { name, alias } = useParams<{ name: string; alias: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showDelete, setShowDelete] = useState(false);

  const { data: idp, isLoading } = useQuery({
    queryKey: ['identity-provider', name, alias],
    queryFn: () => getIdentityProvider(name!, alias!),
    enabled: !!name && !!alias,
  });

  const [form, setForm] = useState({
    displayName: '',
    providerType: 'oidc',
    clientId: '',
    clientSecret: '',
    authorizationUrl: '',
    tokenUrl: '',
    userinfoUrl: '',
    jwksUrl: '',
    issuer: '',
    defaultScopes: '',
    enabled: true,
    trustEmail: false,
    linkOnly: false,
    syncUserProfile: true,
  });

  // Seed the editable form from fetched data when the loaded IdP changes.
  // Adjusting state during render (vs. an effect) avoids an extra render pass.
  const [seededIdp, setSeededIdp] = useState(idp);
  if (idp && idp !== seededIdp) {
    setSeededIdp(idp);
    setForm({
      displayName: idp.displayName ?? '',
      providerType: idp.providerType,
      clientId: idp.clientId,
      clientSecret: idp.clientSecret,
      authorizationUrl: idp.authorizationUrl,
      tokenUrl: idp.tokenUrl,
      userinfoUrl: idp.userinfoUrl ?? '',
      jwksUrl: idp.jwksUrl ?? '',
      issuer: idp.issuer ?? '',
      defaultScopes: idp.defaultScopes,
      enabled: idp.enabled,
      trustEmail: idp.trustEmail,
      linkOnly: idp.linkOnly,
      syncUserProfile: idp.syncUserProfile,
    });
  }

  const updateMutation = useMutation({
    mutationFn: () =>
      updateIdentityProvider(name!, alias!, {
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
      queryClient.invalidateQueries({ queryKey: ['identity-provider', name, alias] });
      queryClient.invalidateQueries({ queryKey: ['identity-providers', name] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteIdentityProvider(name!, alias!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['identity-providers', name] });
      navigate(`/console/realms/${name}/identity-providers`);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    updateMutation.mutate();
  }

  const set = (field: string, value: string | boolean) =>
    setForm((f) => ({ ...f, [field]: value }));

  if (isLoading) {
    return <div className="text-subtle">Loading provider...</div>;
  }

  if (!idp) {
    return <div className="rounded-md bg-danger-soft p-4 text-sm text-danger-fg">Identity provider not found.</div>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-fg">{idp.alias}</h1>
          {idp.displayName && (
            <p className="mt-1 text-sm text-subtle">{idp.displayName}</p>
          )}
        </div>
        <button
          onClick={() => setShowDelete(true)}
          className="rounded-md border border-danger-soft px-4 py-2 text-sm font-medium text-danger-fg hover:bg-danger-soft"
        >
          Delete
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-line bg-surface p-6 shadow-sm">
        {/* General */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-fg">General</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="field-idp-alias" className="mb-1.5 block text-sm font-medium text-muted">Alias</label>
              <input
                id="field-idp-alias"
                type="text"
                value={idp.alias}
                disabled
                className="w-full rounded-md border border-line bg-sunken px-3 py-2 text-sm text-subtle"
              />
            </div>
            <div>
              <label htmlFor="field-idp-displayName" className="mb-1.5 block text-sm font-medium text-muted">Display Name</label>
              <input
                id="field-idp-displayName"
                type="text"
                value={form.displayName}
                onChange={(e) => set('displayName', e.target.value)}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="field-idp-providerType" className="mb-1.5 block text-sm font-medium text-muted">Provider Type</label>
              <select
                id="field-idp-providerType"
                value={form.providerType}
                onChange={(e) => set('providerType', e.target.value)}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
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
                className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
              />
              <label htmlFor="enabled" className="text-sm font-medium text-muted">
                Enabled
              </label>
            </div>
          </div>
        </div>

        {/* OIDC Configuration */}
        <div className="space-y-4 border-t border-line pt-4">
          <h2 className="text-lg font-semibold text-fg">OIDC Configuration</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="field-idp-clientId" className="mb-1.5 block text-sm font-medium text-muted">Client ID</label>
              <input
                id="field-idp-clientId"
                type="text"
                required
                value={form.clientId}
                onChange={(e) => set('clientId', e.target.value)}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="field-idp-clientSecret" className="mb-1.5 block text-sm font-medium text-muted">Client Secret</label>
              <PasswordInput
                id="field-idp-clientSecret"
                required
                value={form.clientSecret}
                onChange={(e) => set('clientSecret', e.target.value)}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="field-idp-authorizationUrl" className="mb-1.5 block text-sm font-medium text-muted">Authorization URL</label>
            <input
              id="field-idp-authorizationUrl"
              type="url"
              required
              value={form.authorizationUrl}
              onChange={(e) => set('authorizationUrl', e.target.value)}
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="field-idp-tokenUrl" className="mb-1.5 block text-sm font-medium text-muted">Token URL</label>
            <input
              id="field-idp-tokenUrl"
              type="url"
              required
              value={form.tokenUrl}
              onChange={(e) => set('tokenUrl', e.target.value)}
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="field-idp-userinfoUrl" className="mb-1.5 block text-sm font-medium text-muted">Userinfo URL</label>
              <input
                id="field-idp-userinfoUrl"
                type="url"
                value={form.userinfoUrl}
                onChange={(e) => set('userinfoUrl', e.target.value)}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="field-idp-jwksUrl" className="mb-1.5 block text-sm font-medium text-muted">JWKS URL</label>
              <input
                id="field-idp-jwksUrl"
                type="url"
                value={form.jwksUrl}
                onChange={(e) => set('jwksUrl', e.target.value)}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="field-idp-issuer" className="mb-1.5 block text-sm font-medium text-muted">Issuer</label>
              <input
                id="field-idp-issuer"
                type="text"
                value={form.issuer}
                onChange={(e) => set('issuer', e.target.value)}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="field-idp-defaultScopes" className="mb-1.5 block text-sm font-medium text-muted">Default Scopes</label>
              <input
                id="field-idp-defaultScopes"
                type="text"
                value={form.defaultScopes}
                onChange={(e) => set('defaultScopes', e.target.value)}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Behavior */}
        <div className="space-y-3 border-t border-line pt-4">
          <h2 className="text-lg font-semibold text-fg">Behavior</h2>

          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.trustEmail}
                onChange={(e) => set('trustEmail', e.target.checked)}
                className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
              />
              <span className="text-sm text-muted">Trust email from provider</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.syncUserProfile}
                onChange={(e) => set('syncUserProfile', e.target.checked)}
                className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
              />
              <span className="text-sm text-muted">Sync user profile on login</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.linkOnly}
                onChange={(e) => set('linkOnly', e.target.checked)}
                className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
              />
              <span className="text-sm text-muted">Link only (don&apos;t create new users)</span>
            </label>
          </div>
        </div>

        {updateMutation.isSuccess && (
          <div className="rounded-md bg-success-soft p-3 text-sm text-success-fg">
            Identity provider updated successfully.
          </div>
        )}
        {updateMutation.isError && (
          <div className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
            Failed to update identity provider.
          </div>
        )}

        <div className="flex justify-end border-t border-line pt-4">
          <button
            type="submit"
            disabled={updateMutation.isPending}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>

      <ConfirmDialog
        isOpen={showDelete}
        title="Delete Identity Provider"
        message={`Are you sure you want to delete identity provider "${idp.alias}"?`}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setShowDelete(false)}
      />
    </div>
  );
}
