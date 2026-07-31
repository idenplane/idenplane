import type { ComponentType, ComponentDefinition } from '../../types/theme';
import { COMPONENT_DEFINITIONS } from '../../types/theme';

interface ComponentPaletteProps {
  onAddComponent: (type: ComponentType) => void;
}

const PALETTE_COMPONENTS: ComponentDefinition[] = COMPONENT_DEFINITIONS;

export default function ComponentPalette({ onAddComponent }: ComponentPaletteProps) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-subtle mb-1">
        Components
      </p>
      {PALETTE_COMPONENTS.map((component) => (
        <button
          key={component.type}
          data-testid={`palette-component-${component.type}`}
          onClick={() => onAddComponent(component.type)}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-component-type', component.type);
            e.dataTransfer.effectAllowed = 'copy';
          }}
          className="flex cursor-grab items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-left text-sm font-medium text-muted transition-shadow hover:shadow-md active:cursor-grabbing"
        >
          <span role="img" aria-label={component.label} className="text-lg">
            {getComponentIcon(component.type)}
          </span>
          <span className="text-muted">{component.label}</span>
        </button>
      ))}
    </div>
  );
}

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