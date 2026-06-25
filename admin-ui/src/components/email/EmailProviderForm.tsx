import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Realm, EmailProviderType, EmailProviderConfig } from '../../types';
import { updateRealm, sendTestEmail } from '../../api/realms';
import PasswordInput from '../PasswordInput';
import { getErrorMessage } from '../../utils/getErrorMessage';

type EmailProviderFormProps = {
  realm: Realm;
};

type EmailFormState = {
  emailProvider: EmailProviderType;
  // SMTP
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  smtpFrom: string;
  smtpSecure: boolean;
  // Resend
  resendApiKey: string;
  resendFrom: string;
  // SendGrid
  sendgridApiKey: string;
  sendgridFrom: string;
  // Mailgun
  mailgunApiKey: string;
  mailgunDomain: string;
  mailgunFrom: string;
  mailgunRegion: 'us' | 'eu';
  // Postmark
  postmarkServerToken: string;
  postmarkFrom: string;
};

function seedFromRealm(realm: Realm): EmailFormState {
  const cfg = (realm.emailProviderConfig ?? {}) as EmailProviderConfig;
  return {
    emailProvider: realm.emailProvider ?? 'smtp',
    smtpHost: realm.smtpHost ?? '',
    smtpPort: realm.smtpPort ?? 587,
    smtpUser: realm.smtpUser ?? '',
    smtpPassword: realm.smtpPassword ?? '',
    smtpFrom: realm.smtpFrom ?? '',
    smtpSecure: realm.smtpSecure ?? false,
    resendApiKey: cfg.resend?.apiKey ?? '',
    resendFrom: cfg.resend?.from ?? '',
    sendgridApiKey: cfg.sendgrid?.apiKey ?? '',
    sendgridFrom: cfg.sendgrid?.from ?? '',
    mailgunApiKey: cfg.mailgun?.apiKey ?? '',
    mailgunDomain: cfg.mailgun?.domain ?? '',
    mailgunFrom: cfg.mailgun?.from ?? '',
    mailgunRegion: cfg.mailgun?.region ?? 'us',
    postmarkServerToken: cfg.postmark?.serverToken ?? '',
    postmarkFrom: cfg.postmark?.from ?? '',
  };
}

function buildProviderConfig(form: EmailFormState): EmailProviderConfig {
  return {
    resend: { apiKey: form.resendApiKey, from: form.resendFrom },
    sendgrid: { apiKey: form.sendgridApiKey, from: form.sendgridFrom },
    mailgun: {
      apiKey: form.mailgunApiKey,
      domain: form.mailgunDomain,
      from: form.mailgunFrom,
      region: form.mailgunRegion,
    },
    postmark: { serverToken: form.postmarkServerToken, from: form.postmarkFrom },
  };
}

// ── Provider option cards ──────────────────────────────────────────────────

type ProviderOption = {
  value: EmailProviderType;
  label: string;
  description: string;
  badge?: string;
  icon: React.ReactNode;
};

function ServerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="8" rx="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  );
}

function BanIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
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

function GridIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </svg>
  );
}

function SendIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function StampIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 22h14" />
      <path d="M19.27 13.73A2.5 2.5 0 0 0 17 13h-1a2.5 2.5 0 0 0-2.5 2.5v.5H9v-.5A2.5 2.5 0 0 0 6.5 13h-1a2.5 2.5 0 0 0-2.23 1.37" />
      <path d="M12 13V7" />
      <circle cx="12" cy="4" r="3" />
    </svg>
  );
}

const PROVIDERS: ProviderOption[] = [
  {
    value: 'none',
    label: 'Disabled',
    description: 'Email delivery is turned off for this realm.',
    icon: <BanIcon className="h-5 w-5" />,
  },
  {
    value: 'smtp',
    label: 'SMTP',
    description: 'Connect your own mail server or relay.',
    icon: <ServerIcon className="h-5 w-5" />,
  },
  {
    value: 'resend',
    label: 'Resend',
    description: 'Modern email API built for developers.',
    badge: 'Popular',
    icon: <ZapIcon className="h-5 w-5" />,
  },
  {
    value: 'sendgrid',
    label: 'SendGrid',
    description: 'Reliable transactional email platform.',
    icon: <GridIcon className="h-5 w-5" />,
  },
  {
    value: 'mailgun',
    label: 'Mailgun',
    description: 'Powerful API with US & EU regions.',
    icon: <SendIcon className="h-5 w-5" />,
  },
  {
    value: 'postmark',
    label: 'Postmark',
    description: 'Fast, reliable transactional email.',
    icon: <StampIcon className="h-5 w-5" />,
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

function SmtpFields({
  form,
  setForm,
}: {
  form: EmailFormState;
  setForm: React.Dispatch<React.SetStateAction<EmailFormState>>;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="SMTP Host" hint="e.g. smtp.gmail.com">
          <input
            type="text"
            value={form.smtpHost}
            onChange={(e) => setForm((f) => ({ ...f, smtpHost: e.target.value }))}
            placeholder="smtp.example.com"
            className={inputClass}
          />
        </Field>
        <Field label="Port" hint="587 STARTTLS · 465 SSL/TLS · 25 unencrypted">
          <input
            type="number"
            min={1}
            max={65535}
            value={form.smtpPort}
            onChange={(e) => setForm((f) => ({ ...f, smtpPort: Number(e.target.value) }))}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Sender Address" hint="The 'From' address shown to recipients.">
        <input
          type="email"
          value={form.smtpFrom}
          onChange={(e) => setForm((f) => ({ ...f, smtpFrom: e.target.value }))}
          placeholder="noreply@example.com"
          className={inputClass}
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Username">
          <input
            type="text"
            value={form.smtpUser}
            onChange={(e) => setForm((f) => ({ ...f, smtpUser: e.target.value }))}
            placeholder="Optional"
            className={inputClass}
          />
        </Field>
        <Field label="Password">
          <PasswordInput
            value={form.smtpPassword}
            onChange={(e) => setForm((f) => ({ ...f, smtpPassword: e.target.value }))}
            placeholder="Optional"
            className={inputClass}
          />
        </Field>
      </div>

      <label className="flex cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          checked={form.smtpSecure}
          onChange={(e) => setForm((f) => ({ ...f, smtpSecure: e.target.checked }))}
          className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
        />
        <span className="text-sm font-medium text-gray-700">Use SSL/TLS</span>
        <span className="text-xs text-gray-400">(enable for port 465)</span>
      </label>
    </div>
  );
}

function ApiKeyFromFields({
  apiKeyValue,
  fromValue,
  apiKeyLabel,
  apiKeyHint,
  onApiKeyChange,
  onFromChange,
}: {
  apiKeyValue: string;
  fromValue: string;
  apiKeyLabel: string;
  apiKeyHint?: string;
  onApiKeyChange: (v: string) => void;
  onFromChange: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <Field label={apiKeyLabel} hint={apiKeyHint}>
        <PasswordInput
          value={apiKeyValue}
          onChange={(e) => onApiKeyChange(e.target.value)}
          placeholder="••••••••••••••••"
          className={inputClass}
        />
      </Field>
      <Field label="Sender Address" hint="Must be verified with your provider.">
        <input
          type="email"
          value={fromValue}
          onChange={(e) => onFromChange(e.target.value)}
          placeholder="noreply@example.com"
          className={inputClass}
        />
      </Field>
    </div>
  );
}

function MailgunFields({
  form,
  setForm,
}: {
  form: EmailFormState;
  setForm: React.Dispatch<React.SetStateAction<EmailFormState>>;
}) {
  return (
    <div className="space-y-4">
      <Field label="API Key" hint="Found in Mailgun › Settings › API Keys.">
        <PasswordInput
          value={form.mailgunApiKey}
          onChange={(e) => setForm((f) => ({ ...f, mailgunApiKey: e.target.value }))}
          placeholder="••••••••••••••••"
          className={inputClass}
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Domain" hint="e.g. mg.example.com">
          <input
            type="text"
            value={form.mailgunDomain}
            onChange={(e) => setForm((f) => ({ ...f, mailgunDomain: e.target.value }))}
            placeholder="mg.example.com"
            className={inputClass}
          />
        </Field>
        <Field label="Region">
          <select
            value={form.mailgunRegion}
            onChange={(e) =>
              setForm((f) => ({ ...f, mailgunRegion: e.target.value as 'us' | 'eu' }))
            }
            className={inputClass}
          >
            <option value="us">US (api.mailgun.net)</option>
            <option value="eu">EU (api.eu.mailgun.net)</option>
          </select>
        </Field>
      </div>
      <Field label="Sender Address" hint="Must match a verified domain in Mailgun.">
        <input
          type="email"
          value={form.mailgunFrom}
          onChange={(e) => setForm((f) => ({ ...f, mailgunFrom: e.target.value }))}
          placeholder="noreply@mg.example.com"
          className={inputClass}
        />
      </Field>
    </div>
  );
}

function ProviderFields({
  form,
  setForm,
}: {
  form: EmailFormState;
  setForm: React.Dispatch<React.SetStateAction<EmailFormState>>;
}) {
  switch (form.emailProvider) {
    case 'smtp':
      return <SmtpFields form={form} setForm={setForm} />;
    case 'resend':
      return (
        <ApiKeyFromFields
          apiKeyLabel="API Key"
          apiKeyHint="Found in Resend › API Keys. Needs 'Send Email' permission."
          apiKeyValue={form.resendApiKey}
          fromValue={form.resendFrom}
          onApiKeyChange={(v) => setForm((f) => ({ ...f, resendApiKey: v }))}
          onFromChange={(v) => setForm((f) => ({ ...f, resendFrom: v }))}
        />
      );
    case 'sendgrid':
      return (
        <ApiKeyFromFields
          apiKeyLabel="API Key"
          apiKeyHint="Found in SendGrid › Settings › API Keys. Needs 'Mail Send' scope."
          apiKeyValue={form.sendgridApiKey}
          fromValue={form.sendgridFrom}
          onApiKeyChange={(v) => setForm((f) => ({ ...f, sendgridApiKey: v }))}
          onFromChange={(v) => setForm((f) => ({ ...f, sendgridFrom: v }))}
        />
      );
    case 'mailgun':
      return <MailgunFields form={form} setForm={setForm} />;
    case 'postmark':
      return (
        <ApiKeyFromFields
          apiKeyLabel="Server Token"
          apiKeyHint="Found in Postmark › Server › API Tokens."
          apiKeyValue={form.postmarkServerToken}
          fromValue={form.postmarkFrom}
          onApiKeyChange={(v) => setForm((f) => ({ ...f, postmarkServerToken: v }))}
          onFromChange={(v) => setForm((f) => ({ ...f, postmarkFrom: v }))}
        />
      );
    default:
      return null;
  }
}

// ── Main component ─────────────────────────────────────────────────────────

export default function EmailProviderForm({ realm }: EmailProviderFormProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<EmailFormState>(() => seedFromRealm(realm));
  const [testEmailTo, setTestEmailTo] = useState('');

  const [seededRealm, setSeededRealm] = useState(realm);
  if (realm !== seededRealm) {
    setSeededRealm(realm);
    setForm(seedFromRealm(realm));
  }

  const updateMutation = useMutation({
    mutationFn: () =>
      updateRealm(realm.name, {
        emailProvider: form.emailProvider,
        emailProviderConfig: buildProviderConfig(form),
        smtpHost: form.smtpHost || null,
        smtpPort: form.smtpPort,
        smtpUser: form.smtpUser || null,
        smtpPassword: form.smtpPassword || null,
        smtpFrom: form.smtpFrom || null,
        smtpSecure: form.smtpSecure,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['realm', realm.name] });
      queryClient.invalidateQueries({ queryKey: ['realms'] });
    },
  });

  const testMutation = useMutation({
    mutationFn: () => sendTestEmail(realm.name, testEmailTo),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    updateMutation.mutate();
  }

  const activeProvider = PROVIDERS.find((p) => p.value === form.emailProvider);
  const hasConfig = form.emailProvider !== 'none';

  return (
    <div className="space-y-6">
      {/* Provider selector */}
      <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Email Provider</h2>
          <p className="mt-1 text-sm text-gray-500">
            Choose how Idenplane delivers email for this realm — password resets, verification links, and notifications.
          </p>
        </div>

        {/* Provider grid */}
        <div className="grid grid-cols-3 gap-3">
          {PROVIDERS.map((p) => {
            const selected = form.emailProvider === p.value;
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => setForm((f) => ({ ...f, emailProvider: p.value }))}
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

        {/* Provider-specific fields */}
        {hasConfig && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-5">
            <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-gray-400">
              {activeProvider?.label} Configuration
            </p>
            <ProviderFields form={form} setForm={setForm} />
          </div>
        )}

        {/* Status banners */}
        {updateMutation.isSuccess && (
          <div role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-700">
            Email settings saved successfully.
          </div>
        )}
        {updateMutation.isError && (
          <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {getErrorMessage(updateMutation.error, 'Failed to save email settings.')}
          </div>
        )}

        <div className="flex justify-end border-t border-gray-200 pt-4">
          <button
            type="submit"
            disabled={updateMutation.isPending}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>

      {/* Test email */}
      {hasConfig && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900">Send a Test Email</h3>
          <p className="mt-1 text-xs text-gray-500">
            Save your settings above first, then send a test to verify delivery.
          </p>
          <div className="mt-4 flex items-end gap-3">
            <div className="flex-1">
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Recipient</label>
              <input
                type="email"
                value={testEmailTo}
                onChange={(e) => setTestEmailTo(e.target.value)}
                placeholder="you@example.com"
                className={inputClass}
              />
            </div>
            <button
              type="button"
              onClick={() => { testMutation.reset(); testMutation.mutate(); }}
              disabled={testMutation.isPending || !testEmailTo}
              className="rounded-md bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
            >
              {testMutation.isPending ? 'Sending…' : 'Send Test'}
            </button>
          </div>
          {testMutation.isSuccess && (
            <p role="status" className="mt-3 text-sm text-green-700">
              ✓ Test email sent successfully!
            </p>
          )}
          {testMutation.isError && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {getErrorMessage(testMutation.error, 'Failed to send test email. Check your settings.')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
