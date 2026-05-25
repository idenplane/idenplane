import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import type { Realm } from '../../types';
import { getRealmByName } from '../../api/realms';
import { getPublicRegistrationFields } from '../../api/registration';
import CaptchaWidget from '../../components/registration/CaptchaWidget';

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
      const response = await fetch(`/api/realms/${realmName}/registration/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          attributes: customAttributes,
          captchaToken: window.__captchaToken,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Registration failed');
      }

      const data = await response.json();
      setSuccess(data.message);
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
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (error && !realm) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full">
          <h1 className="text-xl font-bold text-red-600 mb-4">Error</h1>
          <p className="text-gray-700">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 py-12 px-4">
      <div className="max-w-md mx-auto">
        <div className="bg-white rounded-lg shadow-md p-8">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-gray-900">
              Create Account
            </h1>
            <p className="mt-2 text-sm text-gray-500">
              {realm?.displayName || realmName}
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
              {error}
            </div>
          )}

          {success && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md text-green-700 text-sm">
              {success}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Username <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                required
                minLength={3}
                pattern="^[a-zA-Z0-9_-]+$"
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                placeholder="Choose a username"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                minLength={8}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                placeholder="Create a password"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
                <input
                  type="text"
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
                <input
                  type="text"
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
            </div>

            {/* Custom registration fields */}
            {fields.map((field) => (
              <div key={field.name}>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {field.displayName}
                  {field.required && <span className="text-red-500"> *</span>}
                </label>
                {field.type === 'select' && field.options ? (
                  <select
                    value={customAttributes[field.name ?? ''] || ''}
                    onChange={(e) => setCustomAttributes({ ...customAttributes, [field.name!]: e.target.value })}
                    required={field.required}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
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
                    className="h-4 w-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                  />
                ) : (
                  <input
                    type={field.type === 'email' ? 'email' : field.type === 'number' ? 'number' : 'text'}
                    value={customAttributes[field.name ?? ''] || ''}
                    onChange={(e) => setCustomAttributes({ ...customAttributes, [field.name!]: e.target.value })}
                    required={field.required}
                    placeholder={field.placeholder}
                    pattern={field.type === 'text' ? field.name ?? undefined : undefined}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  />
                )}
                {field.helpText && (
                  <p className="mt-1 text-xs text-gray-500">{field.helpText}</p>
                )}
              </div>
            ))}

            {/* CAPTCHA widget */}
            {realm?.captchaEnabled && (
              <CaptchaWidget
                provider={realm.captchaProvider}
                siteKey={realm.recaptchaSiteKey || realm.hcaptchaSiteKey}
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
                  className="h-4 w-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500 mt-1"
                />
                <label className="ml-2 text-sm text-gray-700">
                  I accept the{' '}
                  <a href={realm.termsOfServiceUrl} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:text-primary-500">
                    Terms of Service
                  </a>
                  {realm.privacyPolicyUrl && (
                    <> and <a href={realm.privacyPolicyUrl} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:text-primary-500">
                      Privacy Policy
                    </a></>
                  )}
                </label>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2 px-4 bg-primary-600 text-white rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50"
            >
              {isSubmitting ? 'Creating Account...' : 'Create Account'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <a href={`/console/login`} className="text-sm text-primary-600 hover:text-primary-500">
              Already have an account? Sign in
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}