import { useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router';
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
  /** Space-separated scope names while editing; parsed to string[] on submit. */
  scopes: string;
}

const EMPTY_FORM: CategoryForm = {
  key: '',
  displayName: '',
  description: '',
  required: false,
  configurableByUser: true,
  showInAccountPortal: true,
  order: 0,
  scopes: '',
};

/** Parse a space/comma-separated scope string into a clean string[]. */
const parseScopes = (raw: string): string[] =>
  raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

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
      scopes: category.scopes.join(' '),
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
    scopes: parseScopes(f.scopes),
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
        <div className="text-subtle">Loading...</div>
      </div>
    );
  }

  if (isEdit && !category) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-subtle">Consent category not found</div>
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
          <h1 className="text-2xl font-bold text-fg">{pageTitle}</h1>
          {isEdit && category?.required && (
            <span className="rounded-full bg-warning-soft px-3 py-1 text-xs font-medium text-warning-fg">
              Required
            </span>
          )}
        </div>
        {isEdit && (
          <button
            onClick={() => setShowDeleteDialog(true)}
            className="rounded-md border border-danger-soft px-4 py-2 text-sm font-medium text-danger-fg hover:bg-danger-soft"
          >
            Delete
          </button>
        )}
      </div>

      {/* Success/Error Messages */}
      {successMessage && (
        <div className="rounded-md bg-success-soft p-4">
          <p className="text-sm text-success-fg">{successMessage}</p>
        </div>
      )}
      {errorMessage && (
        <div className="rounded-md bg-danger-soft p-4">
          <p className="text-sm text-danger-fg">{errorMessage}</p>
        </div>
      )}

      {/* Settings Form */}
      <div className="space-y-4 rounded-lg border border-line bg-surface p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-fg">Settings</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="key" className="block text-sm font-medium text-muted">
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
              className="w-full rounded-md border border-line-strong px-3 py-2 font-mono text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none disabled:bg-sunken disabled:text-subtle"
            />
            <p className="mt-1 text-xs text-subtle">
              {isEdit
                ? 'The key is immutable once created.'
                : 'Stable, unique identifier within this realm.'}
            </p>
          </div>
          <div>
            <label htmlFor="displayName" className="block text-sm font-medium text-muted">
              Display Name
            </label>
            <input
              type="text"
              id="displayName"
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              required
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="description" className="block text-sm font-medium text-muted">
              Description
            </label>
            <textarea
              id="description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="order" className="block text-sm font-medium text-muted">
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
              className="w-32 rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="scopes" className="block text-sm font-medium text-muted">
              Governed Scopes
            </label>
            <input
              type="text"
              id="scopes"
              value={form.scopes}
              onChange={(e) => setForm({ ...form, scopes: e.target.value })}
              placeholder="profile email"
              className="w-full rounded-md border border-line-strong px-3 py-2 font-mono text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
            <p className="mt-1 text-xs text-subtle">
              Space-separated OIDC scopes this category governs (used to attribute
              consent grants for statistics). Leave empty to govern the scope whose
              name matches the key (<code className="font-mono">{form.key || 'key'}</code>).
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.required}
                onChange={(e) => setForm({ ...form, required: e.target.checked })}
                className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
              />
              <span className="text-sm font-medium text-muted">Required</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.configurableByUser}
                onChange={(e) =>
                  setForm({ ...form, configurableByUser: e.target.checked })
                }
                className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
              />
              <span className="text-sm font-medium text-muted">
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
                className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
              />
              <span className="text-sm font-medium text-muted">
                Show in account portal
              </span>
            </label>
          </div>
          <div>
            <button
              type="submit"
              disabled={updateMutation.isPending || createMutation.isPending}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
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
        <div className="rounded-lg border border-line bg-surface p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-fg">Usage</h2>
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
        <div className="rounded-lg border border-line bg-surface p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-fg">Information</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-subtle">ID</dt>
            <dd className="font-mono text-fg">{category.id}</dd>
            <dt className="text-subtle">Created</dt>
            <dd className="text-fg">{new Date(category.createdAt).toLocaleString()}</dd>
            <dt className="text-subtle">Last Updated</dt>
            <dd className="text-fg">{new Date(category.updatedAt).toLocaleString()}</dd>
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
    <div className="rounded-md bg-sunken p-3">
      <dt className="text-xs font-medium text-subtle">{label}</dt>
      <dd className="mt-1 text-xl font-bold text-fg">
        {value.toLocaleString()}
      </dd>
    </div>
  );
}
