import { useState, useEffect, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getConsentCategoryById,
  updateConsentCategory,
  deleteConsentCategory,
} from '../../api/consent';
import ConfirmDialog from '../../components/ConfirmDialog';

export default function ConsentCategoryDetailPage() {
  const { name, categoryId } = useParams<{ name: string; categoryId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    name: '',
    description: '',
    required: false,
  });
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const { data: category, isLoading } = useQuery({
    queryKey: ['consentCategory', name, categoryId],
    queryFn: () => getConsentCategoryById(name!, categoryId!),
    enabled: !!name && !!categoryId,
  });

  useEffect(() => {
    if (category) {
      setForm({
        name: category.name,
        description: category.description || '',
        required: category.required,
      });
    }
  }, [category]);

  const updateMutation = useMutation({
    mutationFn: (data: { name: string; description: string; required: boolean }) =>
      updateConsentCategory(name!, categoryId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['consentCategory', name, categoryId] });
      queryClient.invalidateQueries({ queryKey: ['consentCategories', name] });
      setSuccessMessage('Consent category updated successfully');
      setErrorMessage('');
      setTimeout(() => setSuccessMessage(''), 3000);
    },
    onError: (error: any) => {
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
    onError: (error: any) => {
      setErrorMessage(error.message || 'Failed to delete consent category');
      setSuccessMessage('');
      setShowDeleteDialog(false);
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    updateMutation.mutate({
      name: form.name,
      description: form.description,
      required: form.required,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!category) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Consent category not found</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{category.name}</h1>
          {category.required && (
            <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-700">
              Required
            </span>
          )}
        </div>
        <button
          onClick={() => setShowDeleteDialog(true)}
          className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
        >
          Delete
        </button>
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
            <label htmlFor="name" className="block text-sm font-medium text-gray-700">
              Name
            </label>
            <input
              type="text"
              id="name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
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
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="required"
                checked={form.required}
                onChange={(e) => setForm({ ...form, required: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <label htmlFor="required" className="text-sm font-medium text-gray-700">
                Required
              </label>
            </div>
          </div>
          <div>
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>

      {/* Metadata */}
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

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showDeleteDialog}
        title="Delete Consent Category"
        message={`Are you sure you want to delete the consent category "${category.name}"? This action cannot be undone.`}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setShowDeleteDialog(false)}
      />
    </div>
  );
}