import { useState, type FormEvent, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { saveClient, type ClientData } from '../../../api/wizard';
import { useWizard } from '../../../context/WizardContext';
import { getErrorMessage } from '../../../utils/getErrorMessage';

export default function FirstClientStep() {
  const { setClient } = useWizard();
  const [form, setForm] = useState<ClientData>({
    clientId: '',
    redirectUris: [],
  });
  const [redirectUrisText, setRedirectUrisText] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [createdClient, setCreatedClient] = useState<{ clientId: string; clientSecret?: string; redirectUris: string[] } | null>(null);

  const mutation = useMutation({
    mutationFn: (data: ClientData) => saveClient(data),
    onSuccess: (result) => {
      if (result.clientId) {
        const clientData = {
          clientId: result.clientId,
          clientSecret: result.clientSecret || undefined,
          redirectUris: result.redirectUris || [],
        };
        setClient(clientData);
        setCreatedClient(clientData);
      }
    },
  });

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      setLocalError(null);

      // Validate clientId
      if (!form.clientId.trim()) {
        setLocalError('Client ID is required.');
        return;
      }

      // Parse redirect URIs
      const redirectUris = redirectUrisText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

      if (redirectUris.length === 0) {
        setLocalError('At least one redirect URI is required.');
        return;
      }

      // Validate redirect URIs format
      for (const uri of redirectUris) {
        try {
          const url = new URL(uri);
          if (!['http:', 'https:'].includes(url.protocol)) {
            setLocalError(`Invalid URI: ${uri}. Only http and https are allowed.`);
            return;
          }
        } catch {
          setLocalError(`Invalid URI format: ${uri}. Please include the full URL.`);
          return;
        }
      }

      mutation.mutate({
        clientId: form.clientId.trim(),
        redirectUris,
      });
    },
    [form.clientId, redirectUrisText, mutation],
  );

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  if (createdClient && createdClient.clientSecret) {
    return (
      <div className="max-w-xl">
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-gray-900">Client Created Successfully</h2>
          <p className="mt-1 text-sm text-gray-500">
            Your first client application has been created. Save the client secret below — it will not be shown again.
          </p>
        </div>

        <div className="rounded-lg border border-green-200 bg-green-50 p-6">
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-green-800">
                Client ID
              </label>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md border border-green-300 bg-white px-3 py-2 text-sm font-mono text-gray-900">
                  {createdClient.clientId}
                </code>
                <button
                  onClick={() => copyToClipboard(createdClient.clientId)}
                  className="rounded-md border border-green-300 bg-white px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-50"
                >
                  Copy
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-green-800">
                Client Secret
              </label>
              <div className="flex items-center gap-2">
                <code className={`flex-1 rounded-md border border-green-300 bg-white px-3 py-2 text-sm font-mono text-gray-900 ${!showSecret ? 'blur-sm' : ''}`}>
                  {createdClient.clientSecret}
                </code>
                <button
                  onClick={() => setShowSecret(!showSecret)}
                  className="rounded-md border border-green-300 bg-white px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-50"
                >
                  {showSecret ? 'Hide' : 'Show'}
                </button>
                <button
                  onClick={() => copyToClipboard(createdClient.clientSecret!)}
                  className="rounded-md border border-green-300 bg-white px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-50"
                >
                  Copy
                </button>
              </div>
              <p className="mt-1.5 text-xs text-green-700">
                Store this secret securely. It will not be displayed again.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-green-800">
                Redirect URIs
              </label>
              <div className="space-y-1">
                {createdClient.redirectUris.map((uri, index) => (
                  <code key={index} className="block rounded-md border border-green-300 bg-white px-3 py-1.5 text-sm font-mono text-gray-900">
                    {uri}
                  </code>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6 flex justify-end border-t border-green-200 pt-4">
            <button
              type="button"
              onClick={() => mutation.reset()}
              className="flex items-center gap-2 rounded-md bg-green-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-green-800"
            >
              Continue to Next Step
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Create First Client Application</h2>
        <p className="mt-1 text-sm text-gray-500">
          Set up your first client application to enable authentication for your app. Clients are applications that can request authentication.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
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
            placeholder="e.g. my-web-app"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-500">
            A unique identifier for your client application. Use lowercase letters, numbers, and hyphens.
          </p>
        </div>

        <div>
          <label htmlFor="redirectUris" className="mb-1.5 block text-sm font-medium text-gray-700">
            Redirect URIs
          </label>
          <textarea
            id="redirectUris"
            name="redirectUris"
            required
            value={redirectUrisText}
            onChange={(e) => setRedirectUrisText(e.target.value)}
            rows={4}
            placeholder={"https://app.example.com/callback\nhttp://localhost:3000/callback"}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-500">
            URLs where the authorization server will redirect after successful authentication. Enter one per line.
          </p>
        </div>

        {localError && (
          <div
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            className="rounded-md bg-red-50 p-3 text-sm text-red-700"
          >
            {localError}
          </div>
        )}

        {mutation.isError && (
          <div
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            className="rounded-md bg-red-50 p-3 text-sm text-red-700"
          >
            {getErrorMessage(mutation.error, 'Failed to create client.')}
          </div>
        )}

        <div className="flex justify-end border-t border-gray-200 pt-4">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="flex items-center gap-2 rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {mutation.isPending ? (
              <>
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span>Creating...</span>
              </>
            ) : (
              <>
                <span>Create Client</span>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}