import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRealmByName, updateRealm } from '../../api/realms';
import type { Realm } from '../../types';

export default function RegistrationSettingsPage() {
  const { name } = useParams<{ name: string }>();
  const queryClient = useQueryClient();

  const { data: realm, isLoading } = useQuery({
    queryKey: ['realm', name],
    queryFn: () => getRealmByName(name!),
    enabled: !!name,
  });

  const [form, setForm] = useState({
    registrationAllowed: true,
    registrationApprovalRequired: false,
    requireEmailVerification: false,
    allowedEmailDomains: '',
    termsOfServiceUrl: '',
    privacyPolicyUrl: '',
    captchaEnabled: false,
    captchaProvider: 'recaptcha',
    recaptchaSiteKey: '',
    recaptchaSecretKey: '',
    hcaptchaSiteKey: '',
    hcaptchaSecretKey: '',
    captchaScoreThreshold: 0.5,
  });

  // Update form when realm loads
  useState(() => {
    if (realm) {
      setForm({
        registrationAllowed: realm.registrationAllowed ?? true,
        registrationApprovalRequired: realm.registrationApprovalRequired ?? false,
        requireEmailVerification: realm.requireEmailVerification ?? false,
        allowedEmailDomains: (realm.allowedEmailDomains || []).join(', '),
        termsOfServiceUrl: realm.termsOfServiceUrl || '',
        privacyPolicyUrl: realm.privacyPolicyUrl || '',
        captchaEnabled: realm.captchaEnabled ?? false,
        captchaProvider: realm.captchaProvider || 'recaptcha',
        recaptchaSiteKey: realm.recaptchaSiteKey || '',
        recaptchaSecretKey: realm.recaptchaSecretKey || '',
        hcaptchaSiteKey: realm.hcaptchaSiteKey || '',
        hcaptchaSecretKey: realm.hcaptchaSecretKey || '',
        captchaScoreThreshold: realm.captchaScoreThreshold ?? 0.5,
      });
    }
  });

  const mutation = useMutation({
    mutationFn: (data: typeof form) => {
      const updateData = {
        ...data,
        allowedEmailDomains: data.allowedEmailDomains
          ? data.allowedEmailDomains.split(',').map((s) => s.trim()).filter(Boolean)
          : [],
      };
      return updateRealm(name!, updateData as unknown as Partial<Realm>);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['realm', name] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(form);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Registration Settings</h1>

      <div className="bg-white shadow-sm rounded-lg border border-gray-200 p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Registration toggle */}
          <div className="border-b border-gray-200 pb-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Registration</h2>
            <div className="space-y-4">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={form.registrationAllowed}
                  onChange={(e) => setForm({ ...form, registrationAllowed: e.target.checked })}
                  className="h-4 w-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                />
                <span className="ml-2 text-sm text-gray-700">Allow self-registration</span>
              </label>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={form.registrationApprovalRequired}
                  onChange={(e) => setForm({ ...form, registrationApprovalRequired: e.target.checked })}
                  className="h-4 w-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                />
                <span className="ml-2 text-sm text-gray-700">Require admin approval</span>
              </label>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={form.requireEmailVerification}
                  onChange={(e) => setForm({ ...form, requireEmailVerification: e.target.checked })}
                  className="h-4 w-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                />
                <span className="ml-2 text-sm text-gray-700">Require email verification</span>
              </label>
            </div>
          </div>

          {/* Email domain restrictions */}
          <div className="border-b border-gray-200 pb-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Email Domain Restrictions</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Allowed email domains (comma-separated, leave empty for all)
              </label>
              <input
                type="text"
                value={form.allowedEmailDomains}
                onChange={(e) => setForm({ ...form, allowedEmailDomains: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                placeholder="example.com, company.org"
              />
            </div>
          </div>

          {/* Legal links */}
          <div className="border-b border-gray-200 pb-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Legal</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Terms of Service URL</label>
                <input
                  type="url"
                  value={form.termsOfServiceUrl}
                  onChange={(e) => setForm({ ...form, termsOfServiceUrl: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  placeholder="https://example.com/terms"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Privacy Policy URL</label>
                <input
                  type="url"
                  value={form.privacyPolicyUrl}
                  onChange={(e) => setForm({ ...form, privacyPolicyUrl: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  placeholder="https://example.com/privacy"
                />
              </div>
            </div>
          </div>

          {/* CAPTCHA settings */}
          <div>
            <h2 className="text-lg font-medium text-gray-900 mb-4">CAPTCHA Protection</h2>
            <div className="space-y-4">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={form.captchaEnabled}
                  onChange={(e) => setForm({ ...form, captchaEnabled: e.target.checked })}
                  className="h-4 w-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                />
                <span className="ml-2 text-sm text-gray-700">Enable CAPTCHA</span>
              </label>

              {form.captchaEnabled && (
                <div className="pl-6 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Provider</label>
                    <select
                      value={form.captchaProvider}
                      onChange={(e) => setForm({ ...form, captchaProvider: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                    >
                      <option value="recaptcha">reCAPTCHA v3</option>
                      <option value="hcaptcha">hCaptcha</option>
                    </select>
                  </div>

                  {form.captchaProvider === 'recaptcha' ? (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Site Key</label>
                        <input
                          type="text"
                          value={form.recaptchaSiteKey}
                          onChange={(e) => setForm({ ...form, recaptchaSiteKey: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Secret Key</label>
                        <input
                          type="password"
                          value={form.recaptchaSecretKey}
                          onChange={(e) => setForm({ ...form, recaptchaSecretKey: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Score Threshold (0-1)</label>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="1"
                          value={form.captchaScoreThreshold}
                          onChange={(e) => setForm({ ...form, captchaScoreThreshold: parseFloat(e.target.value) })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                        />
                        <p className="mt-1 text-xs text-gray-500">Lower values are more restrictive (default: 0.5)</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Site Key</label>
                        <input
                          type="text"
                          value={form.hcaptchaSiteKey}
                          onChange={(e) => setForm({ ...form, hcaptchaSiteKey: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Secret Key</label>
                        <input
                          type="password"
                          value={form.hcaptchaSecretKey}
                          onChange={(e) => setForm({ ...form, hcaptchaSecretKey: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                        />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={mutation.isPending}
              className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
            >
              {mutation.isPending ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}