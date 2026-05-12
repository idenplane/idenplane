import { useRef, useState } from 'react';
import type { ComponentType, ThemeComponent } from '../../types/theme';
import { COMPONENT_DEFINITIONS } from '../../types/theme';
import ComponentPalette from './ComponentPalette';

// ─── Unique ID helper ────────────────────────────────────────

function makeComponentId(type: ComponentType, existingIds: string[]): string {
  let n = 1;
  while (existingIds.includes(`${type}-${n}`)) n++;
  return `${type}-${n}`;
}

// ─── Component layout constants ─────────────────────────────

const NODE_WIDTH = 340;
const NODE_HEIGHT = 120; // approximate rendered height
const NODE_GAP = 24; // vertical gap between nodes
const CANVAS_PADDING = 24;

// ─── Component ───────────────────────────────────────────────

interface ThemeCanvasProps {
  components: ThemeComponent[];
  onChange: (components: ThemeComponent[]) => void;
  isPreview?: boolean;
  onSelectComponent?: (component: ThemeComponent | null) => void;
  selectedComponentId?: string | null;
}

export default function ThemeCanvas({
  components,
  onChange,
  isPreview = false,
  onSelectComponent,
  selectedComponentId,
}: ThemeCanvasProps) {
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const sorted = [...components].sort((a, b) => a.order - b.order);

  // ── Helpers ──────────────────────────────────────────────

  function updateComponents(updated: ThemeComponent[]) {
    // Re-number orders to be 0-based and sequential
    const renumbered = updated.map((c, i) => ({ ...c, order: i }));
    onChange(renumbered);
  }

  function addComponent(type: ComponentType) {
    const id = makeComponentId(type, components.map((c) => c.id));
    const definition = COMPONENT_DEFINITIONS.find((d) => d.type === type);
    const newComponent: ThemeComponent = {
      id,
      type,
      label: definition?.label ?? type,
      order: components.length,
      visible: true,
      props: (definition?.defaultProps ?? {}) as Record<string, unknown>,
    };
    updateComponents([...sorted, newComponent]);
  }

  function removeComponent(id: string) {
    const remaining = sorted.filter((c) => c.id !== id);
    updateComponents(remaining);
    if (selectedComponentId === id && onSelectComponent) {
      onSelectComponent(null);
    }
  }

  function moveComponent(index: number, direction: -1 | 1) {
    const next = [...sorted];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    updateComponents(next);
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
    const type = e.dataTransfer.getData('application/x-component-type') as ComponentType;
    if (type) addComponent(type);
    setDragOverIndex(null);
  }

  // ── Drag-to-reorder (within canvas) ──────────────────────

  const draggingId = useRef<string | null>(null);

  function handleNodeDragStart(e: React.DragEvent, id: string) {
    if (isPreview) return;
    draggingId.current = id;
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleNodeDragOver(e: React.DragEvent, index: number) {
    if (isPreview || !draggingId.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  }

  function handleNodeDrop(e: React.DragEvent, dropIndex: number) {
    if (isPreview) return;
    e.preventDefault();
    const dragId = draggingId.current;
    if (!dragId) return;
    draggingId.current = null;
    setDragOverIndex(null);

    const dragIndex = sorted.findIndex((c) => c.id === dragId);
    if (dragIndex === dropIndex) return;

    const next = [...sorted];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(dropIndex, 0, moved);
    updateComponents(next);
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
      <line
        key={`conn-${i}`}
        x1={nodeCentreX()}
        y1={nodeBottomY(i)}
        x2={nodeCentreX()}
        y2={nodeTopY(i + 1)}
        stroke="#d1d5db"
        strokeWidth={2}
        strokeDasharray="4,4"
      />,
    );
  }

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="flex h-full gap-0">
      {/* Palette — hidden in preview mode */}
      {!isPreview && (
        <div className="w-52 shrink-0 overflow-y-auto border-r border-gray-200 bg-gray-50 p-4">
          <ComponentPalette onAddComponent={addComponent} />
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
        {sorted.length === 0 ? (
          <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-gray-400">
            <svg className="mb-3 h-12 w-12 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
            </svg>
            <p className="text-sm">
              {isPreview
                ? 'No components defined.'
                : 'Drag a component from the palette or click to add it.'}
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

            {/* Component nodes */}
            <div
              className="relative flex flex-col gap-6 px-6 py-6"
              style={{ zIndex: 1 }}
            >
              {sorted.map((component, index) => (
                <div
                  key={component.id}
                  draggable={!isPreview}
                  onDragStart={(e) => handleNodeDragStart(e, component.id)}
                  onDragOver={(e) => handleNodeDragOver(e, index)}
                  onDrop={(e) => handleNodeDrop(e, index)}
                  onClick={() => !isPreview && onSelectComponent?.(component)}
                  className={`cursor-pointer rounded-lg border-2 p-4 transition-all ${
                    selectedComponentId === component.id
                      ? 'border-indigo-500 bg-indigo-50 shadow-md'
                      : dragOverIndex === index && draggingId.current !== component.id
                        ? 'border-indigo-300 bg-indigo-50 opacity-75'
                        : 'border-gray-200 bg-white hover:border-indigo-300 hover:shadow-md'
                  }`}
                  data-testid={`theme-canvas-component-${component.id}`}
                >
                  {/* Component header with actions */}
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-lg" role="img" aria-label={component.label}>
                        {getComponentIcon(component.type)}
                      </span>
                      <span className="font-medium text-gray-900">{component.label}</span>
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                        {component.type}
                      </span>
                    </div>
                    {!isPreview && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            moveComponent(index, -1);
                          }}
                          disabled={index === 0}
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-30"
                          aria-label="Move component up"
                          data-testid={`move-up-${component.id}`}
                        >
                          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path
                              fillRule="evenodd"
                              d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            moveComponent(index, 1);
                          }}
                          disabled={index === sorted.length - 1}
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-30"
                          aria-label="Move component down"
                          data-testid={`move-down-${component.id}`}
                        >
                          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path
                              fillRule="evenodd"
                              d="M14.707 10.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 12.586V5a1 1 0 012 0v7.586l2.293-2.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeComponent(component.id);
                          }}
                          className="rounded p-1 text-gray-400 hover:bg-red-100 hover:text-red-600"
                          aria-label="Remove component"
                          data-testid={`remove-${component.id}`}
                        >
                          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path
                              fillRule="evenodd"
                              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Component preview content */}
                  <div className="text-sm text-gray-500">
                    {renderComponentPreview(component)}
                  </div>
                </div>
              ))}

              {/* "Add component" placeholder at the bottom */}
              {!isPreview && (
                <div className="flex items-center justify-center gap-1 rounded-lg border-2 border-dashed border-gray-300 py-4 text-sm text-gray-400 hover:border-indigo-300 hover:text-indigo-500"
                  style={{ width: NODE_WIDTH }}
                  title="Drag a component from the palette or click to add it"
                  data-testid="add-component-placeholder"
                >
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
                  </svg>
                  Add component from palette
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helper functions ─────────────────────────────────────────

function getComponentIcon(type: ComponentType): string {
  const icons: Record<ComponentType, string> = {
    header: '🏛️',
    logo: '🖼️',
    footer: '📋',
    form: '📝',
    input: '✏️',
    passwordInput: '🔒',
    select: '▼',
    checkbox: '☑️',
    radio: '⏺',
    button: '🔘',
    link: '🔗',
    alert: '⚠️',
    card: '🃏',
    divider: '➖',
    spacer: '📏',
    text: '📄',
    heading: '📌',
    image: '🖼️',
    socialButton: '🌐',
    rememberMe: '💾',
    forgotPassword: '🔑',
    registrationLink: '👤',
  };
  return icons[type] || '📦';
}

function renderComponentPreview(component: ThemeComponent): React.ReactNode {
  switch (component.type) {
    case 'button':
      return (
        <div className="flex justify-center">
          <button className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white">
            {(component.props as { label?: string }).label ?? 'Button'}
          </button>
        </div>
      );
    case 'input':
      return (
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-700">
            {(component.props as { label?: string }).label ?? 'Input'}
          </label>
          <input
            type="text"
            placeholder="Enter value..."
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            disabled
          />
        </div>
      );
    case 'passwordInput':
      return (
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-700">
            {(component.props as { label?: string }).label ?? 'Password'}
          </label>
          <input
            type="password"
            placeholder="Enter password..."
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            disabled
          />
        </div>
      );
    case 'alert':
      return (
        <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {(component.props as { message?: string }).message ?? 'Alert message'}
        </div>
      );
    case 'heading':
      return (
        <div className="text-center text-lg font-semibold">
          {(component.props as { content?: string }).content ?? 'Heading'}
        </div>
      );
    case 'text':
      return (
        <div className="text-center text-sm">
          {(component.props as { content?: string }).content ?? 'Text content'}
        </div>
      );
    case 'link':
      return (
        <div className="text-center text-sm text-indigo-600 underline">
          {(component.props as { text?: string }).text ?? 'Link'}
        </div>
      );
    case 'divider':
      return <div className="border-t border-gray-300" />;
    case 'spacer':
      return (
        <div className="bg-gray-100 text-center text-xs text-gray-400">
          Spacer: {(component.props as { height?: number }).height ?? 16}px
        </div>
      );
    case 'card':
      return (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-center text-xs text-gray-500">
          Card container
        </div>
      );
    case 'form':
      return (
        <div className="space-y-2 rounded border border-gray-200 bg-gray-50 p-3">
          <div className="h-6 rounded bg-gray-200" />
          <div className="h-6 rounded bg-gray-200" />
          <div className="h-8 rounded bg-indigo-200" />
        </div>
      );
    case 'socialButton':
      return (
        <div className="flex justify-center gap-2">
          <div className="h-8 w-24 rounded bg-gray-200" />
          <div className="h-8 w-24 rounded bg-gray-200" />
        </div>
      );
    case 'checkbox':
      return (
        <div className="flex items-center gap-2">
          <input type="checkbox" disabled />
          <span className="text-sm">Remember me</span>
        </div>
      );
    case 'rememberMe':
      return (
        <div className="flex items-center gap-2">
          <input type="checkbox" disabled />
          <span className="text-sm">Remember me</span>
        </div>
      );
    case 'forgotPassword':
      return (
        <div className="text-right text-sm text-indigo-600">
          Forgot password?
        </div>
      );
    case 'registrationLink':
      return (
        <div className="text-center text-sm text-gray-600">
          {(component.props as { text?: string }).text ?? "Don't have an account? Sign up"}
        </div>
      );
    case 'logo':
      return (
        <div className="flex justify-center">
          <div className="h-12 w-32 rounded bg-gray-200" />
        </div>
      );
    case 'header':
      return (
        <div className="rounded bg-gray-100 p-2 text-center text-sm font-medium">
          {(component.props as { title?: string }).title ?? 'Header'}
        </div>
      );
    case 'footer':
      return (
        <div className="rounded bg-gray-100 p-2 text-center text-xs text-gray-500">
          Footer content
        </div>
      );
    case 'image':
      return (
        <div className="flex justify-center">
          <div className="h-24 w-full rounded bg-gray-200" />
        </div>
      );
    case 'select':
      return (
        <select className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" disabled>
          <option>Select option</option>
        </select>
      );
    case 'radio':
      return (
        <div className="space-y-1">
          <label className="flex items-center gap-2">
            <input type="radio" name="radio-group" disabled />
            <span className="text-sm">Option 1</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="radio-group" disabled />
            <span className="text-sm">Option 2</span>
          </label>
        </div>
      );
    default:
      return <span className="text-xs text-gray-400">No preview available</span>;
  }
}