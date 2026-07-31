import { useState, useEffect } from 'react';
import { useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getScimStatus,
  getScimTokens,
  createScimToken,
  deleteScimToken,
  revokeScimToken,
  enableScimToken,
  disableScimToken,
  getScimAttributeMappings,
  createScimAttributeMapping,
  deleteScimAttributeMapping,
} from '../../api/scim';
import type { ScimTokenCreateResult } from '../../api/scim';
import { getRealmByName, updateRealm } from '../../api/realms';
import ConfirmDialog from '../../components/ConfirmDialog';
import { getErrorMessage } from '../../utils/getErrorMessage';

const SCIM_SCOPES = ['users:read', 'users:write', 'groups:read', 'groups:write'];

export default function ScimConfigPage() {
  const { name } = useParams<{ name: string }>();
  const queryClient = useQueryClient();

  const [scimEnabledToggle, setScimEnabledToggle] = useState(false);
  const [scimUserAutocreate, setScimUserAutocreate] = useState(true);
  const [scimGroupSyncEnabled, setScimGroupSyncEnabled] = useState(true);

  const [showCreateToken, setShowCreateToken] = useState(false);
  const [tokenForm, setTokenForm] = useState({
    name: '',
    description: '',
    expiresAt: '',
    scopes: [] as string[],
  });
  const [newPlainToken, setNewPlainToken] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [deleteTokenTarget, setDeleteTokenTarget] = useState<string | null>(null);

  const [mappingForm, setMappingForm] = useState({
    resourceType: 'User',
    scimAttribute: '',
    idenplaneAttribute: '',
    direction: 'inbound',
  });
  const [deleteMappingTarget, setDeleteMappingTarget] = useState<string | null>(null);

  const { data: realm } = useQuery({
    queryKey: ['realm', name],
    queryFn: () => getRealmByName(name!),
    enabled: !!name,
  });

  useEffect(() => {
    if (realm !== undefined) {
      setScimEnabledToggle(realm.scimEnabled ?? false);
      setScimUserAutocreate(realm.scimUserAutocreate ?? true);
      setScimGroupSyncEnabled(realm.scimGroupSyncEnabled ?? true);
    }
  }, [realm]);

  const updateRealmMutation = useMutation({
    mutationFn: (payload: { scimEnabled: boolean; scimUserAutocreate: boolean; scimGroupSyncEnabled: boolean }) =>
      updateRealm(name!, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['realm', name] });
      queryClient.invalidateQueries({ queryKey: ['scim-status', name] });
    },
  });

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['scim-status', name],
    queryFn: () => getScimStatus(name!),
    enabled: !!name,
  });

  const { data: tokens, isLoading: tokensLoading, error: tokensError } = useQuery({
    queryKey: ['scim-tokens', name],
    queryFn: () => getScimTokens(name!),
    enabled: !!name,
  });

  const { data: mappings, isLoading: mappingsLoading, error: mappingsError } = useQuery({
    queryKey: ['scim-mappings', name],
    queryFn: () => getScimAttributeMappings(name!),
    enabled: !!name,
  });

  const createTokenMutation = useMutation({
    mutationFn: () =>
      createScimToken(name!, {
        name: tokenForm.name,
        description: tokenForm.description || undefined,
        expiresAt: tokenForm.expiresAt || undefined,
        scopes: tokenForm.scopes.length > 0 ? tokenForm.scopes : undefined,
      }),
    onSuccess: (result: ScimTokenCreateResult) => {
      queryClient.invalidateQueries({ queryKey: ['scim-tokens', name] });
      queryClient.invalidateQueries({ queryKey: ['scim-status', name] });
      setNewPlainToken(result.plainToken);
      setTokenForm({ name: '', description: '', expiresAt: '', scopes: [] });
      setShowCreateToken(false);
    },
  });

  const deleteTokenMutation = useMutation({
    mutationFn: (tokenId: string) => deleteScimToken(name!, tokenId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scim-tokens', name] });
      queryClient.invalidateQueries({ queryKey: ['scim-status', name] });
      setDeleteTokenTarget(null);
    },
  });

  const revokeTokenMutation = useMutation({
    mutationFn: (tokenId: string) => revokeScimToken(name!, tokenId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scim-tokens', name] }),
  });

  const enableTokenMutation = useMutation({
    mutationFn: (tokenId: string) => enableScimToken(name!, tokenId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scim-tokens', name] }),
  });

  const disableTokenMutation = useMutation({
    mutationFn: (tokenId: string) => disableScimToken(name!, tokenId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scim-tokens', name] }),
  });

  const createMappingMutation = useMutation({
    mutationFn: () =>
      createScimAttributeMapping(name!, {
        resourceType: mappingForm.resourceType,
        scimAttribute: mappingForm.scimAttribute,
        idenplaneAttribute: mappingForm.idenplaneAttribute,
        direction: mappingForm.direction,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scim-mappings', name] });
      setMappingForm({ resourceType: 'User', scimAttribute: '', idenplaneAttribute: '', direction: 'inbound' });
    },
  });

  const deleteMappingMutation = useMutation({
    mutationFn: (mappingId: string) => deleteScimAttributeMapping(name!, mappingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scim-mappings', name] });
      setDeleteMappingTarget(null);
    },
  });

  function toggleScope(scope: string) {
    setTokenForm((prev) => ({
      ...prev,
      scopes: prev.scopes.includes(scope)
        ? prev.scopes.filter((s) => s !== scope)
        : [...prev.scopes, scope],
    }));
  }

  async function copyToken(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 2000);
    } catch {
      // clipboard may not be available in non-secure contexts
    }
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-fg">SCIM Configuration</h1>

      {/* Status card */}
      <section className="rounded-lg border border-line bg-surface p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-fg">Status</h2>

        {/* SCIM Provisioning toggle */}
        <div className="mb-6 rounded-md border border-line bg-sunken p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-fg">SCIM Provisioning</p>
              <p className="mt-0.5 text-xs text-subtle">
                When disabled, all SCIM endpoints for this realm return 403.
              </p>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={scimEnabledToggle}
                onChange={(e) => setScimEnabledToggle(e.target.checked)}
              />
              <div className="peer h-6 w-11 rounded-full bg-active after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-line-strong after:bg-surface after:transition-all after:content-[''] peer-checked:bg-accent peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-accent peer-focus:ring-offset-2" />
            </label>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => updateRealmMutation.mutate({ scimEnabled: scimEnabledToggle, scimUserAutocreate, scimGroupSyncEnabled })}
              disabled={updateRealmMutation.isPending}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {updateRealmMutation.isPending ? 'Saving...' : 'Save'}
            </button>
            {updateRealmMutation.isSuccess && (
              <span className="text-xs text-success">Saved.</span>
            )}
            {updateRealmMutation.isError && (
              <span className="text-xs text-danger">
                {getErrorMessage(updateRealmMutation.error, 'Failed to save.')}
              </span>
            )}
          </div>
        </div>

        {statusLoading ? (
          <div className="text-sm text-subtle">Loading status...</div>
        ) : status ? (
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-subtle">Active Tokens</dt>
              <dd className="mt-1 text-sm font-medium text-fg">{status.activeTokens}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-subtle">User Autocreate</dt>
              <dd className="mt-1 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="scimUserAutocreate"
                  checked={scimUserAutocreate}
                  onChange={(e) => setScimUserAutocreate(e.target.checked)}
                  className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
                />
                <label htmlFor="scimUserAutocreate" className="text-sm text-muted">
                  {scimUserAutocreate ? 'On' : 'Off'}
                </label>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-subtle">Group Sync</dt>
              <dd className="mt-1 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="scimGroupSyncEnabled"
                  checked={scimGroupSyncEnabled}
                  onChange={(e) => setScimGroupSyncEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
                />
                <label htmlFor="scimGroupSyncEnabled" className="text-sm text-muted">
                  {scimGroupSyncEnabled ? 'Enabled' : 'Disabled'}
                </label>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-subtle">Total Users</dt>
              <dd className="mt-1 text-sm font-medium text-fg">{status.totalUsers}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-subtle">Total Groups</dt>
              <dd className="mt-1 text-sm font-medium text-fg">{status.totalGroups}</dd>
            </div>
          </dl>
        ) : null}
      </section>

      {/* Tokens section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-fg">Tokens</h2>
          <button
            onClick={() => setShowCreateToken(true)}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            Create Token
          </button>
        </div>

        {newPlainToken && (
          <div className="rounded-md bg-warning-soft border border-warning-soft p-4">
            <p className="mb-2 text-sm font-medium text-warning-fg">
              Token created — copy it now. It will not be shown again.
            </p>
            <div className="flex items-center gap-3">
              <code className="flex-1 rounded bg-warning-soft px-3 py-2 font-mono text-sm text-yellow-900 break-all">
                {newPlainToken}
              </code>
              <button
                onClick={() => copyToken(newPlainToken)}
                className="shrink-0 rounded-md border border-warning-soft bg-warning-soft px-3 py-2 text-sm font-medium text-warning-fg hover:bg-yellow-200"
              >
                {tokenCopied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <button
              onClick={() => setNewPlainToken(null)}
              className="mt-3 text-xs text-warning hover:text-warning-fg"
            >
              Dismiss
            </button>
          </div>
        )}

        {showCreateToken && (
          <form
            onSubmit={(e) => { e.preventDefault(); createTokenMutation.mutate(); }}
            className="rounded-lg border border-line bg-surface p-6 shadow-sm space-y-4"
          >
            <h3 className="text-base font-semibold text-fg">New Token</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="token-name" className="mb-1.5 block text-sm font-medium text-muted">Name</label>
                <input
                  id="token-name"
                  type="text"
                  required
                  value={tokenForm.name}
                  onChange={(e) => setTokenForm({ ...tokenForm, name: e.target.value })}
                  placeholder="e.g. Okta SCIM"
                  className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="token-description" className="mb-1.5 block text-sm font-medium text-muted">Description</label>
                <input
                  id="token-description"
                  type="text"
                  value={tokenForm.description}
                  onChange={(e) => setTokenForm({ ...tokenForm, description: e.target.value })}
                  className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label htmlFor="token-expires" className="mb-1.5 block text-sm font-medium text-muted">Expires At (optional)</label>
              <input
                id="token-expires"
                type="date"
                value={tokenForm.expiresAt}
                onChange={(e) => setTokenForm({ ...tokenForm, expiresAt: e.target.value })}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-muted">Scopes</p>
              <div className="flex flex-wrap gap-4">
                {SCIM_SCOPES.map((scope) => (
                  <label key={scope} className="flex cursor-pointer items-center gap-2 text-sm text-muted">
                    <input
                      type="checkbox"
                      checked={tokenForm.scopes.includes(scope)}
                      onChange={() => toggleScope(scope)}
                      className="rounded border-line-strong text-accent focus:ring-accent"
                    />
                    {scope}
                  </label>
                ))}
              </div>
            </div>

            {createTokenMutation.isError && (
              <div className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
                {getErrorMessage(createTokenMutation.error, 'Failed to create token.')}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowCreateToken(false)}
                className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-muted hover:bg-hover"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createTokenMutation.isPending}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {createTokenMutation.isPending ? 'Creating...' : 'Create'}
              </button>
            </div>
          </form>
        )}

        {tokensError && (
          <div role="alert" className="rounded-md bg-danger-soft p-4 text-sm text-danger-fg">
            {getErrorMessage(tokensError, 'Failed to load tokens.')}
          </div>
        )}

        {tokensLoading ? (
          <div className="text-sm text-subtle">Loading tokens...</div>
        ) : !tokens || tokens.length === 0 ? (
          <div className="rounded-md border border-line bg-surface p-8 text-center text-sm text-subtle">
            No SCIM tokens created.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
            <table className="min-w-full divide-y divide-line">
              <thead className="bg-sunken">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Prefix</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Enabled</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Expires</th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-subtle">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {tokens.map((token) => (
                  <tr key={token.id} className="hover:bg-hover">
                    <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-fg">
                      {token.name}
                      {token.revoked && (
                        <span className="ml-2 inline-flex rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger-fg">Revoked</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <code className="font-mono text-xs text-muted">{token.tokenPrefix}…</code>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${token.enabled ? 'bg-success-soft text-success-fg' : 'bg-sunken text-muted'}`}>
                        {token.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-subtle">
                      {token.expiresAt ? new Date(token.expiresAt).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right text-sm">
                      {token.enabled ? (
                        <button
                          onClick={() => disableTokenMutation.mutate(token.id)}
                          className="mr-3 font-medium text-muted hover:text-fg"
                        >
                          Disable
                        </button>
                      ) : (
                        <button
                          onClick={() => enableTokenMutation.mutate(token.id)}
                          className="mr-3 font-medium text-accent hover:text-accent"
                        >
                          Enable
                        </button>
                      )}
                      {!token.revoked && (
                        <button
                          onClick={() => revokeTokenMutation.mutate(token.id)}
                          className="mr-3 font-medium text-warning hover:text-warning-fg"
                        >
                          Revoke
                        </button>
                      )}
                      <button
                        onClick={() => setDeleteTokenTarget(token.id)}
                        className="font-medium text-danger hover:text-danger-fg"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Attribute Mappings section */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-fg">Attribute Mappings</h2>

        <form
          onSubmit={(e) => { e.preventDefault(); createMappingMutation.mutate(); }}
          className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4 shadow-sm"
        >
          <div>
            <label htmlFor="mapping-resource-type" className="mb-1.5 block text-sm font-medium text-muted">Resource Type</label>
            <select
              id="mapping-resource-type"
              value={mappingForm.resourceType}
              onChange={(e) => setMappingForm({ ...mappingForm, resourceType: e.target.value })}
              className="rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            >
              <option value="User">User</option>
              <option value="Group">Group</option>
            </select>
          </div>
          <div>
            <label htmlFor="mapping-scim-attr" className="mb-1.5 block text-sm font-medium text-muted">SCIM Attribute</label>
            <input
              id="mapping-scim-attr"
              type="text"
              required
              value={mappingForm.scimAttribute}
              onChange={(e) => setMappingForm({ ...mappingForm, scimAttribute: e.target.value })}
              placeholder="e.g. userName"
              className="rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="mapping-user-attr" className="mb-1.5 block text-sm font-medium text-muted">Idenplane Attribute</label>
            <input
              id="mapping-user-attr"
              type="text"
              required
              value={mappingForm.idenplaneAttribute}
              onChange={(e) => setMappingForm({ ...mappingForm, idenplaneAttribute: e.target.value })}
              placeholder="e.g. username"
              className="rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="mapping-direction" className="mb-1.5 block text-sm font-medium text-muted">Direction</label>
            <select
              id="mapping-direction"
              value={mappingForm.direction}
              onChange={(e) => setMappingForm({ ...mappingForm, direction: e.target.value })}
              className="rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            >
              <option value="inbound">Inbound</option>
              <option value="outbound">Outbound</option>
              <option value="bidirectional">Bidirectional</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={createMappingMutation.isPending}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            Add
          </button>
        </form>

        {createMappingMutation.isError && (
          <div className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
            {getErrorMessage(createMappingMutation.error, 'Failed to add mapping.')}
          </div>
        )}

        {mappingsError && (
          <div role="alert" className="rounded-md bg-danger-soft p-4 text-sm text-danger-fg">
            {getErrorMessage(mappingsError, 'Failed to load attribute mappings.')}
          </div>
        )}

        {mappingsLoading ? (
          <div className="text-sm text-subtle">Loading mappings...</div>
        ) : !mappings || mappings.length === 0 ? (
          <div className="rounded-md border border-line bg-surface p-8 text-center text-sm text-subtle">
            No custom attribute mappings.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
            <table className="min-w-full divide-y divide-line">
              <thead className="bg-sunken">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Resource Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">SCIM Attribute</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Idenplane Attribute</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Direction</th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-subtle">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {mappings.map((mapping) => (
                  <tr key={mapping.id} className="hover:bg-hover">
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-muted">{mapping.resourceType}</td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-fg">{mapping.scimAttribute}</td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-muted">{mapping.idenplaneAttribute}</td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-subtle">{mapping.direction}</td>
                    <td className="whitespace-nowrap px-6 py-4 text-right">
                      <button
                        onClick={() => setDeleteMappingTarget(mapping.id)}
                        className="text-sm font-medium text-danger hover:text-danger-fg"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmDialog
        isOpen={!!deleteTokenTarget}
        title="Delete SCIM Token"
        message="Are you sure you want to delete this token? Any clients using it will lose access immediately."
        onConfirm={() => deleteTokenTarget && deleteTokenMutation.mutate(deleteTokenTarget)}
        onCancel={() => setDeleteTokenTarget(null)}
      />

      <ConfirmDialog
        isOpen={!!deleteMappingTarget}
        title="Delete Attribute Mapping"
        message="Are you sure you want to remove this attribute mapping?"
        onConfirm={() => deleteMappingTarget && deleteMappingMutation.mutate(deleteMappingTarget)}
        onCancel={() => setDeleteMappingTarget(null)}
      />
    </div>
  );
}
