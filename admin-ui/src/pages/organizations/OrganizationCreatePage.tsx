import { useState, type FormEvent } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createOrganization } from '../../api/organizations';

export default function OrganizationCreatePage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    slug: '',
    name: '',
    displayName: '',
    description: '',
    logoUrl: '',
    primaryColor: '#6366f1',
    requireMfa: false,
    enabled: true,
  });

  const mutation = useMutation({
    mutationFn: () =>
      createOrganization(name!, {
        slug: form.slug,
        name: form.name,
        displayName: form.displayName || undefined,
        description: form.description || undefined,
        logoUrl: form.logoUrl || undefined,
        primaryColor: form.primaryColor || undefined,
        requireMfa: form.requireMfa,
        enabled: form.enabled,
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['organizations', name] });
      navigate(`/console/realms/${name}/organizations/${result.slug}`);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  const set = (field: string, value: string | boolean) =>
    setForm((f) => ({ ...f, [field]: value }));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Create Organization</h1>

      <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">General</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="field-org-slug" className="mb-1.5 block text-sm font-medium text-gray-700">
                Slug *
              </label>
              <input
                id="field-org-slug"
                type="text"
                required
                pattern="^[a-z0-9-]+$"
                title="Lowercase letters, numbers, hyphens"
                placeholder="my-org"
                value={form.slug}
                onChange={(e) => set('slug', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
              <p className="mt-1 text-xs text-gray-500">Lowercase letters, numbers, hyphens</p>
            </div>
            <div>
              <label htmlFor="field-org-name" className="mb-1.5 block text-sm font-medium text-gray-700">
                Name *
              </label>
              <input
                id="field-org-name"
                type="text"
                required
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="field-org-displayName" className="mb-1.5 block text-sm font-medium text-gray-700">
                Display Name
              </label>
              <input
                id="field-org-displayName"
                type="text"
                value={form.displayName}
                onChange={(e) => set('displayName', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="field-org-logoUrl" className="mb-1.5 block text-sm font-medium text-gray-700">
                Logo URL
              </label>
              <input
                id="field-org-logoUrl"
                type="url"
                value={form.logoUrl}
                onChange={(e) => set('logoUrl', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="field-org-description" className="mb-1.5 block text-sm font-medium text-gray-700">
              Description
            </label>
            <textarea
              id="field-org-description"
              rows={3}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="field-org-primaryColor" className="mb-1.5 block text-sm font-medium text-gray-700">
                Primary Color
              </label>
              <input
                id="field-org-primaryColor"
                type="color"
                value={form.primaryColor}
                onChange={(e) => set('primaryColor', e.target.value)}
                className="h-10 w-full cursor-pointer rounded-md border border-gray-300 px-1 py-1"
              />
            </div>
            <div className="space-y-3 pt-6">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="field-org-requireMfa"
                  checked={form.requireMfa}
                  onChange={(e) => set('requireMfa', e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm font-medium text-gray-700">Require MFA</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="field-org-enabled"
                  checked={form.enabled}
                  onChange={(e) => set('enabled', e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm font-medium text-gray-700">Enabled</span>
              </label>
            </div>
          </div>
        </div>

        {mutation.isError && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {(mutation.error as Error)?.message || 'Failed to create organization.'}
          </div>
        )}

        <div className="flex justify-end gap-3 border-t border-gray-200 pt-4">
          <Link
            to={`/console/realms/${name}/organizations`}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {mutation.isPending ? 'Creating...' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
