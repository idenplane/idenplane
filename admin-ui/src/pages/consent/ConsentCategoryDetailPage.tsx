import { useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getConsentCategoryById,
  getCategoryStatistics,
  createConsentCategory,
  updateConsentCategory,
  deleteConsentCategory,
} from '../../api/consent';
import type { ConsentCategory } from '../../types';
import ConfirmDialog from '../../components/ConfirmDialog';

const isCreateMode = (categoryId: string | undefined) =>
  !categoryId || categoryId === 'new';

interface CategoryForm {
  key: string;
  displayName: string;
  description: string;
  required: boolean;
  configurableByUser: boolean;
  showInAccountPortal: boolean;
  order: number;
}

const EMPTY_FORM: CategoryForm = {
  key: '',
  displayName: '',
  description: '',
  required: false,
  configurableByUser: true,
  showInAccountPortal: true,
  order: 0,
};

export default function ConsentCategoryDetailPage() {
  const { name, categoryId } = useParams<{ name: string; categoryId?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEdit = !isCreateMode(categoryId);

  const [form, setForm] = useState<CategoryForm>(EMPTY_FORM);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const { data: category, isLoading } = useQuery({
    queryKey: ['consentCategory', name, categoryId],
    queryFn: () => getConsentCategoryById(name!, categoryId!),
    enabled: isEdit && !!name && !!categoryId,
  });

  const { data: stats } = useQuery({
    queryKey: ['consentCategoryStats', name, categoryId],
    queryFn: () => getCategoryStatistics(name!, categoryId!),
    enabled: isEdit && !!name && !!categoryId,
  });

  // Seed the editable form from fetched data when the loaded category changes.
  // Adjusting state during render (vs. an effect) avoids an extra render pass.
  const [seededCategory, setSeededCategory] = useState(category);
  if (category && category !== seededCategory) {
    setSeededCategory(category);
    setForm({
      key: category.key,
      displayName: category.displayName,
      description: category.description ?? '',
      required: category.required,
      configurableByUser: category.configurableByUser,
      showInAccountPortal: category.showInAccountPortal,
      order: category.order,
    });
  }

  // Create accepts the full shape; update keeps the key immutable.
  const toCreatePayload = (f: CategoryForm): Partial<ConsentCategory> => ({
    key: f.key,
    displayName: f.displayName,
    description: f.description || null,
    required: f.required,
    configurableByUser: f.configurableByUser,
    showInAccountPortal: f.showInAccountPortal,
    order: f.order,
  });
  const toUpdatePayload = (f: CategoryForm): Partial<ConsentCategory> => {
    const { key: _key, ...rest } = toCreatePayload(f);
    void _key;
    return rest;
  };

  const createMutation = useMutation({
    mutationFn: () => createConsentCategory(name!, toCreatePayload(form)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['consentCategories', name] });
      setSuccessMessage('Consent category created successfully');
      setErrorMessage('');
      setTimeout(() => navigate(`/console/realms/${name}/consent-categories`), 1500);
    },
    onError: (error: Error) => {
      setErrorMessage(error.message || 'Failed to create consent category');
      setSuccessMessage('');
    },
  });

  const updateMutation = useMutation({
    mutationFn: () => updateConsentCategory(name!, categoryId!, toUpdatePayload(form)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['consentCategory', name, categoryId] });
      queryClient.invalidateQueries({ queryKey: ['consentCategories', name] });
      setSuccessMessage('Consent category updated successfully');
      setErrorMessage('');
      setTimeout(() => setSuccessMessage(''), 3000);
    },
    onError: (error: Error) => {
      setErrorMessage(error.message || 'Failed to update consent category');
      setSuccessMessage('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteConsentCategory(name!, categoryId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['consentCategories', name] });
      navigate(`/console/realms/${name}/consent-categories`);
    },
    onError: (error: Error) => {
      setErrorMessage(error.message || 'Failed to delete consent category');
      setSuccessMessage('');
      setShowDeleteDialog(false);
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (isEdit) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  if (isEdit && isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (isEdit && !category) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Consent category not found</div>
      </div>
    );
  }

  const pageTitle = isEdit
    ? category?.displayName ?? 'Edit Category'
    : 'Create Consent Category';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{pageTitle}</h1>
          {isEdit && category?.required && (
            <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-700">
              Required
            </span>
          )}
        </div>
        {isEdit && (
          <button
            onClick={() => setShowDeleteDialog(true)}
            className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            Delete
          </button>
        )}
      </div>

      {/* Success/Error Messages */}
      {successMessage && (
        <div className="rounded-md bg-green-50 p-4">
          <p className="text-sm text-green-800">{successMessage}</p>
        </div>
      )}
      {errorMessage && (
        <div className="rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-800">{errorMessage}</p>
        </div>
      )}

      {/* Settings Form */}
      <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Settings</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="key" className="block text-sm font-medium text-gray-700">
              Key
            </label>
            <input
              type="text"
              id="key"
              value={form.key}
              onChange={(e) => setForm({ ...form, key: e.target.value })}
              required
              disabled={isEdit}
              placeholder="marketing_emails"
              className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none disabled:bg-gray-100 disabled:text-gray-500"
            />
            <p className="mt-1 text-xs text-gray-400">
              {isEdit
                ? 'The key is immutable once created.'
                : 'Stable, unique identifier within this realm.'}
            </p>
          </div>
          <div>
            <label htmlFor="displayName" className="block text-sm font-medium text-gray-700">
              Display Name
            </label>
            <input
              type="text"
              id="displayName"
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700">
              Description
            </label>
            <textarea
              id="description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="order" className="block text-sm font-medium text-gray-700">
              Display Order
            </label>
            <input
              type="number"
              id="order"
              min={0}
              value={form.order}
              onChange={(e) =>
                setForm({ ...form, order: Number(e.target.value) || 0 })
              }
              className="w-32 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.required}
                onChange={(e) => setForm({ ...form, required: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm font-medium text-gray-700">Required</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.configurableByUser}
                onChange={(e) =>
                  setForm({ ...form, configurableByUser: e.target.checked })
                }
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm font-medium text-gray-700">
                Configurable by user
              </span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.showInAccountPortal}
                onChange={(e) =>
                  setForm({ ...form, showInAccountPortal: e.target.checked })
                }
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm font-medium text-gray-700">
                Show in account portal
              </span>
            </label>
          </div>
          <div>
            <button
              type="submit"
              disabled={updateMutation.isPending || createMutation.isPending}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {isEdit
                ? updateMutation.isPending
                  ? 'Saving...'
                  : 'Save'
                : createMutation.isPending
                  ? 'Creating...'
                  : 'Create'}
            </button>
          </div>
        </form>
      </div>

      {/* Usage statistics (edit mode) */}
      {isEdit && stats && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Usage</h2>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <CategoryStat label="Total Grants" value={stats.totalGrants} />
            <CategoryStat label="Total Revokes" value={stats.totalRevokes} />
            <CategoryStat label="Grants (24h)" value={stats.grants24h} />
            <CategoryStat label="Grants (7d)" value={stats.grants7d} />
            <CategoryStat label="Grants (30d)" value={stats.grants30d} />
            <CategoryStat label="Active Users (24h)" value={stats.activeUsers24h} />
            <CategoryStat label="Active Users (7d)" value={stats.activeUsers7d} />
            <CategoryStat label="Active Users (30d)" value={stats.activeUsers30d} />
          </dl>
        </div>
      )}

      {/* Metadata (only in edit mode) */}
      {isEdit && category && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Information</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-gray-500">ID</dt>
            <dd className="font-mono text-gray-900">{category.id}</dd>
            <dt className="text-gray-500">Created</dt>
            <dd className="text-gray-900">{new Date(category.createdAt).toLocaleString()}</dd>
            <dt className="text-gray-500">Last Updated</dt>
            <dd className="text-gray-900">{new Date(category.updatedAt).toLocaleString()}</dd>
          </dl>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showDeleteDialog}
        title="Delete Consent Category"
        message={`Are you sure you want to delete the consent category "${category?.displayName}"? This action cannot be undone.`}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setShowDeleteDialog(false)}
      />
    </div>
  );
}

function CategoryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-gray-50 p-3">
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className="mt-1 text-xl font-bold text-gray-900">
        {value.toLocaleString()}
      </dd>
    </div>
  );
}
