import { useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '../../api/clients';
import { getErrorMessage } from '../../utils/getErrorMessage';

export default function ClientCreatePage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    clientId: '',
    name: '',
    description: '',
    clientType: 'CONFIDENTIAL' as 'CONFIDENTIAL' | 'PUBLIC',
    redirectUris: '',
    webOrigins: '',
    grantTypes: 'authorization_code',
    requireConsent: false,
    enabled: true,
  });

  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      createClient(name!, {
        clientId: form.clientId,
        name: form.name,
        description: form.description,
        clientType: form.clientType,
        redirectUris: form.redirectUris
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        webOrigins: form.webOrigins
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        grantTypes: form.grantTypes
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        requireConsent: form.requireConsent,
        enabled: form.enabled,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['clients', name] });
      if (data.clientSecret) {
        setCreatedSecret(data.clientSecret);
      } else {
        navigate(`/console/realms/${name}/clients`);
      }
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  if (createdSecret) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="rounded-lg border border-green-200 bg-green-50 p-6">
          <h2 className="text-lg font-semibold text-green-800">Client Created Successfully</h2>
          <p className="mt-2 text-sm text-green-700">
            Save the client secret below. It will not be shown again.
          </p>
          <div className="mt-4">
            <label className="mb-1.5 block text-sm font-medium text-green-800">
              Client Secret
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md border border-green-300 bg-white px-3 py-2 text-sm font-mono text-gray-900">
                {createdSecret}
              </code>
              <button
                onClick={() => navigator.clipboard.writeText(createdSecret)}
                className="rounded-md border border-green-300 bg-white px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-50"
              >
                Copy
              </button>
            </div>
          </div>
          <button
            onClick={() => navigate(`/console/realms/${name}/clients`)}
            className="mt-6 rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800"
          >
            Go to Clients
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Create Client</h1>
        <p className="mt-1 text-sm text-gray-500">
          Register a new client application in <span className="font-medium">{name}</span>
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="clientId" className="mb-1.5 block text-sm font-medium text-gray-700">
              Client ID
            </label>
            <input
              id="clientId"
              name="clientId"
              type="text"
              required
              value={form.clientId}
              onChange={(e) => setForm({ ...form, clientId: e.target.value })}
              placeholder="e.g. my-app"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="clientName" className="mb-1.5 block text-sm font-medium text-gray-700">
              Name
            </label>
            <input
              id="clientName"
              name="name"
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="My Application"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label htmlFor="description" className="mb-1.5 block text-sm font-medium text-gray-700">
            Description
          </label>
          <textarea
            id="description"
            name="description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="clientType" className="mb-1.5 block text-sm font-medium text-gray-700">
            Client Type
          </label>
          <select
            id="clientType"
            name="clientType"
            value={form.clientType}
            onChange={(e) =>
              setForm({ ...form, clientType: e.target.value as 'CONFIDENTIAL' | 'PUBLIC' })
            }
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          >
            <option value="CONFIDENTIAL">Confidential</option>
            <option value="PUBLIC">Public</option>
          </select>
          <p className="mt-1 text-xs text-gray-500">
            Confidential clients can securely store a client secret. Public clients (e.g. SPAs) cannot.
          </p>
        </div>

        <div>
          <label htmlFor="redirectUris" className="mb-1.5 block text-sm font-medium text-gray-700">
            Redirect URIs (one per line)
          </label>
          <textarea
            id="redirectUris"
            name="redirectUris"
            value={form.redirectUris}
            onChange={(e) => setForm({ ...form, redirectUris: e.target.value })}
            rows={3}
            placeholder={"https://app.example.com/callback\nhttp://localhost:3000/callback"}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="webOrigins" className="mb-1.5 block text-sm font-medium text-gray-700">
            Web Origins (one per line)
          </label>
          <textarea
            id="webOrigins"
            name="webOrigins"
            value={form.webOrigins}
            onChange={(e) => setForm({ ...form, webOrigins: e.target.value })}
            rows={2}
            placeholder={"https://app.example.com\nhttp://localhost:3000"}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="grantTypes" className="mb-1.5 block text-sm font-medium text-gray-700">
            Grant Types (comma-separated)
          </label>
          <input
            id="grantTypes"
            name="grantTypes"
            type="text"
            value={form.grantTypes}
            onChange={(e) => setForm({ ...form, grantTypes: e.target.value })}
            placeholder="authorization_code, refresh_token, client_credentials"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="requireConsent"
              checked={form.requireConsent}
              onChange={(e) => setForm({ ...form, requireConsent: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <label htmlFor="requireConsent" className="text-sm font-medium text-gray-700">
              Require Consent
            </label>
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
        </div>

        {mutation.isError && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {getErrorMessage(mutation.error, 'Failed to create client.')}
          </div>
        )}

        <div className="flex justify-end gap-3 border-t border-gray-200 pt-4">
          <button
            type="button"
            onClick={() => navigate(`/console/realms/${name}/clients`)}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {mutation.isPending ? 'Creating...' : 'Create Client'}
          </button>
        </div>
      </form>
    </div>
  );
}
