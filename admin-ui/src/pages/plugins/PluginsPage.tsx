import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPlugins, enablePlugin, disablePlugin, deletePlugin } from '../../api/plugins';
import type { Plugin } from '../../api/plugins';
import ConfirmDialog from '../../components/ConfirmDialog';
import { getErrorMessage } from '../../utils/getErrorMessage';

function PluginCard({
  plugin,
  onToggle,
  onDelete,
  isToggling,
}: {
  plugin: Plugin;
  onToggle: (plugin: Plugin) => void;
  onDelete: (plugin: Plugin) => void;
  isToggling: boolean;
}) {
  return (
    <div className="flex flex-col rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900">{plugin.name}</h3>
            <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
              v{plugin.version}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-500">{plugin.description}</p>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-400">
            {plugin.author && <span>by {plugin.author}</span>}
            {plugin.homepage && (
              <a
                href={plugin.homepage}
                target="_blank"
                rel="noreferrer"
                className="text-indigo-500 hover:text-indigo-700"
              >
                Homepage
              </a>
            )}
          </div>
        </div>

        {/* Toggle */}
        <button
          type="button"
          role="switch"
          aria-checked={plugin.enabled}
          disabled={isToggling}
          onClick={() => onToggle(plugin)}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:outline-none disabled:opacity-50 ${plugin.enabled ? 'bg-indigo-600' : 'bg-gray-200'}`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${plugin.enabled ? 'translate-x-5' : 'translate-x-0'}`}
          />
        </button>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${plugin.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
        >
          {plugin.enabled ? 'Enabled' : 'Disabled'}
        </span>
        <button
          onClick={() => onDelete(plugin)}
          className="text-sm font-medium text-red-600 hover:text-red-800"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

export default function PluginsPage() {
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<Plugin | null>(null);

  const { data: plugins, isLoading, error } = useQuery({
    queryKey: ['plugins'],
    queryFn: getPlugins,
  });

  const enableMutation = useMutation({
    mutationFn: (name: string) => enablePlugin(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['plugins'] }),
  });

  const disableMutation = useMutation({
    mutationFn: (name: string) => disablePlugin(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['plugins'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => deletePlugin(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      setDeleteTarget(null);
    },
  });

  function handleToggle(plugin: Plugin) {
    if (plugin.enabled) {
      disableMutation.mutate(plugin.name);
    } else {
      enableMutation.mutate(plugin.name);
    }
  }

  if (isLoading) {
    return <div className="text-gray-500">Loading plugins...</div>;
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
        {getErrorMessage(error, 'Failed to load plugins.')}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Plugins</h1>
          <p className="mt-1 text-sm text-gray-500">Manage installed plugins across all realms.</p>
        </div>
      </div>

      {(enableMutation.isError || disableMutation.isError || deleteMutation.isError) && (
        <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
          {getErrorMessage(
            enableMutation.error ?? disableMutation.error ?? deleteMutation.error,
            'Operation failed.',
          )}
        </div>
      )}

      {!plugins || plugins.length === 0 ? (
        <div className="rounded-md border border-gray-200 bg-white p-8 text-center text-gray-500">
          No plugins installed.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plugins.map((plugin) => (
            <PluginCard
              key={plugin.name}
              plugin={plugin}
              onToggle={handleToggle}
              onDelete={setDeleteTarget}
              isToggling={
                (enableMutation.isPending || disableMutation.isPending) &&
                (enableMutation.variables === plugin.name || disableMutation.variables === plugin.name)
              }
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="Delete Plugin"
        message={`Are you sure you want to uninstall "${deleteTarget?.name}"? This action cannot be undone.`}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.name)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
