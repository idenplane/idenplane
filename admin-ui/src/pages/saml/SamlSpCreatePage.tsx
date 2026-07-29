import { useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createSamlSp } from '../../api/samlServiceProviders';

export default function SamlSpCreatePage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    entityId: '',
    name: '',
    acsUrl: '',
  });

  const mutation = useMutation({
    mutationFn: () =>
      createSamlSp(name!, {
        entityId: form.entityId,
        name: form.name,
        acsUrl: form.acsUrl,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['saml-service-providers', name] });
      navigate(`/console/realms/${name}/saml-providers/${data.id}`);
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
      <h1 className="text-2xl font-bold text-gray-900">Add SAML Service Provider</h1>

      <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">General</h2>

          <div>
            <label htmlFor="field-saml-name" className="mb-1.5 block text-sm font-medium text-gray-700">Name *</label>
            <input
              id="field-saml-name"
              type="text"
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="field-saml-entityId" className="mb-1.5 block text-sm font-medium text-gray-700">Entity ID *</label>
            <input
              id="field-saml-entityId"
              type="text"
              required
              value={form.entityId}
              onChange={(e) => set('entityId', e.target.value)}
              placeholder="https://sp.example.com/metadata"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="field-saml-acsUrl" className="mb-1.5 block text-sm font-medium text-gray-700">ACS URL *</label>
            <input
              id="field-saml-acsUrl"
              type="url"
              required
              value={form.acsUrl}
              onChange={(e) => set('acsUrl', e.target.value)}
              placeholder="https://sp.example.com/saml/acs"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
        </div>

        {mutation.isError && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {(mutation.error as Error)?.message || 'Failed to create SAML service provider.'}
          </div>
        )}

        <div className="flex justify-end gap-3 border-t border-gray-200 pt-4">
          <button
            type="button"
            onClick={() => navigate(`/console/realms/${name}/saml-providers`)}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
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
