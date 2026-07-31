import { useState } from 'react';
import type { FlowStep, StepType } from '../../api/authFlows';
import { STEP_TYPE_META } from './stepTypeMeta';
import FlowConditionEditor from './FlowConditionEditor';

interface FlowStepEditorProps {
  step: FlowStep;
  allSteps: FlowStep[];
  onChange: (updated: FlowStep) => void;
  onClose: () => void;
}

const ALL_STEP_TYPES: StepType[] = [
  'password',
  'totp',
  'webauthn',
  'social',
  'ldap',
  'email_otp',
  'consent',
];

export default function FlowStepEditor({
  step,
  allSteps,
  onChange,
  onClose,
}: FlowStepEditorProps) {
  const [activeTab, setActiveTab] = useState<'general' | 'condition' | 'config'>('general');

  // Other steps that can be selected as fallback
  const fallbackCandidates = allSteps.filter((s) => s.id !== step.id);

  function update(patch: Partial<FlowStep>) {
    onChange({ ...step, ...patch });
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg" role="img" aria-label={STEP_TYPE_META[step.type].label}>
            {STEP_TYPE_META[step.type].icon}
          </span>
          <h3 className="text-sm font-semibold text-fg">
            Edit Step
          </h3>
        </div>
        <button
          onClick={onClose}
          aria-label="Close step editor"
          className="rounded p-1 text-subtle hover:bg-hover hover:text-muted"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-line px-4">
        {(['general', 'condition', 'config'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-2 text-xs font-medium capitalize transition-colors ${
              activeTab === tab
                ? 'border-b-2 border-accent text-accent'
                : 'text-subtle hover:text-fg'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === 'general' && (
          <>
            {/* Step ID (read-only) */}
            <div>
              <label htmlFor="step-id" className="block text-xs font-medium text-muted mb-1">
                Step ID
              </label>
              <input
                id="step-id"
                readOnly
                value={step.id}
                className="w-full rounded-md border border-line bg-sunken px-3 py-1.5 text-sm text-subtle font-mono"
              />
            </div>

            {/* Type */}
            <div>
              <label htmlFor="step-type" className="block text-xs font-medium text-muted mb-1">
                Type
              </label>
              <select
                id="step-type"
                value={step.type}
                onChange={(e) => update({ type: e.target.value as StepType })}
                className="w-full rounded-md border border-line-strong px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {ALL_STEP_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {STEP_TYPE_META[t].icon} {STEP_TYPE_META[t].label}
                  </option>
                ))}
              </select>
            </div>

            {/* Required */}
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={step.required}
                onChange={(e) => update({ required: e.target.checked })}
                className="rounded border-line-strong text-accent focus:ring-accent"
              />
              <span className="text-sm font-medium text-muted">Required</span>
            </label>

            {/* Fallback step */}
            <div>
              <label htmlFor="step-fallback" className="block text-xs font-medium text-muted mb-1">
                Fallback step on failure
              </label>
              <select
                id="step-fallback"
                value={step.fallbackStepId ?? ''}
                onChange={(e) => update({ fallbackStepId: e.target.value || null })}
                className="w-full rounded-md border border-line-strong px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">— None —</option>
                {fallbackCandidates.map((s) => (
                  <option key={s.id} value={s.id}>
                    {STEP_TYPE_META[s.type].label} (Step {s.order}, {s.id})
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {activeTab === 'condition' && (
          <FlowConditionEditor
            condition={step.condition}
            onChange={(condition) => update({ condition })}
          />
        )}

        {activeTab === 'config' && (
          <StepConfigEditor
            type={step.type}
            config={step.config ?? {}}
            onChange={(config) => update({ config })}
          />
        )}
      </div>
    </div>
  );
}

// ─── Per-type config editor ──────────────────────────────────

interface StepConfigEditorProps {
  type: StepType;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}

function StepConfigEditor({ type, config, onChange }: StepConfigEditorProps) {
  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  switch (type) {
    case 'totp':
      return (
        <div className="space-y-3">
          <ConfigField label="TOTP Issuer">
            <input
              value={String(config.issuer ?? '')}
              onChange={(e) => set('issuer', e.target.value)}
              placeholder="e.g. MyApp"
              className="w-full rounded-md border border-line-strong px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </ConfigField>
          <ConfigField label="Digits">
            <select
              value={String(config.digits ?? '6')}
              onChange={(e) => set('digits', Number(e.target.value))}
              className="w-full rounded-md border border-line-strong px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="6">6</option>
              <option value="8">8</option>
            </select>
          </ConfigField>
          <ConfigField label="Algorithm">
            <select
              value={String(config.algorithm ?? 'SHA1')}
              onChange={(e) => set('algorithm', e.target.value)}
              className="w-full rounded-md border border-line-strong px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {['SHA1', 'SHA256', 'SHA512'].map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </ConfigField>
        </div>
      );

    case 'webauthn':
      return (
        <div className="space-y-3">
          <ConfigField label="RP Name (Relying Party)">
            <input
              value={String(config.rpName ?? '')}
              onChange={(e) => set('rpName', e.target.value)}
              placeholder="e.g. My Application"
              className="w-full rounded-md border border-line-strong px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </ConfigField>
          <ConfigField label="User Verification">
            <select
              value={String(config.userVerification ?? 'preferred')}
              onChange={(e) => set('userVerification', e.target.value)}
              className="w-full rounded-md border border-line-strong px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {['required', 'preferred', 'discouraged'].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </ConfigField>
        </div>
      );

    case 'social':
      return (
        <div className="space-y-3">
          <ConfigField label="Provider Alias">
            <input
              value={String(config.providerAlias ?? '')}
              onChange={(e) => set('providerAlias', e.target.value)}
              placeholder="e.g. google"
              className="w-full rounded-md border border-line-strong px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </ConfigField>
        </div>
      );

    case 'ldap':
      return (
        <div className="space-y-3">
          <ConfigField label="Federation Provider ID">
            <input
              value={String(config.federationProviderId ?? '')}
              onChange={(e) => set('federationProviderId', e.target.value)}
              placeholder="UUID of the user-federation entry"
              className="w-full rounded-md border border-line-strong px-3 py-1.5 text-sm font-mono focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </ConfigField>
        </div>
      );

    case 'email_otp':
      return (
        <div className="space-y-3">
          <ConfigField label="OTP Length">
            <select
              value={String(config.otpLength ?? '6')}
              onChange={(e) => set('otpLength', Number(e.target.value))}
              className="w-full rounded-md border border-line-strong px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {[4, 6, 8].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </ConfigField>
          <ConfigField label="OTP Expiry (seconds)">
            <input
              type="number"
              min={60}
              value={Number(config.expirySeconds ?? 300)}
              onChange={(e) => set('expirySeconds', Number(e.target.value))}
              className="w-full rounded-md border border-line-strong px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </ConfigField>
        </div>
      );

    default:
      return (
        <p className="text-sm text-subtle">
          No additional configuration for this step type.
        </p>
      );
  }
}

function ConfigField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted mb-1">{label}</label>
      {children}
    </div>
  );
}
