import { useMemo } from 'react';
import type { ThemeComponent } from '../../types/theme';
import { COMPONENT_DEFINITIONS } from '../../types/theme';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Turns a camelCase prop key into a human-readable label.
 * e.g. `showForgotPassword` → `Show Forgot Password`.
 */
function humanizeKey(key: string): string {
    const spaced = key.replace(/([A-Z])/g, ' $1');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1).trim();
}

interface ComponentInspectorProps {
    component: ThemeComponent;
    onChange: (updated: ThemeComponent) => void;
    onClose: () => void;
}

/**
 * Inline property editor for a single selected canvas component.
 *
 * Rather than maintaining a bespoke form per component type, this introspects
 * the component's editable props (the union of its definition `allowedProps`
 * and any values already present) and renders an appropriate control based on
 * the value type: booleans become toggles, numbers become number inputs and
 * everything else becomes a text field. Complex props (arrays/objects such as
 * social-provider lists) are intentionally skipped here.
 */
export default function ComponentInspector({
    component,
    onChange,
    onClose,
}: ComponentInspectorProps) {
    const definition = useMemo(
        () => COMPONENT_DEFINITIONS.find((d) => d.type === component.type),
        [component.type],
    );

    // Build the set of editable prop keys: definition-declared props first
    // (stable, ordered), then any extra keys already stored on the component.
    const propKeys = useMemo(() => {
        const allowed = definition?.allowedProps ?? [];
        const present = Object.keys(component.props ?? {});
        return Array.from(new Set([...allowed, ...present]));
    }, [definition, component.props]);

    function setProp(key: string, value: unknown) {
        onChange({
            ...component,
            props: { ...component.props, [key]: value },
        });
    }

    function renderField(key: string) {
        const defaults = (definition?.defaultProps ?? {}) as Record<string, unknown>;
        const raw = component.props?.[key];
        const value = raw === undefined ? defaults[key] : raw;

        // Skip non-primitive props (e.g. social-provider arrays) — these are not
        // editable through the generic inspector.
        if (Array.isArray(value) || (value !== null && typeof value === 'object')) {
            return null;
        }

        if (typeof value === 'boolean') {
            return (
                <label key={key} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="text-sm text-gray-700">{humanizeKey(key)}</span>
                    <input
                        type="checkbox"
                        checked={value}
                        onChange={(e) => setProp(key, e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                </label>
            );
        }

        if (typeof value === 'number') {
            return (
                <div key={key} className="py-1.5">
                    <label className="mb-1 block text-sm text-gray-700">{humanizeKey(key)}</label>
                    <input
                        type="number"
                        value={value}
                        onChange={(e) => setProp(key, Number(e.target.value))}
                        className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                </div>
            );
        }

        const strValue = value == null ? '' : String(value);
        const isLong = strValue.length > 40;
        return (
            <div key={key} className="py-1.5">
                <label className="mb-1 block text-sm text-gray-700">{humanizeKey(key)}</label>
                {isLong ? (
                    <textarea
                        value={strValue}
                        rows={3}
                        onChange={(e) => setProp(key, e.target.value)}
                        className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                ) : (
                    <input
                        type="text"
                        value={strValue}
                        onChange={(e) => setProp(key, e.target.value)}
                        className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                )}
            </div>
        );
    }

    const fields = propKeys.map(renderField).filter(Boolean);

    return (
        <div className="flex flex-col">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">
                        {component.label}
                    </span>
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                        {component.type}
                    </span>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    aria-label="Close component inspector"
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

            <div className="px-4 py-3">
                {/* Label + visibility are common to every component. */}
                <div className="py-1.5">
                    <label className="mb-1 block text-sm text-gray-700">Label</label>
                    <input
                        type="text"
                        value={component.label}
                        onChange={(e) => onChange({ ...component, label: e.target.value })}
                        className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                </div>
                <label className="flex items-center justify-between gap-3 py-1.5">
                    <span className="text-sm text-gray-700">Visible</span>
                    <input
                        type="checkbox"
                        checked={component.visible}
                        onChange={(e) => onChange({ ...component, visible: e.target.checked })}
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                </label>

                {fields.length > 0 && (
                    <div className="mt-2 border-t border-gray-100 pt-2">
                        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">
                            Properties
                        </p>
                        {fields}
                    </div>
                )}
            </div>
        </div>
    );
}
