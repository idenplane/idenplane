import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router';
import type { Realm } from '../../types';
import { getRealmByName } from '../../api/realms';
import { getPublicRegistrationFields } from '../../api/registration';
import CaptchaWidget, { type CaptchaWidgetHandle } from '../../components/registration/CaptchaWidget';
import { captchaConfig } from '../../components/registration/captcha';

interface RegistrationField {
  name: string;
  displayName: string;
  type: string;
  required: boolean;
  placeholder?: string;
  helpText?: string;
  options?: string[];
}

export default function PublicRegistrationPage() {
  const { realm: realmName } = useParams<{ realm: string }>();
  const [realm, setRealm] = useState<Realm | null>(null);
  const [fields, setFields] = useState<Partial<RegistrationField>[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const captchaRef = useRef<CaptchaWidgetHandle>(null);
  const captcha = captchaConfig(realm);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [form, setForm] = useState({
    username: '',
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    acceptTerms: false,
  });

  const [customAttributes, setCustomAttributes] = useState<Record<string, string>>({});

  useEffect(() => {
    async function loadData() {
      if (!realmName) return;
      try {
        const [realmData, fieldsData] = await Promise.all([
          getRealmByName(realmName),
          getPublicRegistrationFields(realmName),
        ]);
        setRealm(realmData);
        setFields(fieldsData);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, [realmName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!realmName) return;

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      // The server decides whether CAPTCHA is required, from the realm's
      // settings only; the page just supplies the token of that provider.
      let captchaToken: string | undefined;
      if (captcha) {
        const token = await captchaRef.current?.getToken();
        if (!token) {
          throw new Error('Please complete the CAPTCHA challenge.');
        }
        captchaToken = token;
      }

      const response = await fetch(
        `/realms/${encodeURIComponent(realmName)}/registration/register`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...form,
            attributes: customAttributes,
            ...(captchaToken ? { captchaToken } : {}),
          }),
        },
      );
      // A token works once, whatever the outcome.
      captchaRef.current?.reset();

      const data = (await response.json().catch(() => ({}))) as {
        message?: string | string[];
      };
      if (!response.ok) {
        const message = Array.isArray(data.message) ? data.message.join('. ') : data.message;
        throw new Error(message || 'Registration failed');
      }

      setSuccess(typeof data.message === 'string' ? data.message : 'Registration successful.');
      setForm({ username: '', email: '', password: '', firstName: '', lastName: '', acceptTerms: false });
      setCustomAttributes({});
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-sunken">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent"></div>
      </div>
    );
  }

  if (error && !realm) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-sunken">
        <div className="bg-surface p-8 rounded-lg shadow-md max-w-md w-full">
          <h1 className="text-xl font-bold text-danger mb-4">Error</h1>
          <p className="text-muted">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-sunken py-12 px-4">
      <div className="max-w-md mx-auto">
        <div className="bg-surface rounded-lg shadow-md p-8">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-fg">
              Create Account
            </h1>
            <p className="mt-2 text-sm text-subtle">
              {realm?.displayName || realmName}
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-danger-soft border border-danger-soft rounded-md text-danger-fg text-sm">
              {error}
            </div>
          )}

          {success && (
            <div className="mb-4 p-3 bg-success-soft border border-success-soft rounded-md text-success-fg text-sm">
              {success}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-muted mb-1">
                Username <span className="text-danger">*</span>
              </label>
              <input
                type="text"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                required
                minLength={3}
                pattern="^[a-zA-Z0-9_-]+$"
                className="w-full px-3 py-2 border border-line-strong rounded-md shadow-sm focus:outline-none focus:ring-accent focus:border-accent"
                placeholder="Choose a username"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-muted mb-1">
                Email <span className="text-danger">*</span>
              </label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
                className="w-full px-3 py-2 border border-line-strong rounded-md shadow-sm focus:outline-none focus:ring-accent focus:border-accent"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-muted mb-1">
                Password <span className="text-danger">*</span>
              </label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                minLength={8}
                className="w-full px-3 py-2 border border-line-strong rounded-md shadow-sm focus:outline-none focus:ring-accent focus:border-accent"
                placeholder="Create a password"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-muted mb-1">First Name</label>
                <input
                  type="text"
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  className="w-full px-3 py-2 border border-line-strong rounded-md shadow-sm focus:outline-none focus:ring-accent focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Last Name</label>
                <input
                  type="text"
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  className="w-full px-3 py-2 border border-line-strong rounded-md shadow-sm focus:outline-none focus:ring-accent focus:border-accent"
                />
              </div>
            </div>

            {/* Custom registration fields */}
            {fields.map((field) => (
              <div key={field.name}>
                <label className="block text-sm font-medium text-muted mb-1">
                  {field.displayName}
                  {field.required && <span className="text-danger"> *</span>}
                </label>
                {field.type === 'select' && field.options ? (
                  <select
                    value={customAttributes[field.name ?? ''] || ''}
                    onChange={(e) => setCustomAttributes({ ...customAttributes, [field.name!]: e.target.value })}
                    required={field.required}
                    className="w-full px-3 py-2 border border-line-strong rounded-md shadow-sm focus:outline-none focus:ring-accent focus:border-accent"
                  >
                    <option value="">Select...</option>
                    {field.options.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : field.type === 'checkbox' ? (
                  <input
                    type="checkbox"
                    checked={customAttributes[field.name ?? ''] === 'true'}
                    onChange={(e) => setCustomAttributes({ ...customAttributes, [field.name!]: e.target.checked.toString() })}
                    className="h-4 w-4 text-accent border-line-strong rounded focus:ring-accent"
                  />
                ) : (
                  <input
                    type={field.type === 'email' ? 'email' : field.type === 'number' ? 'number' : 'text'}
                    value={customAttributes[field.name ?? ''] || ''}
                    onChange={(e) => setCustomAttributes({ ...customAttributes, [field.name!]: e.target.value })}
                    required={field.required}
                    placeholder={field.placeholder}
                    pattern={field.type === 'text' ? field.name ?? undefined : undefined}
                    className="w-full px-3 py-2 border border-line-strong rounded-md shadow-sm focus:outline-none focus:ring-accent focus:border-accent"
                  />
                )}
                {field.helpText && (
                  <p className="mt-1 text-xs text-subtle">{field.helpText}</p>
                )}
              </div>
            ))}

            {/* CAPTCHA widget */}
            {captcha && (
              <CaptchaWidget
                ref={captchaRef}
                provider={captcha.provider}
                siteKey={captcha.siteKey}
              />
            )}

            {/* Terms of Service */}
            {realm?.termsOfServiceUrl && (
              <div className="flex items-start">
                <input
                  type="checkbox"
                  checked={form.acceptTerms}
                  onChange={(e) => setForm({ ...form, acceptTerms: e.target.checked })}
                  required
                  className="h-4 w-4 text-accent border-line-strong rounded focus:ring-accent mt-1"
                />
                <label className="ml-2 text-sm text-muted">
                  I accept the{' '}
                  <a href={realm.termsOfServiceUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:text-accent">
                    Terms of Service
                  </a>
                  {realm.privacyPolicyUrl && (
                    <> and <a href={realm.privacyPolicyUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:text-accent">
                      Privacy Policy
                    </a></>
                  )}
                </label>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2 px-4 bg-accent text-white rounded-md hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 disabled:opacity-50"
            >
              {isSubmitting ? 'Creating Account...' : 'Create Account'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <a href={`/console/login`} className="text-sm text-accent hover:text-accent">
              Already have an account? Sign in
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}