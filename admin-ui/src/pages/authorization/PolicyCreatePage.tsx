import { useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createPolicy } from '../../api/authorization';
import { getErrorMessage } from '../../utils/getErrorMessage';

export default function PolicyCreatePage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    name: '',
    description: '',
    effect: 'allow' as 'allow' | 'deny',
    conditions: '{}',
    enabled: true,
  });
  const [conditionsError, setConditionsError] = useState('');

  const createMutation = useMutation({
    mutationFn: () => {
      const parsed = JSON.parse(form.conditions);
      return createPolicy(name!, {
        name: form.name,
        description: form.description || undefined,
        effect: form.effect,
        conditions: parsed,
        enabled: form.enabled,
      });
    },
    onSuccess: (policy) => {
      queryClient.invalidateQueries({ queryKey: ['policies', name] });
      navigate(`/console/realms/${name}/authorization-policies/${policy.id}`);
    },
  });

  function validateConditions(value: string): boolean {
    try {
      JSON.parse(value);
      setConditionsError('');
      return true;
    } catch {
      setConditionsError('Invalid JSON — please fix before saving.');
      return false;
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validateConditions(form.conditions)) return;
    createMutation.mutate();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Create Policy</h1>

      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="policy-name" className="mb-1.5 block text-sm font-medium text-gray-700">Name</label>
            <input
              id="policy-name"
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. require-mfa-for-admin"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="policy-description" className="mb-1.5 block text-sm font-medium text-gray-700">Description</label>
            <input
              id="policy-description"
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-gray-700">Effect</p>
          <div className="flex gap-6">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
              <input
                type="radio"
                name="effect"
                value="allow"
                checked={form.effect === 'allow'}
                onChange={() => setForm({ ...form, effect: 'allow' })}
                className="text-indigo-600 focus:ring-indigo-500"
              />
              <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Allow</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
              <input
                type="radio"
                name="effect"
                value="deny"
                checked={form.effect === 'deny'}
                onChange={() => setForm({ ...form, effect: 'deny' })}
                className="text-indigo-600 focus:ring-indigo-500"
              />
              <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Deny</span>
            </label>
          </div>
        </div>

        <div>
          <label htmlFor="policy-conditions" className="mb-1.5 block text-sm font-medium text-gray-700">
            Conditions (JSON)
          </label>
          <textarea
            id="policy-conditions"
            rows={8}
            value={form.conditions}
            onChange={(e) => {
              setForm({ ...form, conditions: e.target.value });
              if (conditionsError) validateConditions(e.target.value);
            }}
            onBlur={(e) => validateConditions(e.target.value)}
            className={`w-full rounded-md border px-3 py-2 font-mono text-sm shadow-sm focus:ring-1 focus:outline-none ${conditionsError ? 'border-red-400 focus:border-red-400 focus:ring-red-400' : 'border-gray-300 focus:border-indigo-500 focus:ring-indigo-500'}`}
          />
          {conditionsError && (
            <p className="mt-1 text-xs text-red-600">{conditionsError}</p>
          )}
        </div>

        <div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            Enabled
          </label>
        </div>

        {createMutation.isError && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {getErrorMessage(createMutation.error, 'Failed to create policy.')}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate(`/console/realms/${name}/authorization-policies`)}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={createMutation.isPending || !!conditionsError}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {createMutation.isPending ? 'Creating...' : 'Create Policy'}
          </button>
        </div>
      </form>
    </div>
  );
}
