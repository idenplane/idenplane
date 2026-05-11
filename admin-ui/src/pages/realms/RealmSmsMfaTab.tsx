import type { SmsProviderType, SmsProviderConfig } from '../../types';
import PasswordInput from '../../components/PasswordInput';

export interface SmsMfaFormData {
  smsMfaEnabled: boolean;
  smsProvider: SmsProviderType;
  smsFrom: string;
  smsProviderConfig: SmsProviderConfig;
  otpLength: number;
  otpExpirySeconds: number;
  smsMaxRequestsPerUser: number;
  smsRateLimitWindow: number;
}

interface Props {
  form: SmsMfaFormData;
  onChange: (updates: Partial<SmsMfaFormData>) => void;
  isConfigured: boolean;
}

export default function RealmSmsMfaTab({ form, onChange, isConfigured }: Props) {
  const smsProviders: { value: SmsProviderType; label: string }[] = [
    { value: 'none', label: 'None (Disabled)' },
    { value: 'twilio', label: 'Twilio' },
    { value: 'vonage', label: 'Vonage (Nexmo)' },
    { value: 'aws-sns', label: 'AWS SNS' },
    { value: 'webhook', label: 'Generic Webhook' },
  ];

  const updateConfig = (updates: Partial<SmsProviderConfig>) => {
    onChange({
      smsProviderConfig: { ...form.smsProviderConfig, ...updates },
    });
  };

  return (
    <div className="space-y-6">
      {/* Enable SMS MFA */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900">SMS Multi-Factor Authentication</h2>
          <p className="mt-1 text-sm text-gray-500">
            Enable SMS-based OTP as a second-factor authentication method. Users will receive
            verification codes via SMS when logging in.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="smsMfaEnabled"
            checked={form.smsMfaEnabled}
            onChange={(e) => onChange({ smsMfaEnabled: e.target.checked })}
            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          <label htmlFor="smsMfaEnabled" className="text-sm font-medium text-gray-700">
            Enable SMS MFA
          </label>
        </div>
      </div>

      {/* Provider Configuration */}
      {form.smsMfaEnabled && (
        <>
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="text-base font-semibold text-gray-900">SMS Provider Configuration</h3>
            <p className="mt-1 text-xs text-gray-500">
              Select your SMS provider and configure the connection settings.
            </p>

            <div className="mt-4 space-y-4">
              <div>
                <label htmlFor="smsProvider" className="mb-1.5 block text-sm font-medium text-gray-700">
                  SMS Provider
                </label>
                <select
                  id="smsProvider"
                  value={form.smsProvider}
                  onChange={(e) => onChange({ smsProvider: e.target.value as SmsProviderType })}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                >
                  {smsProviders.map((provider) => (
                    <option key={provider.value} value={provider.value}>
                      {provider.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="smsFrom" className="mb-1.5 block text-sm font-medium text-gray-700">
                  From Phone Number
                </label>
                <input
                  id="smsFrom"
                  type="text"
                  value={form.smsFrom}
                  onChange={(e) => onChange({ smsFrom: e.target.value })}
                  placeholder="+1234567890"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
                <p className="mt-1 text-xs text-gray-400">
                  The phone number that will appear as the sender. Must be registered with your SMS provider.
                </p>
              </div>
            </div>
          </div>

          {/* Provider-specific settings */}
          {form.smsProvider === 'twilio' && (
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-base font-semibold text-gray-900">Twilio Configuration</h3>
              <p className="mt-1 text-xs text-gray-500">
                Configure your Twilio account credentials.
              </p>

              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="twilioAccountSid" className="mb-1.5 block text-sm font-medium text-gray-700">
                      Account SID
                    </label>
                    <input
                      id="twilioAccountSid"
                      type="text"
                      value={form.smsProviderConfig.twilioAccountSid ?? ''}
                      onChange={(e) => updateConfig({ twilioAccountSid: e.target.value })}
                      placeholder="ACxxxxxxxxxxxx"
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="twilioAuthToken" className="mb-1.5 block text-sm font-medium text-gray-700">
                      Auth Token
                    </label>
                    <PasswordInput
                      id="twilioAuthToken"
                      value={form.smsProviderConfig.twilioAuthToken ?? ''}
                      onChange={(e) => updateConfig({ twilioAuthToken: e.target.value })}
                      placeholder="Your Twilio auth token"
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {form.smsProvider === 'vonage' && (
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-base font-semibold text-gray-900">Vonage Configuration</h3>
              <p className="mt-1 text-xs text-gray-500">
                Configure your Vonage API credentials.
              </p>

              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="vonageApiKey" className="mb-1.5 block text-sm font-medium text-gray-700">
                      API Key
                    </label>
                    <input
                      id="vonageApiKey"
                      type="text"
                      value={form.smsProviderConfig.vonageApiKey ?? ''}
                      onChange={(e) => updateConfig({ vonageApiKey: e.target.value })}
                      placeholder="Your Vonage API key"
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="vonageApiSecret" className="mb-1.5 block text-sm font-medium text-gray-700">
                      API Secret
                    </label>
                    <PasswordInput
                      id="vonageApiSecret"
                      value={form.smsProviderConfig.vonageApiSecret ?? ''}
                      onChange={(e) => updateConfig({ vonageApiSecret: e.target.value })}
                      placeholder="Your Vonage API secret"
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {form.smsProvider === 'aws-sns' && (
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-base font-semibold text-gray-900">AWS SNS Configuration</h3>
              <p className="mt-1 text-xs text-gray-500">
                Configure your AWS credentials for SNS SMS delivery.
              </p>

              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="awsAccessKeyId" className="mb-1.5 block text-sm font-medium text-gray-700">
                      Access Key ID
                    </label>
                    <input
                      id="awsAccessKeyId"
                      type="text"
                      value={form.smsProviderConfig.awsAccessKeyId ?? ''}
                      onChange={(e) => updateConfig({ awsAccessKeyId: e.target.value })}
                      placeholder="AKIAIOSFODNN7EXAMPLE"
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="awsSecretAccessKey" className="mb-1.5 block text-sm font-medium text-gray-700">
                      Secret Access Key
                    </label>
                    <PasswordInput
                      id="awsSecretAccessKey"
                      value={form.smsProviderConfig.awsSecretAccessKey ?? ''}
                      onChange={(e) => updateConfig({ awsSecretAccessKey: e.target.value })}
                      placeholder="Your AWS secret access key"
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="awsRegion" className="mb-1.5 block text-sm font-medium text-gray-700">
                      AWS Region
                    </label>
                    <input
                      id="awsRegion"
                      type="text"
                      value={form.smsProviderConfig.awsRegion ?? ''}
                      onChange={(e) => updateConfig({ awsRegion: e.target.value })}
                      placeholder="us-east-1"
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {form.smsProvider === 'webhook' && (
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-base font-semibold text-gray-900">Webhook Configuration</h3>
              <p className="mt-1 text-xs text-gray-500">
                Configure a generic webhook endpoint for SMS delivery.
              </p>

              <div className="mt-4 space-y-4">
                <div>
                  <label htmlFor="webhookUrl" className="mb-1.5 block text-sm font-medium text-gray-700">
                    Webhook URL
                  </label>
                  <input
                    id="webhookUrl"
                    type="url"
                    value={form.smsProviderConfig.webhookUrl ?? ''}
                    onChange={(e) => updateConfig({ webhookUrl: e.target.value })}
                    placeholder="https://api.example.com/sms/send"
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    The webhook will receive a POST request with <code className="bg-gray-100 px-1">to</code>,{' '}
                    <code className="bg-gray-100 px-1">message</code>, and{' '}
                    <code className="bg-gray-100 px-1">timestamp</code> fields.
                  </p>
                </div>

                <div>
                  <label htmlFor="webhookHeaders" className="mb-1.5 block text-sm font-medium text-gray-700">
                    Custom Headers (JSON)
                  </label>
                  <textarea
                    id="webhookHeaders"
                    value={form.smsProviderConfig.webhookHeaders ?? '{}'}
                    onChange={(e) => updateConfig({ webhookHeaders: e.target.value })}
                    placeholder='{"Authorization": "Bearer your-token"}'
                    rows={2}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none font-mono"
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    Optional headers to include with the webhook request. Must be valid JSON.
                  </p>
                </div>

                <div>
                  <label htmlFor="webhookTimeout" className="mb-1.5 block text-sm font-medium text-gray-700">
                    Request Timeout (ms)
                  </label>
                  <input
                    id="webhookTimeout"
                    type="number"
                    min={1000}
                    max={60000}
                    value={form.smsProviderConfig.webhookTimeout ?? 30000}
                    onChange={(e) => updateConfig({ webhookTimeout: Number(e.target.value) })}
                    className="w-40 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    Maximum time to wait for webhook response (1000-60000ms). Default: 30000ms.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* OTP Settings */}
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="text-base font-semibold text-gray-900">OTP Settings</h3>
            <p className="mt-1 text-xs text-gray-500">
              Configure the one-time password format and expiration.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="otpLength" className="mb-1.5 block text-sm font-medium text-gray-700">
                  OTP Length
                </label>
                <select
                  id="otpLength"
                  value={form.otpLength}
                  onChange={(e) => onChange({ otpLength: Number(e.target.value) })}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                >
                  <option value={4}>4 digits</option>
                  <option value={5}>5 digits</option>
                  <option value={6}>6 digits</option>
                  <option value={7}>7 digits</option>
                  <option value={8}>8 digits</option>
                </select>
                <p className="mt-1 text-xs text-gray-400">
                  Number of digits in the OTP code. Default: 6.
                </p>
              </div>

              <div>
                <label htmlFor="otpExpirySeconds" className="mb-1.5 block text-sm font-medium text-gray-700">
                  OTP Expiry (seconds)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="otpExpirySeconds"
                    type="number"
                    min={30}
                    max={600}
                    value={form.otpExpirySeconds}
                    onChange={(e) => onChange({ otpExpirySeconds: Number(e.target.value) })}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  />
                  <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                    {formatOtpExpiry(form.otpExpirySeconds)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-400">
                  Time before the OTP expires (30-600s). Default: 300s (5 minutes).
                </p>
              </div>
            </div>
          </div>

          {/* Rate Limiting */}
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="text-base font-semibold text-gray-900">Rate Limiting</h3>
            <p className="mt-1 text-xs text-gray-500">
              Prevent abuse by limiting SMS OTP requests per user.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="smsMaxRequestsPerUser" className="mb-1.5 block text-sm font-medium text-gray-700">
                  Max Requests per User
                </label>
                <input
                  id="smsMaxRequestsPerUser"
                  type="number"
                  min={1}
                  max={10}
                  value={form.smsMaxRequestsPerUser}
                  onChange={(e) => onChange({ smsMaxRequestsPerUser: Number(e.target.value) })}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
                <p className="mt-1 text-xs text-gray-400">
                  Maximum SMS OTP requests per user within the rate limit window. Default: 3.
                </p>
              </div>

              <div>
                <label htmlFor="smsRateLimitWindow" className="mb-1.5 block text-sm font-medium text-gray-700">
                  Rate Limit Window (seconds)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="smsRateLimitWindow"
                    type="number"
                    min={60}
                    max={3600}
                    value={form.smsRateLimitWindow}
                    onChange={(e) => onChange({ smsRateLimitWindow: Number(e.target.value) })}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  />
                  <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                    {formatDuration(form.smsRateLimitWindow)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-400">
                  Time window for rate limiting (60-3600s). Default: 900s (15 minutes).
                </p>
              </div>
            </div>
          </div>

          {/* Status indicator */}
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className={`h-3 w-3 rounded-full ${isConfigured ? 'bg-green-500' : 'bg-yellow-500'}`} />
              <div>
                <p className="text-sm font-medium text-gray-700">
                  {isConfigured ? 'SMS MFA is configured' : 'SMS MFA is not fully configured'}
                </p>
                <p className="text-xs text-gray-500">
                  {isConfigured
                    ? 'SMS MFA is ready to use. Users can register their phone numbers and use SMS OTP during login.'
                    : 'Configure your SMS provider settings to enable SMS MFA.'}
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

function formatOtpExpiry(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) return `${minutes}m`;
  return `${minutes}m ${remainingSeconds}s`;
}