import { useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router';
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
  const { name, webhookId: id } = useParams<{ name: string; webhookId: string }>();
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
    return <div className="text-subtle">Loading webhook...</div>;
  }

  if (!webhook) {
    return <div className="rounded-md bg-danger-soft p-4 text-sm text-danger-fg">Webhook not found.</div>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-fg break-all">{webhook.url}</h1>
          {webhook.description && (
            <p className="mt-1 text-sm text-subtle">{webhook.description}</p>
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
            className="rounded-md border border-accent-soft px-4 py-2 text-sm font-medium text-accent hover:bg-accent-soft disabled:opacity-50"
          >
            {testMutation.isPending ? 'Testing...' : 'Test Webhook'}
          </button>
          <button
            onClick={() => setShowDelete(true)}
            className="rounded-md border border-danger-soft px-4 py-2 text-sm font-medium text-danger-fg hover:bg-danger-soft"
          >
            Delete
          </button>
        </div>
      </div>

      {testResult === 'success' && (
        <div className="rounded-md bg-success-soft p-3 text-sm text-success-fg">
          Test delivery sent successfully.
        </div>
      )}
      {testResult === 'error' && (
        <div className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
          Test delivery failed. Check deliveries below for details.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-line bg-surface p-6 shadow-sm">
        <div className="space-y-4">
          <div>
            <label htmlFor="field-wh-url" className="mb-1.5 block text-sm font-medium text-muted">URL *</label>
            <input
              id="field-wh-url"
              type="url"
              required
              value={form.url}
              onChange={(e) => set('url', e.target.value)}
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="field-wh-secret" className="mb-1.5 block text-sm font-medium text-muted">Secret</label>
            <PasswordInput
              id="field-wh-secret"
              value={form.secret}
              onChange={(e) => set('secret', e.target.value)}
              placeholder="Leave blank to keep current"
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="field-wh-description" className="mb-1.5 block text-sm font-medium text-muted">Description</label>
            <input
              id="field-wh-description"
              type="text"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="field-wh-enabled"
              checked={form.enabled}
              onChange={(e) => set('enabled', e.target.checked)}
              className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
            />
            <label htmlFor="field-wh-enabled" className="text-sm font-medium text-muted">Enabled</label>
          </div>
        </div>

        <div className="space-y-3 border-t border-line pt-4">
          <h2 className="text-lg font-semibold text-fg">Event Types</h2>
          <div className="grid grid-cols-2 gap-2">
            {EVENT_TYPES.map((et) => (
              <label key={et} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.eventTypes.includes(et)}
                  onChange={() => toggleEventType(et)}
                  className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
                />
                <span className="text-sm text-muted">{et}</span>
              </label>
            ))}
          </div>
        </div>

        {updateMutation.isSuccess && (
          <div className="rounded-md bg-success-soft p-3 text-sm text-success-fg">
            Webhook updated successfully.
          </div>
        )}
        {updateMutation.isError && (
          <div className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
            Failed to update webhook.
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

      {deliveries && deliveries.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-fg">Recent Deliveries</h2>
          <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
            <table className="min-w-full divide-y divide-line">
              <thead className="bg-sunken">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Event</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Result</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Duration</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {deliveries.map((d) => (
                  <tr key={d.id} className="hover:bg-hover">
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-muted">{d.eventType}</td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-subtle">
                      {d.statusCode ?? '-'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          d.success ? 'bg-success-soft text-success-fg' : 'bg-danger-soft text-danger-fg'
                        }`}
                      >
                        {d.success ? 'Success' : 'Failed'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-subtle">
                      {d.duration != null ? `${d.duration}ms` : '-'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-subtle">
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
