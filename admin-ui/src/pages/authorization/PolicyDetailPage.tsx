import { useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPolicy, updatePolicy, deletePolicy, testPolicy } from '../../api/authorization';
import ConfirmDialog from '../../components/ConfirmDialog';
import { getErrorMessage } from '../../utils/getErrorMessage';

export default function PolicyDetailPage() {
  const { name, policyId } = useParams<{ name: string; policyId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showDelete, setShowDelete] = useState(false);
  const [conditionsError, setConditionsError] = useState('');
  const [testInput, setTestInput] = useState('{}');
  const [testInputError, setTestInputError] = useState('');
  const [testResult, setTestResult] = useState<unknown>(null);

  const [form, setForm] = useState({
    name: '',
    description: '',
    effect: 'allow' as 'allow' | 'deny',
    conditions: '{}',
    enabled: true,
  });

  const { data: policy, isLoading } = useQuery({
    queryKey: ['policy', name, policyId],
    queryFn: () => getPolicy(name!, policyId!),
    enabled: !!name && !!policyId,
  });

  const [seededPolicy, setSeededPolicy] = useState(policy);
  if (policy && policy !== seededPolicy) {
    setSeededPolicy(policy);
    setForm({
      name: policy.name,
      description: policy.description ?? '',
      effect: policy.effect,
      conditions: JSON.stringify(policy.conditions, null, 2),
      enabled: policy.enabled,
    });
  }

  const updateMutation = useMutation({
    mutationFn: () => {
      const parsed = JSON.parse(form.conditions);
      return updatePolicy(name!, policyId!, {
        name: form.name,
        description: form.description || undefined,
        effect: form.effect,
        conditions: parsed,
        enabled: form.enabled,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policy', name, policyId] });
      queryClient.invalidateQueries({ queryKey: ['policies', name] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deletePolicy(name!, policyId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policies', name] });
      navigate(`/console/realms/${name}/authorization-policies`);
    },
  });

  const testMutation = useMutation({
    mutationFn: () => {
      const ctx = JSON.parse(testInput);
      return testPolicy(name!, policyId!, ctx);
    },
    onSuccess: (result) => setTestResult(result),
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

  function validateTestInput(value: string): boolean {
    try {
      JSON.parse(value);
      setTestInputError('');
      return true;
    } catch {
      setTestInputError('Invalid JSON context.');
      return false;
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validateConditions(form.conditions)) return;
    updateMutation.mutate();
  }

  function handleRunTest(e: FormEvent) {
    e.preventDefault();
    if (!validateTestInput(testInput)) return;
    testMutation.mutate();
  }

  if (isLoading) {
    return <div className="text-gray-500">Loading policy...</div>;
  }

  if (!policy) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">Policy not found.</div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{policy.name}</h1>
        <button
          onClick={() => setShowDelete(true)}
          className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
        >
          Delete Policy
        </button>
      </div>

      {/* Edit form */}
      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
      >
        <h2 className="text-lg font-semibold text-gray-900">Policy Settings</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="policy-name" className="mb-1.5 block text-sm font-medium text-gray-700">Name</label>
            <input
              id="policy-name"
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
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

        {updateMutation.isError && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {getErrorMessage(updateMutation.error, 'Failed to update policy.')}
          </div>
        )}

        {updateMutation.isSuccess && (
          <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
            Policy updated successfully.
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={updateMutation.isPending || !!conditionsError}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>

      {/* Test Policy section */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Test Policy</h2>
        <p className="text-sm text-gray-500">
          Provide an evaluation context as JSON to test how this policy responds.
        </p>

        <form onSubmit={handleRunTest} className="space-y-4">
          <div>
            <label htmlFor="test-context" className="mb-1.5 block text-sm font-medium text-gray-700">
              Context (JSON)
            </label>
            <textarea
              id="test-context"
              rows={6}
              value={testInput}
              onChange={(e) => {
                setTestInput(e.target.value);
                if (testInputError) validateTestInput(e.target.value);
              }}
              onBlur={(e) => validateTestInput(e.target.value)}
              className={`w-full rounded-md border px-3 py-2 font-mono text-sm shadow-sm focus:ring-1 focus:outline-none ${testInputError ? 'border-red-400 focus:border-red-400 focus:ring-red-400' : 'border-gray-300 focus:border-indigo-500 focus:ring-indigo-500'}`}
            />
            {testInputError && (
              <p className="mt-1 text-xs text-red-600">{testInputError}</p>
            )}
          </div>

          {testMutation.isError && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              {getErrorMessage(testMutation.error, 'Test evaluation failed.')}
            </div>
          )}

          <button
            type="submit"
            disabled={testMutation.isPending || !!testInputError}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {testMutation.isPending ? 'Running...' : 'Run Test'}
          </button>
        </form>

        {testResult !== null && (
          <div className="rounded-md bg-gray-50 border border-gray-200 p-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">Result</p>
            <pre className="overflow-auto font-mono text-sm text-gray-800">
              {JSON.stringify(testResult, null, 2)}
            </pre>
          </div>
        )}
      </section>

      <ConfirmDialog
        isOpen={showDelete}
        title="Delete Policy"
        message={`Are you sure you want to delete the policy "${policy.name}"? This action cannot be undone.`}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setShowDelete(false)}
      />
    </div>
  );
}
