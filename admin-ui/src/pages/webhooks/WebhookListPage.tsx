import { Link, useParams } from 'react-router-dom';
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
        <h1 className="text-2xl font-bold text-gray-900">Webhooks</h1>
        <Link
          to={`/console/realms/${name}/webhooks/new`}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Add Webhook
        </Link>
      </div>

      {error && (
        <div role="alert" className="rounded-md bg-red-50 p-4 text-sm text-red-700">
          Failed to load data: {error.message}
        </div>
      )}

      {isLoading ? (
        <div className="text-gray-500">Loading webhooks...</div>
      ) : !webhooks || webhooks.length === 0 ? (
        <div className="rounded-md border border-gray-200 bg-white p-8 text-center text-gray-500">
          No webhooks configured.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">URL</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Description</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Events</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {webhooks.map((webhook) => (
                <tr key={webhook.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-6 py-4">
                    <Link
                      to={`/console/realms/${name}/webhooks/${webhook.id}`}
                      className="font-medium text-indigo-600 hover:text-indigo-900"
                    >
                      {webhook.url}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {webhook.description || '-'}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                      {webhook.eventTypes.length} event{webhook.eventTypes.length !== 1 ? 's' : ''}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        webhook.enabled
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {webhook.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
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
