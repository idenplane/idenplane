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
    <div className="flex flex-col rounded-lg border border-line bg-surface p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-fg">{plugin.name}</h3>
            <span className="inline-flex rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-muted">
              v{plugin.version}
            </span>
          </div>
          <p className="mt-1 text-sm text-subtle">{plugin.description}</p>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-subtle">
            {plugin.author && <span>by {plugin.author}</span>}
            {plugin.homepage && (
              <a
                href={plugin.homepage}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:text-accent"
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
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:outline-none disabled:opacity-50 ${plugin.enabled ? 'bg-accent' : 'bg-active'}`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-surface shadow transition-transform ${plugin.enabled ? 'translate-x-5' : 'translate-x-0'}`}
          />
        </button>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${plugin.enabled ? 'bg-success-soft text-success-fg' : 'bg-sunken text-subtle'}`}
        >
          {plugin.enabled ? 'Enabled' : 'Disabled'}
        </span>
        <button
          onClick={() => onDelete(plugin)}
          className="text-sm font-medium text-danger hover:text-danger-fg"
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
    return <div className="text-subtle">Loading plugins...</div>;
  }

  if (error) {
    return (
      <div className="rounded-md bg-danger-soft p-4 text-sm text-danger-fg">
        {getErrorMessage(error, 'Failed to load plugins.')}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-fg">Plugins</h1>
          <p className="mt-1 text-sm text-subtle">Manage installed plugins across all realms.</p>
        </div>
      </div>

      {(enableMutation.isError || disableMutation.isError || deleteMutation.isError) && (
        <div className="mb-4 rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
          {getErrorMessage(
            enableMutation.error ?? disableMutation.error ?? deleteMutation.error,
            'Operation failed.',
          )}
        </div>
      )}

      {!plugins || plugins.length === 0 ? (
        <div className="rounded-md border border-line bg-surface p-8 text-center text-subtle">
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
