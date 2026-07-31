import { useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createServiceAccount } from '../../api/serviceAccounts';

export default function ServiceAccountCreatePage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    name: '',
    description: '',
    allowedIps: '',
  });

  const mutation = useMutation({
    mutationFn: () =>
      createServiceAccount(name!, {
        name: form.name,
        description: form.description || undefined,
        allowedIps: form.allowedIps
          ? form.allowedIps.split('\n').map((s) => s.trim()).filter(Boolean)
          : undefined,
      }),
    onSuccess: (account) => {
      queryClient.invalidateQueries({ queryKey: ['service-accounts', name] });
      navigate(`/console/realms/${name}/service-accounts/${account.id}`);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  const set = (field: string, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-fg">Create Service Account</h1>

      <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-line bg-surface p-6 shadow-sm">
        <div className="space-y-4">
          <div>
            <label htmlFor="field-sa-name" className="mb-1.5 block text-sm font-medium text-muted">Name *</label>
            <input
              id="field-sa-name"
              type="text"
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="field-sa-description" className="mb-1.5 block text-sm font-medium text-muted">Description</label>
            <input
              id="field-sa-description"
              type="text"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="field-sa-allowedIps" className="mb-1.5 block text-sm font-medium text-muted">Allowed IPs</label>
            <textarea
              id="field-sa-allowedIps"
              rows={4}
              value={form.allowedIps}
              onChange={(e) => set('allowedIps', e.target.value)}
              placeholder="One IP or CIDR per line"
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>
        </div>

        {mutation.isError && (
          <div className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
            {(mutation.error as Error)?.message || 'Failed to create service account.'}
          </div>
        )}

        <div className="flex justify-end gap-3 border-t border-line pt-4">
          <button
            type="button"
            onClick={() => navigate(`/console/realms/${name}/service-accounts`)}
            className="rounded-md border border-line-strong px-4 py-2 text-sm font-medium text-muted hover:bg-hover"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {mutation.isPending ? 'Creating...' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
