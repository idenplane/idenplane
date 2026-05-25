import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getAuthFlowById,
  updateAuthFlow,
  type FlowStep,
  type AuthFlow,
} from '../../api/authFlows';
import { getErrorMessage } from '../../utils/getErrorMessage';
import FlowCanvas from '../../components/flow-editor/FlowCanvas';

export default function AuthFlowEditorPage() {
  const { name, flowId } = useParams<{ name: string; flowId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // ── Remote data ─────────────────────────────────────────

  const { data: remoteFlow, isLoading, error } = useQuery({
    queryKey: ['auth-flow', name, flowId],
    queryFn: () => getAuthFlowById(name!, flowId!),
    enabled: !!name && !!flowId,
  });

  // ── Local draft state ────────────────────────────────────

  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftIsDefault, setDraftIsDefault] = useState(false);
  const [draftSteps, setDraftSteps] = useState<FlowStep[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [isPreview, setIsPreview] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Seed the editable draft from fetched data when the loaded flow changes.
  // Adjusting state during render (vs. an effect) avoids an extra render pass.
  const [seededFlow, setSeededFlow] = useState(remoteFlow);
  if (remoteFlow && remoteFlow !== seededFlow) {
    setSeededFlow(remoteFlow);
    setDraftName(remoteFlow.name);
    setDraftDescription(remoteFlow.description ?? '');
    setDraftIsDefault(remoteFlow.isDefault);
    setDraftSteps(remoteFlow.steps);
    setIsDirty(false);
  }

  // ── Save mutation ────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: (flow: Partial<AuthFlow>) =>
      updateAuthFlow(name!, flowId!, {
        name: flow.name,
        description: flow.description ?? undefined,
        isDefault: flow.isDefault,
        steps: flow.steps,
      }),
    onSuccess: (updated) => {
      qc.setQueryData(['auth-flow', name, flowId], updated);
      qc.invalidateQueries({ queryKey: ['auth-flows', name] });
      setIsDirty(false);
      setSaveError(null);
    },
    onError: (err) => setSaveError(getErrorMessage(err)),
  });

  function handleSave() {
    setSaveError(null);
    saveMutation.mutate({
      name: draftName,
      description: draftDescription,
      isDefault: draftIsDefault,
      steps: draftSteps,
    });
  }

  function handleStepsChange(steps: FlowStep[]) {
    setDraftSteps(steps);
    setIsDirty(true);
  }

  function handleNameChange(value: string) {
    setDraftName(value);
    setIsDirty(true);
  }

  function handleDescriptionChange(value: string) {
    setDraftDescription(value);
    setIsDirty(true);
  }

  function handleIsDefaultChange(value: boolean) {
    setDraftIsDefault(value);
    setIsDirty(true);
  }

  // ── Render states ────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading flow...</div>
      </div>
    );
  }

  if (error || !remoteFlow) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
        Failed to load authentication flow.
      </div>
    );
  }

  // ── Main editor ──────────────────────────────────────────

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
        {/* Back */}
        <button
          onClick={() => navigate(`/console/realms/${name}/auth-flows`)}
          className="flex items-center gap-1 rounded px-2 py-1.5 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-800"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Flows
        </button>

        <div className="h-5 w-px bg-gray-200" />

        {/* Flow name */}
        <input
          value={draftName}
          onChange={(e) => handleNameChange(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          placeholder="Flow name"
          aria-label="Flow name"
        />

        {/* Default badge toggle */}
        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-gray-600 select-none">
          <input
            type="checkbox"
            checked={draftIsDefault}
            onChange={(e) => handleIsDefaultChange(e.target.checked)}
            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          Default flow
        </label>

        <div className="flex-1" />

        {/* Dirty indicator */}
        {isDirty && (
          <span className="text-xs text-amber-600">Unsaved changes</span>
        )}

        {/* Preview toggle */}
        <button
          onClick={() => setIsPreview(!isPreview)}
          className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
            isPreview
              ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
              : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          {isPreview ? 'Exit Preview' : 'Preview'}
        </button>

        {/* Save */}
        {!isPreview && (
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending || !isDirty}
            className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saveMutation.isPending ? 'Saving...' : 'Save'}
          </button>
        )}
      </div>

      {/* Description row */}
      {!isPreview && (
        <div className="shrink-0 border-b border-gray-100 bg-gray-50 px-4 py-2">
          <input
            value={draftDescription}
            onChange={(e) => handleDescriptionChange(e.target.value)}
            placeholder="Add a description (optional)..."
            className="w-full bg-transparent text-sm text-gray-600 placeholder-gray-400 focus:outline-none"
            aria-label="Flow description"
          />
        </div>
      )}

      {/* Error banner */}
      {saveError && (
        <div className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {saveError}
        </div>
      )}

      {/* Canvas area */}
      <div className="flex-1 overflow-hidden">
        <FlowCanvas
          steps={draftSteps}
          onChange={handleStepsChange}
          isPreview={isPreview}
        />
      </div>

      {/* Preview footer */}
      {isPreview && (
        <div className="shrink-0 border-t border-gray-200 bg-gray-50 px-4 py-3">
          <p className="text-xs text-gray-500">
            Preview mode — showing how the flow executes top to bottom.
            Dashed red lines indicate fallback paths.
          </p>
        </div>
      )}
    </div>
  );
}
