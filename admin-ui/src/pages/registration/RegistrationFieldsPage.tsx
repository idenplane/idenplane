import { useState } from 'react';
import { useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getRegistrationFields,
  createRegistrationField,
  updateRegistrationField,
  deleteRegistrationField,
  type RegistrationField,
} from '../../api/registration';
import ConfirmDialog from '../../components/ConfirmDialog';

const FIELD_TYPES = ['text', 'email', 'password', 'number', 'select', 'checkbox'] as const;

export default function RegistrationFieldsPage() {
  const { name } = useParams<{ name: string }>();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editingField, setEditingField] = useState<RegistrationField | null>(null);
  const [deleteFieldId, setDeleteFieldId] = useState<string | null>(null);

  const { data: fields, isLoading, error } = useQuery({
    queryKey: ['registration-fields', name],
    queryFn: () => getRegistrationFields(name!),
    enabled: !!name,
  });

  const [form, setForm] = useState({
    name: '',
    displayName: '',
    type: 'text',
    required: false,
    placeholder: '',
    helpText: '',
    options: '',
    validationPattern: '',
    defaultValue: '',
    sortOrder: 0,
    enabled: true,
  });

  const resetForm = () => {
    setForm({
      name: '',
      displayName: '',
      type: 'text',
      required: false,
      placeholder: '',
      helpText: '',
      options: '',
      validationPattern: '',
      defaultValue: '',
      sortOrder: 0,
      enabled: true,
    });
  };

  const createMutation = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        options: form.options ? form.options.split(',').map(s => s.trim()) : [],
      };
      return createRegistrationField(name!, payload);
    },
    onSuccess: () => {
      setShowCreate(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['registration-fields', name] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editingField) return;
      const payload = {
        ...form,
        options: form.options ? form.options.split(',').map(s => s.trim()) : [],
      };
      await updateRegistrationField(name!, editingField.id, payload);
    },
    onSuccess: () => {
      setEditingField(null);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['registration-fields', name] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (fieldId: string) => deleteRegistrationField(name!, fieldId),
    onSuccess: () => {
      setDeleteFieldId(null);
      queryClient.invalidateQueries({ queryKey: ['registration-fields', name] });
    },
  });

  const startEdit = (field: RegistrationField) => {
    setEditingField(field);
    setForm({
      name: field.name,
      displayName: field.displayName,
      type: field.type,
      required: field.required,
      placeholder: field.placeholder || '',
      helpText: field.helpText || '',
      options: field.options?.join(', ') || '',
      validationPattern: field.validationPattern || '',
      defaultValue: field.defaultValue || '',
      sortOrder: field.sortOrder,
      enabled: field.enabled,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-danger-soft border border-danger-soft rounded-lg p-4 text-danger-fg">
        Failed to load registration fields: {(error as Error).message}
      </div>
    );
  }

  return (
    <div>
      <div className="sm:flex sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-fg">Registration Fields</h1>
          <p className="mt-1 text-sm text-subtle">
            Configure custom fields to collect during self-registration
          </p>
        </div>
        <button
          onClick={() => { resetForm(); setShowCreate(true); }}
          className="mt-4 sm:mt-0 px-4 py-2 bg-accent text-white rounded-md hover:bg-accent-hover"
        >
          Add Field
        </button>
      </div>

      {(showCreate || editingField) && (
        <div className="bg-surface shadow-sm rounded-lg border border-line p-6 mb-6">
          <h2 className="text-lg font-medium mb-4">
            {editingField ? 'Edit Field' : 'Create Field'}
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-muted">Field Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={!!editingField}
                className="mt-1 block w-full px-3 py-2 border border-line-strong rounded-md shadow-sm focus:outline-none focus:ring-accent focus:border-accent disabled:bg-sunken"
                placeholder="e.g., company_name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted">Display Name</label>
              <input
                type="text"
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-line-strong rounded-md shadow-sm focus:outline-none focus:ring-accent focus:border-accent"
                placeholder="e.g., Company Name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted">Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-line-strong rounded-md shadow-sm focus:outline-none focus:ring-accent focus:border-accent"
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted">Placeholder</label>
              <input
                type="text"
                value={form.placeholder}
                onChange={(e) => setForm({ ...form, placeholder: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-line-strong rounded-md shadow-sm focus:outline-none focus:ring-accent focus:border-accent"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-muted">Help Text</label>
              <input
                type="text"
                value={form.helpText}
                onChange={(e) => setForm({ ...form, helpText: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-line-strong rounded-md shadow-sm focus:outline-none focus:ring-accent focus:border-accent"
              />
            </div>
            {form.type === 'select' && (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-muted">Options (comma-separated)</label>
                <input
                  type="text"
                  value={form.options}
                  onChange={(e) => setForm({ ...form, options: e.target.value })}
                  className="mt-1 block w-full px-3 py-2 border border-line-strong rounded-md shadow-sm focus:outline-none focus:ring-accent focus:border-accent"
                  placeholder="Option A, Option B, Option C"
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-muted">Validation Pattern</label>
              <input
                type="text"
                value={form.validationPattern}
                onChange={(e) => setForm({ ...form, validationPattern: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-line-strong rounded-md shadow-sm focus:outline-none focus:ring-accent focus:border-accent"
                placeholder="e.g., ^[A-Za-z]+$"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted">Default Value</label>
              <input
                type="text"
                value={form.defaultValue}
                onChange={(e) => setForm({ ...form, defaultValue: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-line-strong rounded-md shadow-sm focus:outline-none focus:ring-accent focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted">Sort Order</label>
              <input
                type="number"
                value={form.sortOrder}
                onChange={(e) => setForm({ ...form, sortOrder: parseInt(e.target.value, 10) || 0 })}
                className="mt-1 block w-full px-3 py-2 border border-line-strong rounded-md shadow-sm focus:outline-none focus:ring-accent focus:border-accent"
              />
            </div>
            <div className="flex items-center">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={form.required}
                  onChange={(e) => setForm({ ...form, required: e.target.checked })}
                  className="h-4 w-4 text-accent border-line-strong rounded focus:ring-accent"
                />
                <span className="ml-2 text-sm text-muted">Required field</span>
              </label>
            </div>
            <div className="flex items-center">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                  className="h-4 w-4 text-accent border-line-strong rounded focus:ring-accent"
                />
                <span className="ml-2 text-sm text-muted">Enabled</span>
              </label>
            </div>
          </div>
          <div className="mt-4 flex justify-end space-x-3">
            <button
              onClick={() => { setShowCreate(false); setEditingField(null); resetForm(); }}
              className="px-4 py-2 border border-line-strong rounded-md text-muted hover:bg-hover"
            >
              Cancel
            </button>
            <button
              onClick={() => editingField ? updateMutation.mutate() : createMutation.mutate()}
              disabled={createMutation.isPending || updateMutation.isPending}
              className="px-4 py-2 bg-accent text-white rounded-md hover:bg-accent-hover disabled:opacity-50"
            >
              {editingField ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {fields && fields.length === 0 ? (
        <div className="bg-surface rounded-lg border border-line p-8 text-center">
          <svg className="mx-auto h-12 w-12 text-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-fg">No registration fields</h3>
          <p className="mt-1 text-sm text-subtle">Get started by creating a custom field.</p>
        </div>
      ) : fields && (
        <div className="bg-surface shadow-sm rounded-lg border border-line overflow-hidden">
          <table className="min-w-full divide-y divide-line">
            <thead className="bg-sunken">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-subtle uppercase tracking-wider">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-subtle uppercase tracking-wider">Display</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-subtle uppercase tracking-wider">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-subtle uppercase tracking-wider">Required</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-subtle uppercase tracking-wider">Enabled</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-subtle uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-surface divide-y divide-line">
              {fields.map((field) => (
                <tr key={field.id} className="hover:bg-hover">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-fg">{field.name}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-subtle">{field.displayName}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm text-subtle">{field.type}</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {field.required ? (
                      <span className="text-sm text-danger">Yes</span>
                    ) : (
                      <span className="text-sm text-subtle">No</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {field.enabled ? (
                      <span className="text-sm text-success">Yes</span>
                    ) : (
                      <span className="text-sm text-subtle">No</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => startEdit(field)}
                      className="text-accent hover:text-accent mr-4"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setDeleteFieldId(field.id)}
                      className="text-danger hover:text-danger-fg"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={deleteFieldId !== null}
        onClose={() => setDeleteFieldId(null)}
        onConfirm={() => deleteFieldId && deleteMutation.mutate(deleteFieldId)}
        title="Delete Field"
        message="Are you sure you want to delete this registration field? This action cannot be undone."
        confirmText={deleteMutation.isPending ? 'Deleting...' : 'Delete'}
        confirmDisabled={deleteMutation.isPending}
      />
    </div>
  );
}