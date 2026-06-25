import { useState } from 'react';
import { useParams } from 'react-router-dom';
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
import ConfirmDialog from '../../components/ConfirmDialog';
import { getErrorMessage } from '../../utils/getErrorMessage';

const SCIM_SCOPES = ['users:read', 'users:write', 'groups:read', 'groups:write'];

export default function ScimConfigPage() {
  const { name } = useParams<{ name: string }>();
  const queryClient = useQueryClient();

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
      <h1 className="text-2xl font-bold text-gray-900">SCIM Configuration</h1>

      {/* Status card */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Status</h2>
        {statusLoading ? (
          <div className="text-sm text-gray-500">Loading status...</div>
        ) : status ? (
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-gray-500">SCIM Enabled</dt>
              <dd className="mt-1">
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${status.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}
                >
                  {status.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-gray-500">Active Tokens</dt>
              <dd className="mt-1 text-sm font-medium text-gray-900">{status.activeTokens}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-gray-500">User Autocreate</dt>
              <dd className="mt-1">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${status.userAutocreate ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                  {status.userAutocreate ? 'On' : 'Off'}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-gray-500">Group Sync</dt>
              <dd className="mt-1">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${status.groupSyncEnabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                  {status.groupSyncEnabled ? 'Enabled' : 'Disabled'}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-gray-500">Total Users</dt>
              <dd className="mt-1 text-sm font-medium text-gray-900">{status.totalUsers}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-gray-500">Total Groups</dt>
              <dd className="mt-1 text-sm font-medium text-gray-900">{status.totalGroups}</dd>
            </div>
          </dl>
        ) : null}
      </section>

      {/* Tokens section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Tokens</h2>
          <button
            onClick={() => setShowCreateToken(true)}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Create Token
          </button>
        </div>

        {newPlainToken && (
          <div className="rounded-md bg-yellow-50 border border-yellow-200 p-4">
            <p className="mb-2 text-sm font-medium text-yellow-800">
              Token created — copy it now. It will not be shown again.
            </p>
            <div className="flex items-center gap-3">
              <code className="flex-1 rounded bg-yellow-100 px-3 py-2 font-mono text-sm text-yellow-900 break-all">
                {newPlainToken}
              </code>
              <button
                onClick={() => copyToken(newPlainToken)}
                className="shrink-0 rounded-md border border-yellow-300 bg-yellow-100 px-3 py-2 text-sm font-medium text-yellow-800 hover:bg-yellow-200"
              >
                {tokenCopied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <button
              onClick={() => setNewPlainToken(null)}
              className="mt-3 text-xs text-yellow-600 hover:text-yellow-800"
            >
              Dismiss
            </button>
          </div>
        )}

        {showCreateToken && (
          <form
            onSubmit={(e) => { e.preventDefault(); createTokenMutation.mutate(); }}
            className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4"
          >
            <h3 className="text-base font-semibold text-gray-900">New Token</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="token-name" className="mb-1.5 block text-sm font-medium text-gray-700">Name</label>
                <input
                  id="token-name"
                  type="text"
                  required
                  value={tokenForm.name}
                  onChange={(e) => setTokenForm({ ...tokenForm, name: e.target.value })}
                  placeholder="e.g. Okta SCIM"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="token-description" className="mb-1.5 block text-sm font-medium text-gray-700">Description</label>
                <input
                  id="token-description"
                  type="text"
                  value={tokenForm.description}
                  onChange={(e) => setTokenForm({ ...tokenForm, description: e.target.value })}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label htmlFor="token-expires" className="mb-1.5 block text-sm font-medium text-gray-700">Expires At (optional)</label>
              <input
                id="token-expires"
                type="date"
                value={tokenForm.expiresAt}
                onChange={(e) => setTokenForm({ ...tokenForm, expiresAt: e.target.value })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-gray-700">Scopes</p>
              <div className="flex flex-wrap gap-4">
                {SCIM_SCOPES.map((scope) => (
                  <label key={scope} className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={tokenForm.scopes.includes(scope)}
                      onChange={() => toggleScope(scope)}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    {scope}
                  </label>
                ))}
              </div>
            </div>

            {createTokenMutation.isError && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
                {getErrorMessage(createTokenMutation.error, 'Failed to create token.')}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowCreateToken(false)}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createTokenMutation.isPending}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {createTokenMutation.isPending ? 'Creating...' : 'Create'}
              </button>
            </div>
          </form>
        )}

        {tokensError && (
          <div role="alert" className="rounded-md bg-red-50 p-4 text-sm text-red-700">
            {getErrorMessage(tokensError, 'Failed to load tokens.')}
          </div>
        )}

        {tokensLoading ? (
          <div className="text-sm text-gray-500">Loading tokens...</div>
        ) : !tokens || tokens.length === 0 ? (
          <div className="rounded-md border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
            No SCIM tokens created.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Prefix</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Enabled</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Expires</th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {tokens.map((token) => (
                  <tr key={token.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                      {token.name}
                      {token.revoked && (
                        <span className="ml-2 inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Revoked</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <code className="font-mono text-xs text-gray-600">{token.tokenPrefix}…</code>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${token.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {token.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                      {token.expiresAt ? new Date(token.expiresAt).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right text-sm">
                      {token.enabled ? (
                        <button
                          onClick={() => disableTokenMutation.mutate(token.id)}
                          className="mr-3 font-medium text-gray-600 hover:text-gray-900"
                        >
                          Disable
                        </button>
                      ) : (
                        <button
                          onClick={() => enableTokenMutation.mutate(token.id)}
                          className="mr-3 font-medium text-indigo-600 hover:text-indigo-900"
                        >
                          Enable
                        </button>
                      )}
                      {!token.revoked && (
                        <button
                          onClick={() => revokeTokenMutation.mutate(token.id)}
                          className="mr-3 font-medium text-yellow-600 hover:text-yellow-800"
                        >
                          Revoke
                        </button>
                      )}
                      <button
                        onClick={() => setDeleteTokenTarget(token.id)}
                        className="font-medium text-red-600 hover:text-red-800"
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
        <h2 className="text-lg font-semibold text-gray-900">Attribute Mappings</h2>

        <form
          onSubmit={(e) => { e.preventDefault(); createMappingMutation.mutate(); }}
          className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
        >
          <div>
            <label htmlFor="mapping-resource-type" className="mb-1.5 block text-sm font-medium text-gray-700">Resource Type</label>
            <select
              id="mapping-resource-type"
              value={mappingForm.resourceType}
              onChange={(e) => setMappingForm({ ...mappingForm, resourceType: e.target.value })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            >
              <option value="User">User</option>
              <option value="Group">Group</option>
            </select>
          </div>
          <div>
            <label htmlFor="mapping-scim-attr" className="mb-1.5 block text-sm font-medium text-gray-700">SCIM Attribute</label>
            <input
              id="mapping-scim-attr"
              type="text"
              required
              value={mappingForm.scimAttribute}
              onChange={(e) => setMappingForm({ ...mappingForm, scimAttribute: e.target.value })}
              placeholder="e.g. userName"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="mapping-user-attr" className="mb-1.5 block text-sm font-medium text-gray-700">Idenplane Attribute</label>
            <input
              id="mapping-user-attr"
              type="text"
              required
              value={mappingForm.idenplaneAttribute}
              onChange={(e) => setMappingForm({ ...mappingForm, idenplaneAttribute: e.target.value })}
              placeholder="e.g. username"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="mapping-direction" className="mb-1.5 block text-sm font-medium text-gray-700">Direction</label>
            <select
              id="mapping-direction"
              value={mappingForm.direction}
              onChange={(e) => setMappingForm({ ...mappingForm, direction: e.target.value })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            >
              <option value="inbound">Inbound</option>
              <option value="outbound">Outbound</option>
              <option value="bidirectional">Bidirectional</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={createMappingMutation.isPending}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Add
          </button>
        </form>

        {createMappingMutation.isError && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {getErrorMessage(createMappingMutation.error, 'Failed to add mapping.')}
          </div>
        )}

        {mappingsError && (
          <div role="alert" className="rounded-md bg-red-50 p-4 text-sm text-red-700">
            {getErrorMessage(mappingsError, 'Failed to load attribute mappings.')}
          </div>
        )}

        {mappingsLoading ? (
          <div className="text-sm text-gray-500">Loading mappings...</div>
        ) : !mappings || mappings.length === 0 ? (
          <div className="rounded-md border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
            No custom attribute mappings.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Resource Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">SCIM Attribute</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Idenplane Attribute</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Direction</th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {mappings.map((mapping) => (
                  <tr key={mapping.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">{mapping.resourceType}</td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">{mapping.scimAttribute}</td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">{mapping.idenplaneAttribute}</td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">{mapping.direction}</td>
                    <td className="whitespace-nowrap px-6 py-4 text-right">
                      <button
                        onClick={() => setDeleteMappingTarget(mapping.id)}
                        className="text-sm font-medium text-red-600 hover:text-red-800"
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
