import { useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getFederation,
  updateFederation,
  deleteFederation,
  testConnection,
  syncFederation,
} from '../../api/userFederation';
import ConfirmDialog from '../../components/ConfirmDialog';
import PasswordInput from '../../components/PasswordInput';

export default function FederationDetailPage() {
  const { name, id } = useParams<{ name: string; id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showDelete, setShowDelete] = useState(false);
  const [actionStatus, setActionStatus] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const { data: federation, isLoading } = useQuery({
    queryKey: ['user-federation', name, id],
    queryFn: () => getFederation(name!, id!),
    enabled: !!name && !!id,
  });

  const [form, setForm] = useState({
    name: '',
    enabled: true,
    priority: 0,
    connectionUrl: '',
    bindDn: '',
    bindCredential: '',
    startTls: false,
    connectionTimeout: 5000,
    usersDn: '',
    userObjectClass: 'inetOrgPerson',
    usernameLdapAttr: 'uid',
    rdnLdapAttr: 'uid',
    uuidLdapAttr: 'entryUUID',
    searchFilter: '',
    syncMode: 'IMPORT',
    syncPeriod: 3600,
    importEnabled: true,
    editMode: 'READ_ONLY',
  });

  // Seed the editable form from fetched data when the loaded federation changes.
  // Adjusting state during render (vs. an effect) avoids an extra render pass.
  const [seededFederation, setSeededFederation] = useState(federation);
  if (federation && federation !== seededFederation) {
    setSeededFederation(federation);
    setForm({
      name: federation.name,
      enabled: federation.enabled,
      priority: federation.priority,
      connectionUrl: federation.connectionUrl,
      bindDn: federation.bindDn,
      bindCredential: federation.bindCredential,
      startTls: federation.startTls,
      connectionTimeout: federation.connectionTimeout,
      usersDn: federation.usersDn,
      userObjectClass: federation.userObjectClass,
      usernameLdapAttr: federation.usernameLdapAttr,
      rdnLdapAttr: federation.rdnLdapAttr,
      uuidLdapAttr: federation.uuidLdapAttr,
      searchFilter: federation.searchFilter ?? '',
      syncMode: federation.syncMode,
      syncPeriod: federation.syncPeriod,
      importEnabled: federation.importEnabled,
      editMode: federation.editMode,
    });
  }

  const updateMutation = useMutation({
    mutationFn: () =>
      updateFederation(name!, id!, {
        name: form.name,
        enabled: form.enabled,
        priority: form.priority,
        connectionUrl: form.connectionUrl,
        bindDn: form.bindDn,
        bindCredential: form.bindCredential,
        startTls: form.startTls,
        connectionTimeout: form.connectionTimeout,
        usersDn: form.usersDn,
        userObjectClass: form.userObjectClass,
        usernameLdapAttr: form.usernameLdapAttr,
        rdnLdapAttr: form.rdnLdapAttr,
        uuidLdapAttr: form.uuidLdapAttr,
        searchFilter: form.searchFilter || undefined,
        syncMode: form.syncMode,
        syncPeriod: form.syncPeriod,
        importEnabled: form.importEnabled,
        editMode: form.editMode,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-federation', name, id] });
      queryClient.invalidateQueries({ queryKey: ['user-federations', name] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteFederation(name!, id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-federations', name] });
      navigate(`/console/realms/${name}/user-federation`);
    },
  });

  const testMutation = useMutation({
    mutationFn: () => testConnection(name!, id!),
    onSuccess: (data) => {
      setActionStatus({
        type: data.success ? 'success' : 'error',
        message: data.message || 'Connection test completed.',
      });
    },
    onError: (error: Error) => {
      setActionStatus({
        type: 'error',
        message: error.message || 'Connection test failed.',
      });
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => syncFederation(name!, id!),
    onSuccess: (data) => {
      setActionStatus({
        type: data.success ? 'success' : 'error',
        message: data.message || 'User sync completed.',
      });
      queryClient.invalidateQueries({ queryKey: ['user-federation', name, id] });
    },
    onError: (error: Error) => {
      setActionStatus({
        type: 'error',
        message: error.message || 'User sync failed.',
      });
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setActionStatus(null);
    updateMutation.mutate();
  }

  const set = (field: string, value: string | boolean | number) =>
    setForm((f) => ({ ...f, [field]: value }));

  if (isLoading) {
    return <div className="text-gray-500">Loading federation provider...</div>;
  }

  if (!federation) {
    return <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">Federation provider not found.</div>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{federation.name}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {federation.providerType.toUpperCase()} Federation Provider
          </p>
        </div>
        <button
          onClick={() => setShowDelete(true)}
          className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
        >
          Delete
        </button>
      </div>

      {/* Actions */}
      <div className="flex gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <button
          onClick={() => {
            setActionStatus(null);
            testMutation.mutate();
          }}
          disabled={testMutation.isPending}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {testMutation.isPending ? 'Testing...' : 'Test Connection'}
        </button>
        <button
          onClick={() => {
            setActionStatus(null);
            syncMutation.mutate();
          }}
          disabled={syncMutation.isPending}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {syncMutation.isPending ? 'Syncing...' : 'Sync Users'}
        </button>
        {federation.lastSyncAt && (
          <span className="flex items-center text-xs text-gray-500">
            Last sync: {new Date(federation.lastSyncAt).toLocaleString()}
            {federation.lastSyncStatus && (
              <span
                className={`ml-2 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                  federation.lastSyncStatus === 'SUCCESS'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-red-100 text-red-700'
                }`}
              >
                {federation.lastSyncStatus}
              </span>
            )}
          </span>
        )}
      </div>

      {actionStatus && (
        <div
          className={`rounded-md p-3 text-sm ${
            actionStatus.type === 'success'
              ? 'bg-green-50 text-green-700'
              : 'bg-red-50 text-red-700'
          }`}
        >
          {actionStatus.message}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        {/* General */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">General</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="field-federation-name" className="mb-1.5 block text-sm font-medium text-gray-700">Name *</label>
              <input
                id="field-federation-name"
                type="text"
                required
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="field-federation-priority" className="mb-1.5 block text-sm font-medium text-gray-700">Priority</label>
              <input
                id="field-federation-priority"
                type="number"
                value={form.priority}
                onChange={(e) => set('priority', parseInt(e.target.value, 10) || 0)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
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

        {/* Connection */}
        <div className="space-y-4 border-t border-gray-200 pt-4">
          <h2 className="text-lg font-semibold text-gray-900">Connection</h2>

          <div>
            <label htmlFor="field-federation-connectionUrl" className="mb-1.5 block text-sm font-medium text-gray-700">Connection URL *</label>
            <input
              id="field-federation-connectionUrl"
              type="text"
              required
              value={form.connectionUrl}
              onChange={(e) => set('connectionUrl', e.target.value)}
              placeholder="ldap://localhost:389"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="field-federation-bindDn" className="mb-1.5 block text-sm font-medium text-gray-700">Bind DN *</label>
              <input
                id="field-federation-bindDn"
                type="text"
                required
                value={form.bindDn}
                onChange={(e) => set('bindDn', e.target.value)}
                placeholder="cn=admin,dc=example,dc=org"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="field-federation-bindCredential" className="mb-1.5 block text-sm font-medium text-gray-700">Bind Credential *</label>
              <PasswordInput
                id="field-federation-bindCredential"
                required
                value={form.bindCredential}
                onChange={(e) => set('bindCredential', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="startTls"
                checked={form.startTls}
                onChange={(e) => set('startTls', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <label htmlFor="startTls" className="text-sm font-medium text-gray-700">
                Start TLS
              </label>
            </div>
            <div>
              <label htmlFor="field-federation-connectionTimeout" className="mb-1.5 block text-sm font-medium text-gray-700">Connection Timeout (ms)</label>
              <input
                id="field-federation-connectionTimeout"
                type="number"
                value={form.connectionTimeout}
                onChange={(e) => set('connectionTimeout', parseInt(e.target.value, 10) || 0)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* User Search */}
        <div className="space-y-4 border-t border-gray-200 pt-4">
          <h2 className="text-lg font-semibold text-gray-900">User Search</h2>

          <div>
            <label htmlFor="field-federation-usersDn" className="mb-1.5 block text-sm font-medium text-gray-700">Users DN *</label>
            <input
              id="field-federation-usersDn"
              type="text"
              required
              value={form.usersDn}
              onChange={(e) => set('usersDn', e.target.value)}
              placeholder="ou=users,dc=example,dc=org"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="field-federation-userObjectClass" className="mb-1.5 block text-sm font-medium text-gray-700">User Object Class</label>
              <input
                id="field-federation-userObjectClass"
                type="text"
                value={form.userObjectClass}
                onChange={(e) => set('userObjectClass', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="field-federation-usernameLdapAttr" className="mb-1.5 block text-sm font-medium text-gray-700">Username LDAP Attribute</label>
              <input
                id="field-federation-usernameLdapAttr"
                type="text"
                value={form.usernameLdapAttr}
                onChange={(e) => set('usernameLdapAttr', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="field-federation-rdnLdapAttr" className="mb-1.5 block text-sm font-medium text-gray-700">RDN LDAP Attribute</label>
              <input
                id="field-federation-rdnLdapAttr"
                type="text"
                value={form.rdnLdapAttr}
                onChange={(e) => set('rdnLdapAttr', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="field-federation-uuidLdapAttr" className="mb-1.5 block text-sm font-medium text-gray-700">UUID LDAP Attribute</label>
              <input
                id="field-federation-uuidLdapAttr"
                type="text"
                value={form.uuidLdapAttr}
                onChange={(e) => set('uuidLdapAttr', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="field-federation-searchFilter" className="mb-1.5 block text-sm font-medium text-gray-700">Search Filter</label>
            <input
              id="field-federation-searchFilter"
              type="text"
              value={form.searchFilter}
              onChange={(e) => set('searchFilter', e.target.value)}
              placeholder="(objectClass=inetOrgPerson)"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Sync */}
        <div className="space-y-4 border-t border-gray-200 pt-4">
          <h2 className="text-lg font-semibold text-gray-900">Sync</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="field-federation-syncMode" className="mb-1.5 block text-sm font-medium text-gray-700">Sync Mode</label>
              <select
                id="field-federation-syncMode"
                value={form.syncMode}
                onChange={(e) => set('syncMode', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              >
                <option value="IMPORT">Import</option>
                <option value="FORCE">Force</option>
                <option value="UNLINK">Unlink</option>
              </select>
            </div>
            <div>
              <label htmlFor="field-federation-syncPeriod" className="mb-1.5 block text-sm font-medium text-gray-700">Sync Period (seconds)</label>
              <input
                id="field-federation-syncPeriod"
                type="number"
                value={form.syncPeriod}
                onChange={(e) => set('syncPeriod', parseInt(e.target.value, 10) || 0)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="field-federation-editMode" className="mb-1.5 block text-sm font-medium text-gray-700">Edit Mode</label>
              <select
                id="field-federation-editMode"
                value={form.editMode}
                onChange={(e) => set('editMode', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              >
                <option value="READ_ONLY">Read Only</option>
                <option value="WRITABLE">Writable</option>
                <option value="UNSYNCED">Unsynced</option>
              </select>
            </div>
            <div className="flex items-end gap-2 pb-1">
              <input
                type="checkbox"
                id="importEnabled"
                checked={form.importEnabled}
                onChange={(e) => set('importEnabled', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <label htmlFor="importEnabled" className="text-sm font-medium text-gray-700">
                Import Enabled
              </label>
            </div>
          </div>
        </div>

        {updateMutation.isSuccess && (
          <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
            Federation provider updated successfully.
          </div>
        )}
        {updateMutation.isError && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            Failed to update federation provider.
          </div>
        )}

        <div className="flex justify-end border-t border-gray-200 pt-4">
          <button
            type="submit"
            disabled={updateMutation.isPending}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>

      <ConfirmDialog
        isOpen={showDelete}
        title="Delete Federation Provider"
        message={`Are you sure you want to delete federation provider "${federation.name}"?`}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setShowDelete(false)}
      />
    </div>
  );
}
