import { useState, type FormEvent } from 'react';
import { Link, useParams, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createNhiIdentity } from '../../api/nhi';
import type { NhiIdentityType } from '../../types';

const IDENTITY_TYPES: { value: NhiIdentityType; label: string }[] = [
  { value: 'MACHINE_TO_MACHINE', label: 'Machine to Machine' },
  { value: 'IOT_DEVICE', label: 'IoT Device' },
  { value: 'AI_AGENT', label: 'AI Agent' },
  { value: 'BOT', label: 'Bot' },
];

/** Split a comma/newline separated string into a trimmed, de-empted list. */
function toList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function NhiCreatePage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    name: '',
    identityType: 'MACHINE_TO_MACHINE' as NhiIdentityType,
    description: '',
    agentPurpose: '',
    permissionScopes: '',
    tags: '',
  });

  const mutation = useMutation({
    mutationFn: () =>
      createNhiIdentity(name!, {
        name: form.name,
        identityType: form.identityType,
        description: form.description || undefined,
        agentPurpose: form.agentPurpose || undefined,
        permissionScopes: form.permissionScopes
          ? toList(form.permissionScopes)
          : undefined,
        tags: form.tags ? toList(form.tags) : undefined,
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['nhi-identities', name] });
      navigate(`/console/realms/${name}/nhi/${result.id}`);
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
      <div>
        <h1 className="text-2xl font-bold text-fg">Create Non-Human Identity</h1>
        <p className="mt-1 text-sm text-subtle">
          Provision a new machine identity in <span className="font-medium">{name}</span>
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-line bg-surface p-6 shadow-sm">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="field-nhi-name" className="mb-1.5 block text-sm font-medium text-muted">
                Name *
              </label>
              <input
                id="field-nhi-name"
                type="text"
                required
                placeholder="e.g. billing-service"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="field-nhi-type" className="mb-1.5 block text-sm font-medium text-muted">
                Identity Type
              </label>
              <select
                id="field-nhi-type"
                value={form.identityType}
                onChange={(e) => set('identityType', e.target.value)}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              >
                {IDENTITY_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="field-nhi-description" className="mb-1.5 block text-sm font-medium text-muted">
              Description
            </label>
            <textarea
              id="field-nhi-description"
              rows={2}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>

          {form.identityType === 'AI_AGENT' && (
            <div>
              <label htmlFor="field-nhi-purpose" className="mb-1.5 block text-sm font-medium text-muted">
                Agent Purpose
              </label>
              <input
                id="field-nhi-purpose"
                type="text"
                placeholder="What this agent is authorized to do"
                value={form.agentPurpose}
                onChange={(e) => set('agentPurpose', e.target.value)}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              />
            </div>
          )}

          <div>
            <label htmlFor="field-nhi-scopes" className="mb-1.5 block text-sm font-medium text-muted">
              Permission Scopes
            </label>
            <input
              id="field-nhi-scopes"
              type="text"
              placeholder="scope-a, scope-b"
              value={form.permissionScopes}
              onChange={(e) => set('permissionScopes', e.target.value)}
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
            <p className="mt-1 text-xs text-subtle">Comma-separated</p>
          </div>

          <div>
            <label htmlFor="field-nhi-tags" className="mb-1.5 block text-sm font-medium text-muted">
              Tags
            </label>
            <input
              id="field-nhi-tags"
              type="text"
              placeholder="prod, region-eu"
              value={form.tags}
              onChange={(e) => set('tags', e.target.value)}
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
            <p className="mt-1 text-xs text-subtle">Comma-separated</p>
          </div>
        </div>

        {mutation.isError && (
          <div className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
            {(mutation.error as Error)?.message || 'Failed to create identity.'}
          </div>
        )}

        <div className="flex justify-end gap-3 border-t border-line pt-4">
          <Link
            to={`/console/realms/${name}/nhi`}
            className="rounded-md border border-line-strong px-4 py-2 text-sm font-medium text-muted hover:bg-hover"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {mutation.isPending ? 'Creating...' : 'Create Identity'}
          </button>
        </div>
      </form>
    </div>
  );
}
