import { useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '../../api/clients';
import { getErrorMessage } from '../../utils/getErrorMessage';
import { CLIENT_TEMPLATES, type ClientTemplate } from '../../data/clientTemplates';

const TEMPLATE_CATEGORIES = Array.from(new Set(CLIENT_TEMPLATES.map((t) => t.category)));

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
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const selectedTemplate = CLIENT_TEMPLATES.find((t) => t.id === selectedTemplateId) ?? null;

  function applyTemplate(template: ClientTemplate | null) {
    if (!template) {
      setSelectedTemplateId('');
      return;
    }
    setSelectedTemplateId(template.id);
    setForm((prev) => ({
      ...prev,
      clientId: prev.clientId || template.id,
      name: template.name,
      description: template.description,
      clientType: template.clientType,
      redirectUris: template.redirectUriPattern,
      grantTypes: template.grantTypes.join(', '),
    }));
  }

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
        <div className="rounded-lg border border-success-soft bg-success-soft p-6">
          <h2 className="text-lg font-semibold text-success-fg">Client Created Successfully</h2>
          <p className="mt-2 text-sm text-success-fg">
            Save the client secret below. It will not be shown again.
          </p>
          <div className="mt-4">
            <label className="mb-1.5 block text-sm font-medium text-success-fg">
              Client Secret
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md border border-success-soft bg-surface px-3 py-2 text-sm font-mono text-fg">
                {createdSecret}
              </code>
              <button
                onClick={() => navigator.clipboard.writeText(createdSecret)}
                className="rounded-md border border-success-soft bg-surface px-3 py-2 text-sm font-medium text-success-fg hover:bg-success-soft"
              >
                Copy
              </button>
            </div>
          </div>
          <button
            onClick={() => navigate(`/console/realms/${name}/clients`)}
            className="mt-6 rounded-md bg-success px-4 py-2 text-sm font-medium text-white hover:bg-green-800"
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
        <h1 className="text-2xl font-bold text-fg">Create Client</h1>
        <p className="mt-1 text-sm text-subtle">
          Register a new client application in <span className="font-medium">{name}</span>
        </p>
      </div>

      <div className="mb-6 rounded-lg border border-line bg-surface p-6 shadow-sm">
        <label htmlFor="template" className="mb-1.5 block text-sm font-medium text-muted">
          Start from a template
        </label>
        <select
          id="template"
          value={selectedTemplateId}
          onChange={(e) =>
            applyTemplate(CLIENT_TEMPLATES.find((t) => t.id === e.target.value) ?? null)
          }
          className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
        >
          <option value="">— None (start from scratch) —</option>
          {TEMPLATE_CATEGORIES.map((category) => (
            <optgroup key={category} label={category}>
              {CLIENT_TEMPLATES.filter((t) => t.category === category).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        {selectedTemplate && (
          <div className="mt-4 rounded-md border border-info-soft bg-info-soft p-4 text-sm">
            <p className="font-medium text-info-fg">
              Redirect URI pattern: <code>{selectedTemplate.redirectUriPattern}</code>
            </p>
            <p className="mt-1 text-info-fg">
              Replace <code>{'{baseUrl}'}</code> with {selectedTemplate.name}&apos;s own URL, then update the
              Redirect URIs field below before saving.
            </p>
            <p className="mt-3 font-medium text-info-fg">Setup on the {selectedTemplate.name} side:</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-info-fg">
              {selectedTemplate.setupInstructions.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-line bg-surface p-6 shadow-sm">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="clientId" className="mb-1.5 block text-sm font-medium text-muted">
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
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="clientName" className="mb-1.5 block text-sm font-medium text-muted">
              Name
            </label>
            <input
              id="clientName"
              name="name"
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="My Application"
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label htmlFor="description" className="mb-1.5 block text-sm font-medium text-muted">
            Description
          </label>
          <textarea
            id="description"
            name="description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="clientType" className="mb-1.5 block text-sm font-medium text-muted">
            Client Type
          </label>
          <select
            id="clientType"
            name="clientType"
            value={form.clientType}
            onChange={(e) =>
              setForm({ ...form, clientType: e.target.value as 'CONFIDENTIAL' | 'PUBLIC' })
            }
            className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          >
            <option value="CONFIDENTIAL">Confidential</option>
            <option value="PUBLIC">Public</option>
          </select>
          <p className="mt-1 text-xs text-subtle">
            Confidential clients can securely store a client secret. Public clients (e.g. SPAs) cannot.
          </p>
        </div>

        <div>
          <label htmlFor="redirectUris" className="mb-1.5 block text-sm font-medium text-muted">
            Redirect URIs (one per line)
          </label>
          <textarea
            id="redirectUris"
            name="redirectUris"
            value={form.redirectUris}
            onChange={(e) => setForm({ ...form, redirectUris: e.target.value })}
            rows={3}
            placeholder={"https://app.example.com/callback\nhttp://localhost:3000/callback"}
            className="w-full rounded-md border border-line-strong px-3 py-2 text-sm font-mono shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="webOrigins" className="mb-1.5 block text-sm font-medium text-muted">
            Web Origins (one per line)
          </label>
          <textarea
            id="webOrigins"
            name="webOrigins"
            value={form.webOrigins}
            onChange={(e) => setForm({ ...form, webOrigins: e.target.value })}
            rows={2}
            placeholder={"https://app.example.com\nhttp://localhost:3000"}
            className="w-full rounded-md border border-line-strong px-3 py-2 text-sm font-mono shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="grantTypes" className="mb-1.5 block text-sm font-medium text-muted">
            Grant Types (comma-separated)
          </label>
          <input
            id="grantTypes"
            name="grantTypes"
            type="text"
            value={form.grantTypes}
            onChange={(e) => setForm({ ...form, grantTypes: e.target.value })}
            placeholder="authorization_code, refresh_token, client_credentials"
            className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="requireConsent"
              checked={form.requireConsent}
              onChange={(e) => setForm({ ...form, requireConsent: e.target.checked })}
              className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
            />
            <label htmlFor="requireConsent" className="text-sm font-medium text-muted">
              Require Consent
            </label>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="enabled"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
            />
            <label htmlFor="enabled" className="text-sm font-medium text-muted">
              Enabled
            </label>
          </div>
        </div>

        {mutation.isError && (
          <div className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
            {getErrorMessage(mutation.error, 'Failed to create client.')}
          </div>
        )}

        <div className="flex justify-end gap-3 border-t border-line pt-4">
          <button
            type="button"
            onClick={() => navigate(`/console/realms/${name}/clients`)}
            className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-muted hover:bg-hover"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {mutation.isPending ? 'Creating...' : 'Create Client'}
          </button>
        </div>
      </form>
    </div>
  );
}
