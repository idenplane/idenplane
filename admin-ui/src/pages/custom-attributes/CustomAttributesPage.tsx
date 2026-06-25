import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getCustomAttributes,
  createCustomAttribute,
  updateCustomAttribute,
  deleteCustomAttribute,
} from '../../api/customAttributes';
import type { CustomAttribute, AttributeType } from '../../api/customAttributes';
import ConfirmDialog from '../../components/ConfirmDialog';
import { getErrorMessage } from '../../utils/getErrorMessage';

const ATTRIBUTE_TYPES: AttributeType[] = ['text', 'number', 'boolean', 'select', 'multi-select'];

const NEEDS_OPTIONS: AttributeType[] = ['select', 'multi-select'];
const NEEDS_LENGTH: AttributeType[] = ['text'];
const NEEDS_RANGE: AttributeType[] = ['number'];

interface FormState {
  name: string;
  displayName: string;
  type: AttributeType;
  required: boolean;
  showOnRegistration: boolean;
  showOnProfile: boolean;
  options: string;
  minLength: string;
  maxLength: string;
  min: string;
  max: string;
}

const emptyForm: FormState = {
  name: '',
  displayName: '',
  type: 'text',
  required: false,
  showOnRegistration: false,
  showOnProfile: false,
  options: '',
  minLength: '',
  maxLength: '',
  min: '',
  max: '',
};

function attributeToForm(attr: CustomAttribute): FormState {
  return {
    name: attr.name,
    displayName: attr.displayName,
    type: attr.type,
    required: attr.required,
    showOnRegistration: attr.showOnRegistration,
    showOnProfile: attr.showOnProfile,
    options: attr.options.join(', '),
    minLength: attr.minLength !== null ? String(attr.minLength) : '',
    maxLength: attr.maxLength !== null ? String(attr.maxLength) : '',
    min: attr.min !== null ? String(attr.min) : '',
    max: attr.max !== null ? String(attr.max) : '',
  };
}

function formToPayload(form: FormState): Partial<CustomAttribute> {
  return {
    name: form.name,
    displayName: form.displayName,
    type: form.type,
    required: form.required,
    showOnRegistration: form.showOnRegistration,
    showOnProfile: form.showOnProfile,
    options: NEEDS_OPTIONS.includes(form.type)
      ? form.options.split(',').map((s) => s.trim()).filter(Boolean)
      : [],
    minLength:
      NEEDS_LENGTH.includes(form.type) && form.minLength !== ''
        ? Number(form.minLength)
        : null,
    maxLength:
      NEEDS_LENGTH.includes(form.type) && form.maxLength !== ''
        ? Number(form.maxLength)
        : null,
    min:
      NEEDS_RANGE.includes(form.type) && form.min !== ''
        ? Number(form.min)
        : null,
    max:
      NEEDS_RANGE.includes(form.type) && form.max !== ''
        ? Number(form.max)
        : null,
  };
}

function AttributeForm({
  form,
  onChange,
  editingName,
  onSubmit,
  onCancel,
  isPending,
  error,
}: {
  form: FormState;
  onChange: (f: FormState) => void;
  editingName: boolean;
  onSubmit: (e: FormEvent) => void;
  onCancel: () => void;
  isPending: boolean;
  error: unknown;
}) {
  const set = (patch: Partial<FormState>) => onChange({ ...form, ...patch });

  return (
    <form
      onSubmit={onSubmit}
      className="mb-6 space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
    >
      <h2 className="text-lg font-semibold text-gray-900">
        {editingName ? 'Edit Attribute' : 'New Attribute'}
      </h2>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="attr-name" className="mb-1.5 block text-sm font-medium text-gray-700">
            Name
          </label>
          <input
            id="attr-name"
            type="text"
            required
            readOnly={editingName}
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="e.g. department"
            className={`w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none ${editingName ? 'bg-gray-50 text-gray-500' : ''}`}
          />
        </div>

        <div>
          <label htmlFor="attr-display-name" className="mb-1.5 block text-sm font-medium text-gray-700">
            Display Name
          </label>
          <input
            id="attr-display-name"
            type="text"
            required
            value={form.displayName}
            onChange={(e) => set({ displayName: e.target.value })}
            placeholder="e.g. Department"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          />
        </div>
      </div>

      <div>
        <label htmlFor="attr-type" className="mb-1.5 block text-sm font-medium text-gray-700">
          Type
        </label>
        <select
          id="attr-type"
          value={form.type}
          onChange={(e) => set({ type: e.target.value as AttributeType })}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
        >
          {ATTRIBUTE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {NEEDS_OPTIONS.includes(form.type) && (
        <div>
          <label htmlFor="attr-options" className="mb-1.5 block text-sm font-medium text-gray-700">
            Options (comma-separated)
          </label>
          <textarea
            id="attr-options"
            rows={2}
            value={form.options}
            onChange={(e) => set({ options: e.target.value })}
            placeholder="e.g. Engineering, Marketing, Sales"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          />
        </div>
      )}

      {NEEDS_LENGTH.includes(form.type) && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="attr-min-length" className="mb-1.5 block text-sm font-medium text-gray-700">
              Min Length
            </label>
            <input
              id="attr-min-length"
              type="number"
              min={0}
              value={form.minLength}
              onChange={(e) => set({ minLength: e.target.value })}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="attr-max-length" className="mb-1.5 block text-sm font-medium text-gray-700">
              Max Length
            </label>
            <input
              id="attr-max-length"
              type="number"
              min={0}
              value={form.maxLength}
              onChange={(e) => set({ maxLength: e.target.value })}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
        </div>
      )}

      {NEEDS_RANGE.includes(form.type) && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="attr-min" className="mb-1.5 block text-sm font-medium text-gray-700">
              Min
            </label>
            <input
              id="attr-min"
              type="number"
              value={form.min}
              onChange={(e) => set({ min: e.target.value })}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="attr-max" className="mb-1.5 block text-sm font-medium text-gray-700">
              Max
            </label>
            <input
              id="attr-max"
              type="number"
              value={form.max}
              onChange={(e) => set({ max: e.target.value })}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-6">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={form.required}
            onChange={(e) => set({ required: e.target.checked })}
            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          Required
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={form.showOnRegistration}
            onChange={(e) => set({ showOnRegistration: e.target.checked })}
            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          Show on Registration
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={form.showOnProfile}
            onChange={(e) => set({ showOnProfile: e.target.checked })}
            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          Show on Profile
        </label>
      </div>

      {error != null && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {getErrorMessage(error, 'Failed to save attribute.')}
        </div>
      )}

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {isPending ? 'Saving...' : 'Save'}
        </button>
      </div>
    </form>
  );
}

export default function CustomAttributesPage() {
  const { name } = useParams<{ name: string }>();
  const queryClient = useQueryClient();

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<FormState>(emptyForm);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(emptyForm);

  const [deleteTarget, setDeleteTarget] = useState<CustomAttribute | null>(null);

  const { data: attributes, isLoading, error } = useQuery({
    queryKey: ['custom-attributes', name],
    queryFn: () => getCustomAttributes(name!),
    enabled: !!name,
  });

  const createMutation = useMutation({
    mutationFn: () => createCustomAttribute(name!, formToPayload(createForm)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-attributes', name] });
      setCreateForm(emptyForm);
      setShowCreate(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: () => updateCustomAttribute(name!, editingId!, formToPayload(editForm)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-attributes', name] });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCustomAttribute(name!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-attributes', name] });
      setDeleteTarget(null);
    },
  });

  function startEdit(attr: CustomAttribute) {
    setShowCreate(false);
    setEditingId(attr.id);
    setEditForm(attributeToForm(attr));
  }

  function cancelEdit() {
    setEditingId(null);
  }

  if (isLoading) {
    return <div className="text-gray-500">Loading custom attributes...</div>;
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
        {getErrorMessage(error, 'Failed to load custom attributes.')}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Custom Attributes</h1>
        <button
          onClick={() => {
            setEditingId(null);
            setCreateForm(emptyForm);
            setShowCreate(true);
          }}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Add Attribute
        </button>
      </div>

      {showCreate && (
        <AttributeForm
          form={createForm}
          onChange={setCreateForm}
          editingName={false}
          onSubmit={(e) => { e.preventDefault(); createMutation.mutate(); }}
          onCancel={() => { setShowCreate(false); setCreateForm(emptyForm); }}
          isPending={createMutation.isPending}
          error={createMutation.isError ? createMutation.error : null}
        />
      )}

      {editingId && (
        <AttributeForm
          form={editForm}
          onChange={setEditForm}
          editingName={true}
          onSubmit={(e) => { e.preventDefault(); updateMutation.mutate(); }}
          onCancel={cancelEdit}
          isPending={updateMutation.isPending}
          error={updateMutation.isError ? updateMutation.error : null}
        />
      )}

      {!attributes || attributes.length === 0 ? (
        <div className="rounded-md border border-gray-200 bg-white p-8 text-center text-gray-500">
          No custom attributes defined for this realm.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Display Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Required</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Registration</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Profile</th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {attributes.map((attr) => (
                <tr key={attr.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-6 py-4">
                    <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-800">
                      {attr.name}
                    </code>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-700">{attr.displayName}</td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                      {attr.type}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    {attr.required ? (
                      <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Yes</span>
                    ) : (
                      <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">No</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    {attr.showOnRegistration ? (
                      <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Yes</span>
                    ) : (
                      <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">No</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    {attr.showOnProfile ? (
                      <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Yes</span>
                    ) : (
                      <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">No</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right">
                    <button
                      onClick={() => startEdit(attr)}
                      className="mr-4 text-sm font-medium text-indigo-600 hover:text-indigo-900"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setDeleteTarget(attr)}
                      className="text-sm font-medium text-red-600 hover:text-red-800"
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

      {deleteMutation.isError && (
        <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
          {getErrorMessage(deleteMutation.error, 'Failed to delete attribute.')}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="Delete Custom Attribute"
        message={`Are you sure you want to delete "${deleteTarget?.displayName}"? This will remove the attribute definition from the realm.`}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
