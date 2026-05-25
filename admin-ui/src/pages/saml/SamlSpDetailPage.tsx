import { useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getSamlSp,
  updateSamlSp,
  deleteSamlSp,
} from '../../api/samlServiceProviders';
import ConfirmDialog from '../../components/ConfirmDialog';

export default function SamlSpDetailPage() {
  const { name, id } = useParams<{ name: string; id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showDelete, setShowDelete] = useState(false);

  const { data: sp, isLoading } = useQuery({
    queryKey: ['saml-service-provider', name, id],
    queryFn: () => getSamlSp(name!, id!),
    enabled: !!name && !!id,
  });

  const [form, setForm] = useState({
    name: '',
    entityId: '',
    enabled: true,
    acsUrl: '',
    sloUrl: '',
    certificate: '',
    signAssertions: false,
    signResponses: false,
    nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
  });

  // Seed the editable form from fetched data when the loaded SP changes.
  // Adjusting state during render (vs. an effect) avoids an extra render pass.
  const [seededSp, setSeededSp] = useState(sp);
  if (sp && sp !== seededSp) {
    setSeededSp(sp);
    setForm({
      name: sp.name,
      entityId: sp.entityId,
      enabled: sp.enabled,
      acsUrl: sp.acsUrl,
      sloUrl: sp.sloUrl ?? '',
      certificate: sp.certificate ?? '',
      signAssertions: sp.signAssertions,
      signResponses: sp.signResponses,
      nameIdFormat: sp.nameIdFormat,
    });
  }

  const updateMutation = useMutation({
    mutationFn: () =>
      updateSamlSp(name!, id!, {
        name: form.name,
        entityId: form.entityId,
        enabled: form.enabled,
        acsUrl: form.acsUrl,
        sloUrl: form.sloUrl || undefined,
        certificate: form.certificate || undefined,
        signAssertions: form.signAssertions,
        signResponses: form.signResponses,
        nameIdFormat: form.nameIdFormat,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saml-service-provider', name, id] });
      queryClient.invalidateQueries({ queryKey: ['saml-service-providers', name] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteSamlSp(name!, id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saml-service-providers', name] });
      navigate(`/console/realms/${name}/saml-providers`);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    updateMutation.mutate();
  }

  const set = (field: string, value: string | boolean) =>
    setForm((f) => ({ ...f, [field]: value }));

  if (isLoading) {
    return <div className="text-gray-500">Loading service provider...</div>;
  }

  if (!sp) {
    return <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">SAML service provider not found.</div>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{sp.name}</h1>
          <p className="mt-1 text-sm text-gray-500">{sp.entityId}</p>
        </div>
        <button
          onClick={() => setShowDelete(true)}
          className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
        >
          Delete
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        {/* General */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">General</h2>

          <div className="grid grid-cols-2 gap-4">
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
            <div className="flex items-end gap-2 pb-1">
              <input
                type="checkbox"
                id="enabled"
                checked={form.enabled}
                onChange={(e) => set('enabled', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <label htmlFor="enabled" className="text-sm font-medium text-gray-700">
                Enabled
              </label>
            </div>
          </div>

          <div>
            <label htmlFor="field-saml-entityId" className="mb-1.5 block text-sm font-medium text-gray-700">Entity ID *</label>
            <input
              id="field-saml-entityId"
              type="text"
              required
              value={form.entityId}
              onChange={(e) => set('entityId', e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Endpoints */}
        <div className="space-y-4 border-t border-gray-200 pt-4">
          <h2 className="text-lg font-semibold text-gray-900">Endpoints</h2>

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

          <div>
            <label htmlFor="field-saml-sloUrl" className="mb-1.5 block text-sm font-medium text-gray-700">SLO URL</label>
            <input
              id="field-saml-sloUrl"
              type="url"
              value={form.sloUrl}
              onChange={(e) => set('sloUrl', e.target.value)}
              placeholder="https://sp.example.com/saml/slo"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Security */}
        <div className="space-y-4 border-t border-gray-200 pt-4">
          <h2 className="text-lg font-semibold text-gray-900">Security</h2>

          <div>
            <label htmlFor="field-saml-certificate" className="mb-1.5 block text-sm font-medium text-gray-700">Certificate</label>
            <textarea
              id="field-saml-certificate"
              rows={4}
              value={form.certificate}
              onChange={(e) => set('certificate', e.target.value)}
              placeholder="Paste X.509 certificate (PEM format)"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.signAssertions}
                onChange={(e) => set('signAssertions', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm text-gray-700">Sign assertions</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.signResponses}
                onChange={(e) => set('signResponses', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm text-gray-700">Sign responses</span>
            </label>
          </div>

          <div>
            <label htmlFor="field-saml-nameIdFormat" className="mb-1.5 block text-sm font-medium text-gray-700">Name ID Format</label>
            <select
              id="field-saml-nameIdFormat"
              value={form.nameIdFormat}
              onChange={(e) => set('nameIdFormat', e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            >
              <option value="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">Email Address</option>
              <option value="urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified">Unspecified</option>
              <option value="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent">Persistent</option>
              <option value="urn:oasis:names:tc:SAML:2.0:nameid-format:transient">Transient</option>
            </select>
          </div>
        </div>

        {updateMutation.isSuccess && (
          <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
            SAML service provider updated successfully.
          </div>
        )}
        {updateMutation.isError && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            Failed to update SAML service provider.
          </div>
        )}

        <div className="flex justify-end border-t border-gray-200 pt-4">
          <button
            type="submit"
            disabled={updateMutation.isPending}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>

      <ConfirmDialog
        isOpen={showDelete}
        title="Delete SAML Service Provider"
        message={`Are you sure you want to delete SAML service provider "${sp.name}"?`}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setShowDelete(false)}
      />
    </div>
  );
}
