import { useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createGroup, getGroups } from '../../api/groups';

export default function GroupCreatePage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    name: '',
    description: '',
    parentId: '',
  });

  const { data: groups } = useQuery({
    queryKey: ['groups', name],
    queryFn: () => getGroups(name!),
    enabled: !!name,
  });

  const mutation = useMutation({
    mutationFn: () =>
      createGroup(name!, {
        name: form.name,
        description: form.description || undefined,
        parentId: form.parentId || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups', name] });
      navigate(`/console/realms/${name}/groups`);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-fg">Create Group</h1>

      <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-line bg-surface p-6 shadow-sm">
        <div>
          <label htmlFor="field-group-name" className="mb-1.5 block text-sm font-medium text-muted">
            Group Name *
          </label>
          <input
            id="field-group-name"
            type="text"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="field-group-description" className="mb-1.5 block text-sm font-medium text-muted">
            Description
          </label>
          <textarea
            id="field-group-description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={3}
            className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="field-group-parentId" className="mb-1.5 block text-sm font-medium text-muted">
            Parent Group
          </label>
          <select
            id="field-group-parentId"
            value={form.parentId}
            onChange={(e) => setForm({ ...form, parentId: e.target.value })}
            className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          >
            <option value="">None (top-level)</option>
            {groups?.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>

        {mutation.isError && (
          <div className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
            {(mutation.error as Error)?.message || 'Failed to create group.'}
          </div>
        )}

        <div className="flex justify-end gap-3 border-t border-line pt-4">
          <button
            type="button"
            onClick={() => navigate(`/console/realms/${name}/groups`)}
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
