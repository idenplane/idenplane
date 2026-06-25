import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Realm, SmsProviderType, SmsProviderConfig } from '../../types';
import { updateRealm } from '../../api/realms';
import PasswordInput from '../PasswordInput';
import { getErrorMessage } from '../../utils/getErrorMessage';

type SmsProviderFormProps = {
  realm: Realm;
};

type SmsFormState = {
  smsMfaEnabled: boolean;
  smsProvider: SmsProviderType;
  smsFrom: string;
  // Twilio
  twilioAccountSid: string;
  twilioAuthToken: string;
  // Vonage
  vonageApiKey: string;
  vonageApiSecret: string;
  // AWS SNS
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  awsRegion: string;
  // Webhook
  webhookUrl: string;
  webhookHeaders: string;
  webhookTimeout: number;
  // OTP
  otpLength: number;
  otpExpirySeconds: number;
  // Rate limiting
  smsMaxRequestsPerUser: number;
  smsRateLimitWindow: number;
};

function seedFromRealm(realm: Realm): SmsFormState {
  const cfg = (realm.smsProviderConfig ?? {}) as SmsProviderConfig;
  return {
    smsMfaEnabled: realm.smsMfaEnabled ?? false,
    smsProvider: realm.smsProvider ?? 'none',
    smsFrom: realm.smsFrom ?? '',
    twilioAccountSid: cfg.twilioAccountSid ?? '',
    twilioAuthToken: cfg.twilioAuthToken ?? '',
    vonageApiKey: cfg.vonageApiKey ?? '',
    vonageApiSecret: cfg.vonageApiSecret ?? '',
    awsAccessKeyId: cfg.awsAccessKeyId ?? '',
    awsSecretAccessKey: cfg.awsSecretAccessKey ?? '',
    awsRegion: cfg.awsRegion ?? '',
    webhookUrl: cfg.webhookUrl ?? '',
    webhookHeaders: cfg.webhookHeaders ?? '{}',
    webhookTimeout: cfg.webhookTimeout ?? 30000,
    otpLength: realm.otpLength ?? 6,
    otpExpirySeconds: realm.otpExpirySeconds ?? 300,
    smsMaxRequestsPerUser: realm.smsMaxRequestsPerUser ?? 3,
    smsRateLimitWindow: realm.smsRateLimitWindow ?? 900,
  };
}

function buildProviderConfig(form: SmsFormState): SmsProviderConfig {
  return {
    twilioAccountSid: form.twilioAccountSid || undefined,
    twilioAuthToken: form.twilioAuthToken || undefined,
    vonageApiKey: form.vonageApiKey || undefined,
    vonageApiSecret: form.vonageApiSecret || undefined,
    awsAccessKeyId: form.awsAccessKeyId || undefined,
    awsSecretAccessKey: form.awsSecretAccessKey || undefined,
    awsRegion: form.awsRegion || undefined,
    webhookUrl: form.webhookUrl || undefined,
    webhookHeaders: form.webhookHeaders || undefined,
    webhookTimeout: form.webhookTimeout,
  };
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

// ── Icons ──────────────────────────────────────────────────────────────────

function BanIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  );
}

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.18h3a2 2 0 0 1 2 1.72c.13 1 .37 1.98.72 2.93a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6.18 6.18l.96-.96a2 2 0 0 1 2.11-.45c.95.35 1.93.59 2.93.72a2 2 0 0 1 1.73 2.02z" />
    </svg>
  );
}

function CloudIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
    </svg>
  );
}

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function ZapIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}

// ── Provider options ───────────────────────────────────────────────────────

type ProviderOption = {
  value: SmsProviderType;
  label: string;
  description: string;
  badge?: string;
  icon: React.ReactNode;
};

const PROVIDERS: ProviderOption[] = [
  {
    value: 'none',
    label: 'Disabled',
    description: 'SMS delivery is turned off for this realm.',
    icon: <BanIcon className="h-5 w-5" />,
  },
  {
    value: 'twilio',
    label: 'Twilio',
    description: 'Industry-leading SMS & voice platform.',
    badge: 'Popular',
    icon: <PhoneIcon className="h-5 w-5" />,
  },
  {
    value: 'vonage',
    label: 'Vonage',
    description: 'Reliable SMS API (formerly Nexmo).',
    icon: <ZapIcon className="h-5 w-5" />,
  },
  {
    value: 'aws-sns',
    label: 'AWS SNS',
    description: 'Amazon Simple Notification Service.',
    icon: <CloudIcon className="h-5 w-5" />,
  },
  {
    value: 'webhook',
    label: 'Webhook',
    description: 'POST to any custom HTTP endpoint.',
    icon: <GlobeIcon className="h-5 w-5" />,
  },
];

// ── Field helpers ──────────────────────────────────────────────────────────

const inputClass =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none';

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

// ── Provider-specific field panels ────────────────────────────────────────

function TwilioFields({
  form,
  setForm,
}: {
  form: SmsFormState;
  setForm: React.Dispatch<React.SetStateAction<SmsFormState>>;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Account SID" hint="Starts with AC — found in Twilio Console.">
          <input
            type="text"
            value={form.twilioAccountSid}
            onChange={(e) => setForm((f) => ({ ...f, twilioAccountSid: e.target.value }))}
            placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            className={inputClass}
          />
        </Field>
        <Field label="Auth Token" hint="Found next to Account SID in Twilio Console.">
          <PasswordInput
            value={form.twilioAuthToken}
            onChange={(e) => setForm((f) => ({ ...f, twilioAuthToken: e.target.value }))}
            placeholder="••••••••••••••••"
            className={inputClass}
          />
        </Field>
      </div>
    </div>
  );
}

function VonageFields({
  form,
  setForm,
}: {
  form: SmsFormState;
  setForm: React.Dispatch<React.SetStateAction<SmsFormState>>;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="API Key" hint="Found in Vonage Dashboard › Getting started.">
          <input
            type="text"
            value={form.vonageApiKey}
            onChange={(e) => setForm((f) => ({ ...f, vonageApiKey: e.target.value }))}
            placeholder="a1b2c3d4"
            className={inputClass}
          />
        </Field>
        <Field label="API Secret" hint="Found in Vonage Dashboard next to your API Key.">
          <PasswordInput
            value={form.vonageApiSecret}
            onChange={(e) => setForm((f) => ({ ...f, vonageApiSecret: e.target.value }))}
            placeholder="••••••••••••••••"
            className={inputClass}
          />
        </Field>
      </div>
    </div>
  );
}

function AwsSnsFields({
  form,
  setForm,
}: {
  form: SmsFormState;
  setForm: React.Dispatch<React.SetStateAction<SmsFormState>>;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Access Key ID" hint="IAM user with sns:Publish permission.">
          <input
            type="text"
            value={form.awsAccessKeyId}
            onChange={(e) => setForm((f) => ({ ...f, awsAccessKeyId: e.target.value }))}
            placeholder="AKIAIOSFODNN7EXAMPLE"
            className={inputClass}
          />
        </Field>
        <Field label="Secret Access Key">
          <PasswordInput
            value={form.awsSecretAccessKey}
            onChange={(e) => setForm((f) => ({ ...f, awsSecretAccessKey: e.target.value }))}
            placeholder="••••••••••••••••"
            className={inputClass}
          />
        </Field>
      </div>
      <Field label="AWS Region" hint="e.g. us-east-1, eu-west-1 — must support SNS SMS in your account.">
        <input
          type="text"
          value={form.awsRegion}
          onChange={(e) => setForm((f) => ({ ...f, awsRegion: e.target.value }))}
          placeholder="us-east-1"
          className={inputClass}
        />
      </Field>
    </div>
  );
}

function WebhookFields({
  form,
  setForm,
}: {
  form: SmsFormState;
  setForm: React.Dispatch<React.SetStateAction<SmsFormState>>;
}) {
  return (
    <div className="space-y-4">
      <Field
        label="Webhook URL"
        hint="Receives a POST with { to, message, timestamp }."
      >
        <input
          type="url"
          value={form.webhookUrl}
          onChange={(e) => setForm((f) => ({ ...f, webhookUrl: e.target.value }))}
          placeholder="https://api.example.com/sms/send"
          className={inputClass}
        />
      </Field>
      <Field
        label="Custom Headers (JSON)"
        hint='Optional request headers, e.g. {"Authorization": "Bearer token"}. Must be valid JSON.'
      >
        <textarea
          value={form.webhookHeaders}
          onChange={(e) => setForm((f) => ({ ...f, webhookHeaders: e.target.value }))}
          placeholder='{"Authorization": "Bearer your-token"}'
          rows={2}
          className={`${inputClass} font-mono`}
        />
      </Field>
      <Field
        label="Timeout (ms)"
        hint="Max wait for webhook response (1000–60000 ms). Default: 30000."
      >
        <input
          type="number"
          min={1000}
          max={60000}
          value={form.webhookTimeout}
          onChange={(e) => setForm((f) => ({ ...f, webhookTimeout: Number(e.target.value) }))}
          className="w-40 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
        />
      </Field>
    </div>
  );
}

function ProviderFields({
  form,
  setForm,
}: {
  form: SmsFormState;
  setForm: React.Dispatch<React.SetStateAction<SmsFormState>>;
}) {
  switch (form.smsProvider) {
    case 'twilio':
      return <TwilioFields form={form} setForm={setForm} />;
    case 'vonage':
      return <VonageFields form={form} setForm={setForm} />;
    case 'aws-sns':
      return <AwsSnsFields form={form} setForm={setForm} />;
    case 'webhook':
      return <WebhookFields form={form} setForm={setForm} />;
    default:
      return null;
  }
}

// ── Main component ─────────────────────────────────────────────────────────

export default function SmsProviderForm({ realm }: SmsProviderFormProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SmsFormState>(() => seedFromRealm(realm));

  const [seededRealm, setSeededRealm] = useState(realm);
  if (realm !== seededRealm) {
    setSeededRealm(realm);
    setForm(seedFromRealm(realm));
  }

  const updateMutation = useMutation({
    mutationFn: () =>
      updateRealm(realm.name, {
        smsMfaEnabled: form.smsMfaEnabled,
        smsProvider: form.smsProvider,
        smsFrom: form.smsFrom || undefined,
        smsProviderConfig: buildProviderConfig(form),
        otpLength: form.otpLength,
        otpExpirySeconds: form.otpExpirySeconds,
        smsMaxRequestsPerUser: form.smsMaxRequestsPerUser,
        smsRateLimitWindow: form.smsRateLimitWindow,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['realm', realm.name] });
      queryClient.invalidateQueries({ queryKey: ['realms'] });
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    updateMutation.mutate();
  }

  const activeProvider = PROVIDERS.find((p) => p.value === form.smsProvider);
  const hasProvider = form.smsProvider !== 'none';

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Enable SMS MFA toggle */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">SMS Multi-Factor Authentication</h2>
            <p className="mt-1 text-sm text-gray-500">
              Users receive a one-time code via SMS as a second factor during login.
              Requires a configured SMS provider below.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.smsMfaEnabled}
            onClick={() => setForm((f) => ({ ...f, smsMfaEnabled: !f.smsMfaEnabled }))}
            className={[
              'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2',
              form.smsMfaEnabled ? 'bg-indigo-600' : 'bg-gray-200',
            ].join(' ')}
          >
            <span
              className={[
                'inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform',
                form.smsMfaEnabled ? 'translate-x-5' : 'translate-x-0',
              ].join(' ')}
            />
          </button>
        </div>
      </div>

      {/* Provider selector */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4">
          <h3 className="text-base font-semibold text-gray-900">SMS Provider</h3>
          <p className="mt-1 text-sm text-gray-500">
            Choose the service that delivers SMS messages for this realm.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
          {PROVIDERS.map((p) => {
            const selected = form.smsProvider === p.value;
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => setForm((f) => ({ ...f, smsProvider: p.value }))}
                className={[
                  'relative flex flex-col gap-1.5 rounded-lg border-2 p-4 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                  selected
                    ? 'border-indigo-600 bg-indigo-50'
                    : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50',
                ].join(' ')}
                aria-pressed={selected}
              >
                {p.badge && (
                  <span className="absolute right-2 top-2 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
                    {p.badge}
                  </span>
                )}
                <span
                  className={[
                    'flex h-8 w-8 items-center justify-center rounded-md',
                    selected ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500',
                  ].join(' ')}
                >
                  {p.icon}
                </span>
                <span
                  className={[
                    'text-sm font-semibold',
                    selected ? 'text-indigo-700' : 'text-gray-900',
                  ].join(' ')}
                >
                  {p.label}
                </span>
                <span className="text-xs leading-snug text-gray-500">{p.description}</span>
              </button>
            );
          })}
        </div>

        {/* Sender / provider fields */}
        {hasProvider && (
          <div className="mt-5 space-y-5">
            {/* Sender number (shared across all providers) */}
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-5">
              <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Sender
              </p>
              <Field
                label="From Phone Number"
                hint="The number shown to recipients. Must be registered and verified with your provider."
              >
                <input
                  type="text"
                  value={form.smsFrom}
                  onChange={(e) => setForm((f) => ({ ...f, smsFrom: e.target.value }))}
                  placeholder="+12345678900"
                  className={inputClass}
                />
              </Field>
            </div>

            {/* Provider credentials */}
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-5">
              <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-gray-400">
                {activeProvider?.label} Configuration
              </p>
              <ProviderFields form={form} setForm={setForm} />
            </div>
          </div>
        )}
      </div>

      {/* OTP Settings */}
      {hasProvider && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-gray-900">OTP Settings</h3>
          <p className="mt-1 text-xs text-gray-500">
            Configure the one-time password format and expiration window.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <Field label="OTP Length" hint="Digits in the code sent to users. Default: 6.">
              <select
                value={form.otpLength}
                onChange={(e) => setForm((f) => ({ ...f, otpLength: Number(e.target.value) }))}
                className={inputClass}
              >
                {[4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>{n} digits</option>
                ))}
              </select>
            </Field>
            <Field label="OTP Expiry" hint="Time before the code expires (30–600 s). Default: 5 min.">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={30}
                  max={600}
                  value={form.otpExpirySeconds}
                  onChange={(e) => setForm((f) => ({ ...f, otpExpirySeconds: Number(e.target.value) }))}
                  className={inputClass}
                />
                <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                  {formatDuration(form.otpExpirySeconds)}
                </span>
              </div>
            </Field>
          </div>
        </div>
      )}

      {/* Rate Limiting */}
      {hasProvider && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-gray-900">Rate Limiting</h3>
          <p className="mt-1 text-xs text-gray-500">
            Prevent abuse by capping how many SMS OTP requests a user can make.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <Field
              label="Max Requests per User"
              hint="OTP requests allowed per user within the rate window. Default: 3."
            >
              <input
                type="number"
                min={1}
                max={10}
                value={form.smsMaxRequestsPerUser}
                onChange={(e) => setForm((f) => ({ ...f, smsMaxRequestsPerUser: Number(e.target.value) }))}
                className={inputClass}
              />
            </Field>
            <Field
              label="Rate Limit Window"
              hint="Time window for the request limit (60–3600 s). Default: 15 min."
            >
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={60}
                  max={3600}
                  value={form.smsRateLimitWindow}
                  onChange={(e) => setForm((f) => ({ ...f, smsRateLimitWindow: Number(e.target.value) }))}
                  className={inputClass}
                />
                <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                  {formatDuration(form.smsRateLimitWindow)}
                </span>
              </div>
            </Field>
          </div>
        </div>
      )}

      {/* Status banners */}
      {updateMutation.isSuccess && (
        <div role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-700">
          SMS settings saved successfully.
        </div>
      )}
      {updateMutation.isError && (
        <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {getErrorMessage(updateMutation.error, 'Failed to save SMS settings.')}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={updateMutation.isPending}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </form>
  );
}
