import { useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getWebhook,
  updateWebhook,
  deleteWebhook,
  testWebhook,
  getWebhookDeliveries,
} from '../../api/webhooks';
import ConfirmDialog from '../../components/ConfirmDialog';
import PasswordInput from '../../components/PasswordInput';

const EVENT_TYPES = [
  'user.created',
  'user.updated',
  'user.deleted',
  'user.login',
  'user.login.failed',
  'user.password.reset',
  'realm.updated',
  'client.created',
  'client.deleted',
  'role.assigned',
  'role.removed',
];

export default function WebhookDetailPage() {
  const { name, id } = useParams<{ name: string; id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showDelete, setShowDelete] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);

  const { data: webhook, isLoading } = useQuery({
    queryKey: ['webhook', name, id],
    queryFn: () => getWebhook(name!, id!),
    enabled: !!name && !!id,
  });

  const { data: deliveries } = useQuery({
    queryKey: ['webhook-deliveries', name, id],
    queryFn: () => getWebhookDeliveries(name!, id!),
    enabled: !!name && !!id,
  });

  const [form, setForm] = useState({
    url: '',
    secret: '',
    description: '',
    eventTypes: [] as string[],
    enabled: true,
  });

  const [seededWebhook, setSeededWebhook] = useState(webhook);
  if (webhook && webhook !== seededWebhook) {
    setSeededWebhook(webhook);
    setForm({
      url: webhook.url,
      secret: '',
      description: webhook.description ?? '',
      eventTypes: webhook.eventTypes,
      enabled: webhook.enabled,
    });
  }

  const updateMutation = useMutation({
    mutationFn: () =>
      updateWebhook(name!, id!, {
        url: form.url,
        secret: form.secret || undefined,
        description: form.description || undefined,
        eventTypes: form.eventTypes,
        enabled: form.enabled,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhook', name, id] });
      queryClient.invalidateQueries({ queryKey: ['webhooks', name] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteWebhook(name!, id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks', name] });
      navigate(`/console/realms/${name}/webhooks`);
    },
  });

  const testMutation = useMutation({
    mutationFn: () => testWebhook(name!, id!),
    onSuccess: () => {
      setTestResult('success');
      queryClient.invalidateQueries({ queryKey: ['webhook-deliveries', name, id] });
    },
    onError: () => setTestResult('error'),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    updateMutation.mutate();
  }

  function toggleEventType(eventType: string) {
    setForm((f) => ({
      ...f,
      eventTypes: f.eventTypes.includes(eventType)
        ? f.eventTypes.filter((t) => t !== eventType)
        : [...f.eventTypes, eventType],
    }));
  }

  const set = (field: string, value: string | boolean) =>
    setForm((f) => ({ ...f, [field]: value }));

  if (isLoading) {
    return <div className="text-gray-500">Loading webhook...</div>;
  }

  if (!webhook) {
    return <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">Webhook not found.</div>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 break-all">{webhook.url}</h1>
          {webhook.description && (
            <p className="mt-1 text-sm text-gray-500">{webhook.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setTestResult(null);
              testMutation.mutate();
            }}
            disabled={testMutation.isPending}
            className="rounded-md border border-indigo-300 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
          >
            {testMutation.isPending ? 'Testing...' : 'Test Webhook'}
          </button>
          <button
            onClick={() => setShowDelete(true)}
            className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      </div>

      {testResult === 'success' && (
        <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
          Test delivery sent successfully.
        </div>
      )}
      {testResult === 'error' && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          Test delivery failed. Check deliveries below for details.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="space-y-4">
          <div>
            <label htmlFor="field-wh-url" className="mb-1.5 block text-sm font-medium text-gray-700">URL *</label>
            <input
              id="field-wh-url"
              type="url"
              required
              value={form.url}
              onChange={(e) => set('url', e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="field-wh-secret" className="mb-1.5 block text-sm font-medium text-gray-700">Secret</label>
            <PasswordInput
              id="field-wh-secret"
              value={form.secret}
              onChange={(e) => set('secret', e.target.value)}
              placeholder="Leave blank to keep current"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="field-wh-description" className="mb-1.5 block text-sm font-medium text-gray-700">Description</label>
            <input
              id="field-wh-description"
              type="text"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="field-wh-enabled"
              checked={form.enabled}
              onChange={(e) => set('enabled', e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <label htmlFor="field-wh-enabled" className="text-sm font-medium text-gray-700">Enabled</label>
          </div>
        </div>

        <div className="space-y-3 border-t border-gray-200 pt-4">
          <h2 className="text-lg font-semibold text-gray-900">Event Types</h2>
          <div className="grid grid-cols-2 gap-2">
            {EVENT_TYPES.map((et) => (
              <label key={et} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.eventTypes.includes(et)}
                  onChange={() => toggleEventType(et)}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm text-gray-700">{et}</span>
              </label>
            ))}
          </div>
        </div>

        {updateMutation.isSuccess && (
          <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
            Webhook updated successfully.
          </div>
        )}
        {updateMutation.isError && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            Failed to update webhook.
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

      {deliveries && deliveries.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">Recent Deliveries</h2>
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Event</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Result</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Duration</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {deliveries.map((d) => (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">{d.eventType}</td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                      {d.statusCode ?? '-'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          d.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {d.success ? 'Success' : 'Failed'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                      {d.duration != null ? `${d.duration}ms` : '-'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                      {new Date(d.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={showDelete}
        title="Delete Webhook"
        message={`Are you sure you want to delete this webhook?`}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setShowDelete(false)}
      />
    </div>
  );
}
