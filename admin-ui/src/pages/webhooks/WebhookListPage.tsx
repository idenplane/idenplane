import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { getWebhooks } from '../../api/webhooks';

export default function WebhookListPage() {
  const { name } = useParams<{ name: string }>();

  const { data: webhooks, isLoading, error } = useQuery({
    queryKey: ['webhooks', name],
    queryFn: () => getWebhooks(name!),
    enabled: !!name,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-fg">Webhooks</h1>
        <Link
          to={`/console/realms/${name}/webhooks/new`}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Add Webhook
        </Link>
      </div>

      {error && (
        <div role="alert" className="rounded-md bg-danger-soft p-4 text-sm text-danger-fg">
          Failed to load data: {error.message}
        </div>
      )}

      {isLoading ? (
        <div className="text-subtle">Loading webhooks...</div>
      ) : !webhooks || webhooks.length === 0 ? (
        <div className="rounded-md border border-line bg-surface p-8 text-center text-subtle">
          No webhooks configured.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
          <table className="min-w-full divide-y divide-line">
            <thead className="bg-sunken">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">URL</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Description</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Events</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {webhooks.map((webhook) => (
                <tr key={webhook.id} className="hover:bg-hover">
                  <td className="whitespace-nowrap px-6 py-4">
                    <Link
                      to={`/console/realms/${name}/webhooks/${webhook.id}`}
                      className="font-medium text-accent hover:text-accent"
                    >
                      {webhook.url}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-sm text-subtle">
                    {webhook.description || '-'}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <span className="inline-flex rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-muted">
                      {webhook.eventTypes.length} event{webhook.eventTypes.length !== 1 ? 's' : ''}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        webhook.enabled
                          ? 'bg-success-soft text-success-fg'
                          : 'bg-danger-soft text-danger-fg'
                      }`}
                    >
                      {webhook.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-subtle">
                    {new Date(webhook.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
