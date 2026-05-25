import { useRef, useState } from 'react';
import type { FlowStep, StepType } from '../../api/authFlows';
import FlowStepNode from './FlowStepNode';
import FlowStepPalette from './FlowStepPalette';
import FlowStepEditor from './FlowStepEditor';
import FlowConnectionLine from './FlowConnectionLine';

// ─── Validation ──────────────────────────────────────────────

interface ValidationWarning {
  type: 'unreachable' | 'missing_required' | 'invalid_fallback';
  message: string;
}

function validateSteps(steps: FlowStep[]): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const ids = new Set(steps.map((s) => s.id));

  // Check for invalid fallback references
  for (const step of steps) {
    if (step.fallbackStepId && !ids.has(step.fallbackStepId)) {
      warnings.push({
        type: 'invalid_fallback',
        message: `Step "${step.id}" references a non-existent fallback "${step.fallbackStepId}".`,
      });
    }
  }

  // Warn if no password or webauthn step is present (typically required)
  const hasCredentialStep = steps.some((s) =>
    s.type === 'password' || s.type === 'webauthn' || s.type === 'social' || s.type === 'ldap',
  );
  if (steps.length > 0 && !hasCredentialStep) {
    warnings.push({
      type: 'missing_required',
      message:
        'The flow has no credential step (password, WebAuthn, social, or LDAP). Users may not be able to authenticate.',
    });
  }

  // Warn about conditional steps that have no required step before them
  const conditionalOnly = steps.every((s) => !!s.condition);
  if (steps.length > 0 && conditionalOnly) {
    warnings.push({
      type: 'unreachable',
      message: 'All steps are conditional — the flow may be entirely skipped.',
    });
  }

  return warnings;
}

// ─── Unique ID helper ────────────────────────────────────────

function makeStepId(type: StepType, existingIds: string[]): string {
  let n = 1;
  while (existingIds.includes(`${type}-${n}`)) n++;
  return `${type}-${n}`;
}

// ─── Node layout constants ───────────────────────────────────

const NODE_WIDTH = 340;
const NODE_HEIGHT = 90; // approximate rendered height
const NODE_GAP = 32; // vertical gap between nodes
const CANVAS_PADDING = 24;

// ─── Component ───────────────────────────────────────────────

interface FlowCanvasProps {
  steps: FlowStep[];
  onChange: (steps: FlowStep[]) => void;
  isPreview?: boolean;
}

export default function FlowCanvas({ steps, onChange, isPreview = false }: FlowCanvasProps) {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const sorted = [...steps].sort((a, b) => a.order - b.order);
  const warnings = validateSteps(sorted);
  const selectedStep = sorted.find((s) => s.id === selectedStepId) ?? null;

  // ── Helpers ──────────────────────────────────────────────

  function updateSteps(updated: FlowStep[]) {
    // Re-number orders to be 1-based and sequential
    const renumbered = updated.map((s, i) => ({ ...s, order: i + 1 }));
    onChange(renumbered);
  }

  function addStep(type: StepType) {
    const id = makeStepId(type, steps.map((s) => s.id));
    const newStep: FlowStep = {
      id,
      type,
      required: true,
      order: steps.length + 1,
      condition: null,
      fallbackStepId: null,
      config: {},
    };
    updateSteps([...sorted, newStep]);
    setSelectedStepId(id);
  }

  function removeStep(id: string) {
    const remaining = sorted.filter((s) => s.id !== id);
    // Clear fallback references that pointed to the deleted step
    const cleaned = remaining.map((s) =>
      s.fallbackStepId === id ? { ...s, fallbackStepId: null } : s,
    );
    updateSteps(cleaned);
    if (selectedStepId === id) setSelectedStepId(null);
  }

  function moveStep(index: number, direction: -1 | 1) {
    const next = [...sorted];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    updateSteps(next);
  }

  function handleStepChange(updated: FlowStep) {
    updateSteps(sorted.map((s) => (s.id === updated.id ? updated : s)));
  }

  // ── Drag-and-drop (palette → canvas) ─────────────────────

  function handleCanvasDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (isPreview) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }

  function handleCanvasDrop(e: React.DragEvent<HTMLDivElement>) {
    if (isPreview) return;
    e.preventDefault();
    const type = e.dataTransfer.getData('application/x-step-type') as StepType;
    if (type) addStep(type);
    setDragOverIndex(null);
  }

  // ── Drag-to-reorder (within canvas) ──────────────────────

  // Tracks the node being dragged. Kept in state (not a ref) because it is
  // read during render to dim the dragged node.
  const [draggingId, setDraggingId] = useState<string | null>(null);

  function handleNodeDragStart(e: React.DragEvent, id: string) {
    if (isPreview) return;
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleNodeDragOver(e: React.DragEvent, index: number) {
    if (isPreview || !draggingId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  }

  function handleNodeDrop(e: React.DragEvent, dropIndex: number) {
    if (isPreview) return;
    e.preventDefault();
    const dragId = draggingId;
    if (!dragId) return;
    setDraggingId(null);
    setDragOverIndex(null);

    const dragIndex = sorted.findIndex((s) => s.id === dragId);
    if (dragIndex === dropIndex) return;

    const next = [...sorted];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(dropIndex, 0, moved);
    updateSteps(next);
  }

  // ── SVG connection lines ──────────────────────────────────

  const svgHeight = sorted.length * (NODE_HEIGHT + NODE_GAP) + CANVAS_PADDING * 2;
  const svgWidth = NODE_WIDTH + CANVAS_PADDING * 2;

  function nodeCentreX() {
    return CANVAS_PADDING + NODE_WIDTH / 2;
  }
  function nodeBottomY(index: number) {
    return CANVAS_PADDING + index * (NODE_HEIGHT + NODE_GAP) + NODE_HEIGHT;
  }
  function nodeTopY(index: number) {
    return CANVAS_PADDING + index * (NODE_HEIGHT + NODE_GAP);
  }

  // Build connection segments
  const connections: React.ReactNode[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    connections.push(
      <FlowConnectionLine
        key={`conn-${i}`}
        x1={nodeCentreX()}
        y1={nodeBottomY(i)}
        x2={nodeCentreX()}
        y2={nodeTopY(i + 1)}
      />,
    );
  }

  // Fallback connections
  sorted.forEach((step, i) => {
    if (!step.fallbackStepId) return;
    const targetIdx = sorted.findIndex((s) => s.id === step.fallbackStepId);
    if (targetIdx === -1) return;
    connections.push(
      <FlowConnectionLine
        key={`fallback-${step.id}`}
        x1={nodeCentreX() + NODE_WIDTH / 2 - 4}
        y1={(nodeBottomY(i) + nodeTopY(i)) / 2}
        x2={nodeCentreX() + NODE_WIDTH / 2 - 4}
        y2={nodeTopY(targetIdx)}
        isFallback
      />,
    );
  });

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="flex h-full gap-0">
      {/* Palette — hidden in preview mode */}
      {!isPreview && (
        <div className="w-52 shrink-0 overflow-y-auto border-r border-gray-200 bg-gray-50 p-4">
          <FlowStepPalette onAddStep={addStep} />
        </div>
      )}

      {/* Canvas */}
      <div
        ref={canvasRef}
        className={`relative flex-1 overflow-auto bg-white ${
          !isPreview ? 'border-r border-gray-200' : ''
        }`}
        onDragOver={handleCanvasDragOver}
        onDrop={handleCanvasDrop}
      >
        {/* Validation warnings */}
        {warnings.length > 0 && (
          <div className="sticky top-0 z-10 border-b border-amber-200 bg-amber-50 px-4 py-2">
            {warnings.map((w, i) => (
              <p key={i} className="text-xs text-amber-700">
                <span className="mr-1">&#9888;</span>
                {w.message}
              </p>
            ))}
          </div>
        )}

        {sorted.length === 0 ? (
          <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-gray-400">
            <svg className="mb-3 h-12 w-12 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
            </svg>
            <p className="text-sm">
              {isPreview
                ? 'No steps defined.'
                : 'Drag a step from the palette or click a type to add it.'}
            </p>
          </div>
        ) : (
          <div className="relative" style={{ width: svgWidth, minHeight: svgHeight }}>
            {/* SVG arrows */}
            <svg
              className="pointer-events-none absolute inset-0"
              width={svgWidth}
              height={svgHeight}
              style={{ zIndex: 0 }}
            >
              {connections}
            </svg>

            {/* Step nodes */}
            <div
              className="relative flex flex-col gap-8 px-6 py-6"
              style={{ zIndex: 1 }}
            >
              {sorted.map((step, index) => (
                <div
                  key={step.id}
                  draggable={!isPreview}
                  onDragStart={(e) => handleNodeDragStart(e, step.id)}
                  onDragOver={(e) => handleNodeDragOver(e, index)}
                  onDrop={(e) => handleNodeDrop(e, index)}
                  className={`transition-opacity ${
                    dragOverIndex === index && draggingId !== step.id
                      ? 'opacity-50'
                      : 'opacity-100'
                  }`}
                >
                  <FlowStepNode
                    step={step}
                    isSelected={selectedStepId === step.id}
                    isPreview={isPreview}
                    onSelect={(s) => setSelectedStepId(s.id === selectedStepId ? null : s.id)}
                    onMoveUp={() => moveStep(index, -1)}
                    onMoveDown={() => moveStep(index, 1)}
                    onDelete={() => removeStep(step.id)}
                    canMoveUp={index > 0}
                    canMoveDown={index < sorted.length - 1}
                  />
                </div>
              ))}

              {/* "Add step" placeholder at the bottom */}
              {!isPreview && (
                <button
                  onClick={() => {}}
                  className="flex items-center justify-center gap-1 rounded-lg border-2 border-dashed border-gray-300 py-3 text-sm text-gray-400 hover:border-indigo-300 hover:text-indigo-500"
                  style={{ width: NODE_WIDTH }}
                  title="Drag a step from the palette or click a type on the left"
                >
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
                  </svg>
                  Add step from palette
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Step editor side panel */}
      {!isPreview && selectedStep && (
        <div className="w-72 shrink-0 overflow-y-auto border-l border-gray-200 bg-white">
          <FlowStepEditor
            step={selectedStep}
            allSteps={sorted}
            onChange={handleStepChange}
            onClose={() => setSelectedStepId(null)}
          />
        </div>
      )}
    </div>
  );
}
