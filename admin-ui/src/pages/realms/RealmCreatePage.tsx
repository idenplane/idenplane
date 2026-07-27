import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createRealm } from '../../api/realms';
import { getErrorMessage } from '../../utils/getErrorMessage';

export default function RealmCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    name: '',
    displayName: '',
    enabled: true,
    accessTokenLifespan: 300,
    refreshTokenLifespan: 1800,
  });

  const mutation = useMutation({
    mutationFn: () => createRealm(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['realms'] });
      navigate('/console/realms');
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Create Realm</h1>
        <p className="mt-1 text-sm text-gray-500">
          Set up a new identity realm
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div>
          <label htmlFor="realmName" className="mb-1.5 block text-sm font-medium text-gray-700">
            Name
          </label>
          <input
            id="realmName"
            name="name"
            type="text"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. my-realm"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-500">
            Unique identifier, lowercase letters, numbers, and hyphens only
          </p>
        </div>

        <div>
          <label htmlFor="displayName" className="mb-1.5 block text-sm font-medium text-gray-700">
            Display Name
          </label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            placeholder="e.g. My Realm"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="accessTokenLifespan" className="mb-1.5 block text-sm font-medium text-gray-700">
              Access Token Lifespan (seconds)
            </label>
            <input
              id="accessTokenLifespan"
              name="accessTokenLifespan"
              type="number"
              min={1}
              value={form.accessTokenLifespan}
              onChange={(e) =>
                setForm({ ...form, accessTokenLifespan: Number(e.target.value) })
              }
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="refreshTokenLifespan" className="mb-1.5 block text-sm font-medium text-gray-700">
              Refresh Token Lifespan (seconds)
            </label>
            <input
              id="refreshTokenLifespan"
              name="refreshTokenLifespan"
              type="number"
              min={1}
              value={form.refreshTokenLifespan}
              onChange={(e) =>
                setForm({ ...form, refreshTokenLifespan: Number(e.target.value) })
              }
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="enabled"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          <label htmlFor="enabled" className="text-sm font-medium text-gray-700">
            Enabled
          </label>
        </div>

        {mutation.isError && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {getErrorMessage(mutation.error, 'Failed to create realm.')}
          </div>
        )}

        <div className="flex justify-end gap-3 border-t border-gray-200 pt-4">
          <button
            type="button"
            onClick={() => navigate('/console/realms')}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {mutation.isPending ? 'Creating...' : 'Create Realm'}
          </button>
        </div>
      </form>
    </div>
  );
}
