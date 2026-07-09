import { useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createWebhook } from '../../api/webhooks';
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

export default function WebhookCreatePage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    url: '',
    secret: '',
    description: '',
    eventTypes: [] as string[],
    enabled: true,
  });

  const mutation = useMutation({
    mutationFn: () =>
      createWebhook(name!, {
        url: form.url,
        secret: form.secret,
        eventTypes: form.eventTypes,
        description: form.description || undefined,
        enabled: form.enabled,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks', name] });
      navigate(`/console/realms/${name}/webhooks`);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
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

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Add Webhook</h1>

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
              placeholder="https://example.com/webhook"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="field-wh-secret" className="mb-1.5 block text-sm font-medium text-gray-700">Secret *</label>
            <PasswordInput
              id="field-wh-secret"
              required
              minLength={8}
              value={form.secret}
              onChange={(e) => set('secret', e.target.value)}
              placeholder="Min. 8 characters"
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
          <h2 className="text-lg font-semibold text-gray-900">Event Types *</h2>
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

        {mutation.isError && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {(mutation.error as Error)?.message || 'Failed to create webhook.'}
          </div>
        )}

        <div className="flex justify-end gap-3 border-t border-gray-200 pt-4">
          <button
            type="button"
            onClick={() => navigate(`/console/realms/${name}/webhooks`)}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={mutation.isPending || form.eventTypes.length === 0}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {mutation.isPending ? 'Creating...' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
