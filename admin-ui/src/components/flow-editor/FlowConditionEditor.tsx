import type { FlowStepCondition, ConditionOperator } from '../../api/authFlows';

interface FlowConditionEditorProps {
  condition: FlowStepCondition | null | undefined;
  onChange: (condition: FlowStepCondition | null) => void;
}

const OPERATORS: { value: ConditionOperator; label: string; hasValue: boolean }[] = [
  { value: 'eq', label: 'equals', hasValue: true },
  { value: 'neq', label: 'not equals', hasValue: true },
  { value: 'in', label: 'in (comma-separated)', hasValue: true },
  { value: 'not_in', label: 'not in (comma-separated)', hasValue: true },
  { value: 'exists', label: 'exists', hasValue: false },
  { value: 'not_exists', label: 'does not exist', hasValue: false },
];

const FIELD_SUGGESTIONS = [
  'user.group',
  'user.role',
  'user.attribute',
  'client.id',
  'network.ip',
  'session.amr',
];

export default function FlowConditionEditor({
  condition,
  onChange,
}: FlowConditionEditorProps) {
  const enabled = condition != null;
  const op = OPERATORS.find((o) => o.value === condition?.operator) ?? OPERATORS[0];

  function handleToggle() {
    if (enabled) {
      onChange(null);
    } else {
      onChange({ field: '', operator: 'eq', value: '' });
    }
  }

  function handleField(field: string) {
    if (!condition) return;
    onChange({ ...condition, field });
  }

  function handleOperator(operator: ConditionOperator) {
    if (!condition) return;
    const newOp = OPERATORS.find((o) => o.value === operator)!;
    onChange({ ...condition, operator, value: newOp.hasValue ? condition.value ?? '' : undefined });
  }

  function handleValue(raw: string) {
    if (!condition) return;
    const value = condition.operator === 'in' || condition.operator === 'not_in'
      ? raw.split(',').map((v) => v.trim()).filter(Boolean)
      : raw;
    onChange({ ...condition, value });
  }

  const valueDisplay = (() => {
    if (!condition?.value) return '';
    if (Array.isArray(condition.value)) return condition.value.join(', ');
    return String(condition.value);
  })();

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={enabled}
          onChange={handleToggle}
          className="rounded border-line-strong text-accent focus:ring-accent"
        />
        <span className="text-sm font-medium text-muted">Enable condition</span>
      </label>

      {enabled && condition && (
        <div className="ml-6 space-y-3 rounded-lg border border-warning-soft bg-warning-soft p-3">
          <p className="text-xs text-warning-fg">
            This step is skipped when the condition does NOT match.
          </p>

          {/* Field */}
          <div>
            <label htmlFor="condition-field" className="block text-xs font-medium text-muted mb-1">
              Context field
            </label>
            <input
              id="condition-field"
              list="field-suggestions"
              value={condition.field}
              onChange={(e) => handleField(e.target.value)}
              placeholder="e.g. user.group"
              className="w-full rounded-md border border-line-strong px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <datalist id="field-suggestions">
              {FIELD_SUGGESTIONS.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </div>

          {/* Operator */}
          <div>
            <label htmlFor="condition-operator" className="block text-xs font-medium text-muted mb-1">
              Operator
            </label>
            <select
              id="condition-operator"
              value={condition.operator}
              onChange={(e) => handleOperator(e.target.value as ConditionOperator)}
              className="w-full rounded-md border border-line-strong px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {OPERATORS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {/* Value (only when operator needs one) */}
          {op.hasValue && (
            <div>
              <label htmlFor="condition-value" className="block text-xs font-medium text-muted mb-1">
                Value
                {(condition.operator === 'in' || condition.operator === 'not_in') && (
                  <span className="ml-1 text-subtle">(comma-separated)</span>
                )}
              </label>
              <input
                id="condition-value"
                value={valueDisplay}
                onChange={(e) => handleValue(e.target.value)}
                placeholder="Enter value..."
                className="w-full rounded-md border border-line-strong px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
