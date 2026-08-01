import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Realm } from '../../types';
import { updateRealm } from '../../api/realms';
import { formatDuration } from '../../utils/formatDuration';

type SecuritySettingsFormProps = {
  realm: Realm;
};

function seedFromRealm(realm: Realm) {
  return {
    // Password Policy
    passwordMinLength: realm.passwordMinLength ?? 8,
    passwordRequireUppercase: realm.passwordRequireUppercase ?? false,
    passwordRequireLowercase: realm.passwordRequireLowercase ?? false,
    passwordRequireDigits: realm.passwordRequireDigits ?? false,
    passwordRequireSpecialChars: realm.passwordRequireSpecialChars ?? false,
    passwordHistoryCount: realm.passwordHistoryCount ?? 0,
    passwordMaxAgeDays: realm.passwordMaxAgeDays ?? 0,
    // Brute Force Protection
    bruteForceEnabled: realm.bruteForceEnabled ?? false,
    maxLoginFailures: realm.maxLoginFailures ?? 5,
    lockoutDuration: realm.lockoutDuration ?? 300,
    failureResetTime: realm.failureResetTime ?? 600,
    permanentLockoutAfter: realm.permanentLockoutAfter ?? 0,
    // MFA
    mfaRequired: realm.mfaRequired ?? false,
    // WebAuthn
    webAuthnEnabled: realm.webAuthnEnabled ?? false,
    webAuthnRpName: realm.webAuthnRpName ?? '',
    webAuthnRpId: realm.webAuthnRpId ?? '',
    webAuthnUserVerificationRequired: realm.webAuthnUserVerificationRequired ?? false,
    // Rate Limiting
    rateLimitEnabled: realm.rateLimitEnabled ?? false,
    clientRateLimitPerMinute: realm.clientRateLimitPerMinute ?? 100,
    clientRateLimitPerHour: realm.clientRateLimitPerHour ?? 1000,
    userRateLimitPerMinute: realm.userRateLimitPerMinute ?? 30,
    userRateLimitPerHour: realm.userRateLimitPerHour ?? 300,
    ipRateLimitPerMinute: realm.ipRateLimitPerMinute ?? 60,
    ipRateLimitPerHour: realm.ipRateLimitPerHour ?? 600,
    // Impersonation
    impersonationEnabled: realm.impersonationEnabled ?? false,
    impersonationMaxDuration: realm.impersonationMaxDuration ?? 1800,
    // Risk Thresholds
    riskThresholdStepUp: realm.riskThresholdStepUp ?? 50,
    riskThresholdBlock: realm.riskThresholdBlock ?? 80,
    // Session Limits
    maxSessionsPerUser: realm.maxSessionsPerUser ?? 0,
    // Adaptive Authentication
    adaptiveAuthEnabled: realm.adaptiveAuthEnabled ?? false,
  };
}

export default function SecuritySettingsForm({ realm }: SecuritySettingsFormProps) {
  const queryClient = useQueryClient();

  const [form, setForm] = useState(() => seedFromRealm(realm));

  // Reseed the editable form when the realm prop changes (e.g. after a refetch).
  // Adjusting state during render (vs. an effect) avoids an extra render pass.
  const [seededRealm, setSeededRealm] = useState(realm);
  if (realm !== seededRealm) {
    setSeededRealm(realm);
    setForm(seedFromRealm(realm));
  }

  const updateMutation = useMutation({
    mutationFn: () => updateRealm(realm.name, { ...form }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['realm', realm.name] });
      queryClient.invalidateQueries({ queryKey: ['realms'] });
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    updateMutation.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8 rounded-lg border border-line bg-surface p-6 shadow-sm">
      {/* Password Policy */}
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-fg">Password Policy</h2>
          <p className="mt-1 text-sm text-subtle">
            Define password complexity and rotation requirements for users in this realm.
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">
            Minimum Password Length
          </label>
          <input
            type="number"
            min={1}
            value={form.passwordMinLength}
            onChange={(e) =>
              setForm({ ...form, passwordMinLength: Number(e.target.value) })
            }
            className="w-40 rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="passwordRequireUppercase"
              checked={form.passwordRequireUppercase}
              onChange={(e) =>
                setForm({ ...form, passwordRequireUppercase: e.target.checked })
              }
              className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
            />
            <label htmlFor="passwordRequireUppercase" className="text-sm font-medium text-muted">
              Require uppercase letters
            </label>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="passwordRequireLowercase"
              checked={form.passwordRequireLowercase}
              onChange={(e) =>
                setForm({ ...form, passwordRequireLowercase: e.target.checked })
              }
              className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
            />
            <label htmlFor="passwordRequireLowercase" className="text-sm font-medium text-muted">
              Require lowercase letters
            </label>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="passwordRequireDigits"
              checked={form.passwordRequireDigits}
              onChange={(e) =>
                setForm({ ...form, passwordRequireDigits: e.target.checked })
              }
              className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
            />
            <label htmlFor="passwordRequireDigits" className="text-sm font-medium text-muted">
              Require digits
            </label>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="passwordRequireSpecialChars"
              checked={form.passwordRequireSpecialChars}
              onChange={(e) =>
                setForm({ ...form, passwordRequireSpecialChars: e.target.checked })
              }
              className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
            />
            <label htmlFor="passwordRequireSpecialChars" className="text-sm font-medium text-muted">
              Require special characters
            </label>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">
            Password History Count
          </label>
          <input
            type="number"
            min={0}
            value={form.passwordHistoryCount}
            onChange={(e) =>
              setForm({ ...form, passwordHistoryCount: Number(e.target.value) })
            }
            className="w-40 rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
          <p className="mt-1 text-xs text-subtle">
            Number of previous passwords to remember. Users cannot reuse these.
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">
            Password Max Age (days)
          </label>
          <input
            type="number"
            min={0}
            value={form.passwordMaxAgeDays}
            onChange={(e) =>
              setForm({ ...form, passwordMaxAgeDays: Number(e.target.value) })
            }
            className="w-40 rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
          <p className="mt-1 text-xs text-subtle">
            0 = no expiry. Users will be required to change their password after this many days.
          </p>
        </div>
      </div>

      {/* Brute Force Protection */}
      <div className="space-y-6 border-t border-line pt-6">
        <div>
          <h2 className="text-lg font-semibold text-fg">Brute Force Protection</h2>
          <p className="mt-1 text-sm text-subtle">
            Protect user accounts from brute force login attacks.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="bruteForceEnabled"
            checked={form.bruteForceEnabled}
            onChange={(e) =>
              setForm({ ...form, bruteForceEnabled: e.target.checked })
            }
            className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
          />
          <label htmlFor="bruteForceEnabled" className="text-sm font-medium text-muted">
            Enable brute force protection
          </label>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">
            Max Login Failures
          </label>
          <input
            type="number"
            min={1}
            value={form.maxLoginFailures}
            onChange={(e) =>
              setForm({ ...form, maxLoginFailures: Number(e.target.value) })
            }
            className="w-40 rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
          <p className="mt-1 text-xs text-subtle">
            Number of consecutive login failures before the account is locked.
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">
            Lockout Duration (seconds)
          </label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={1}
              value={form.lockoutDuration}
              onChange={(e) =>
                setForm({ ...form, lockoutDuration: Number(e.target.value) })
              }
              className="w-40 rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
            <span className="rounded-full bg-sunken px-2.5 py-0.5 text-xs font-medium text-muted">
              {formatDuration(form.lockoutDuration)}
            </span>
          </div>
          <p className="mt-1 text-xs text-subtle">
            How long an account is locked after exceeding max failures.
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">
            Failure Reset Time (seconds)
          </label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={1}
              value={form.failureResetTime}
              onChange={(e) =>
                setForm({ ...form, failureResetTime: Number(e.target.value) })
              }
              className="w-40 rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
            <span className="rounded-full bg-sunken px-2.5 py-0.5 text-xs font-medium text-muted">
              {formatDuration(form.failureResetTime)}
            </span>
          </div>
          <p className="mt-1 text-xs text-subtle">
            Time after which the failure counter is reset if no new failures occur.
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">
            Permanent Lockout After
          </label>
          <input
            type="number"
            min={0}
            value={form.permanentLockoutAfter}
            onChange={(e) =>
              setForm({ ...form, permanentLockoutAfter: Number(e.target.value) })
            }
            className="w-40 rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
          <p className="mt-1 text-xs text-subtle">
            0 = disabled. Number of temporary lockouts before the account is permanently locked.
          </p>
        </div>
      </div>

      {/* MFA */}
      <div className="space-y-6 border-t border-line pt-6">
        <div>
          <h2 className="text-lg font-semibold text-fg">Multi-Factor Authentication</h2>
          <p className="mt-1 text-sm text-subtle">
            Configure MFA requirements for this realm.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="mfaRequired"
            checked={form.mfaRequired}
            onChange={(e) =>
              setForm({ ...form, mfaRequired: e.target.checked })
            }
            className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
          />
          <label htmlFor="mfaRequired" className="text-sm font-medium text-muted">
            Require all users to set up TOTP
          </label>
        </div>
      </div>

      {/* WebAuthn */}
      <div className="space-y-6 border-t border-line pt-6">
        <div>
          <h2 className="text-lg font-semibold text-fg">WebAuthn / Passkeys</h2>
          <p className="mt-1 text-sm text-subtle">
            Allow users to authenticate with hardware security keys and passkeys.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="webAuthnEnabled" checked={form.webAuthnEnabled}
            onChange={(e) => setForm({ ...form, webAuthnEnabled: e.target.checked })}
            className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent" />
          <label htmlFor="webAuthnEnabled" className="text-sm font-medium text-muted">Enable WebAuthn</label>
        </div>
        {form.webAuthnEnabled && (
          <div className="space-y-4 pl-6">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted">Relying Party Name</label>
              <input type="text" value={form.webAuthnRpName}
                onChange={(e) => setForm({ ...form, webAuthnRpName: e.target.value })}
                placeholder="My App"
                className="w-full max-w-md rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none" />
              <p className="mt-1 text-xs text-subtle">Display name shown to users during passkey registration</p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted">Relying Party ID (domain)</label>
              <input type="text" value={form.webAuthnRpId}
                onChange={(e) => setForm({ ...form, webAuthnRpId: e.target.value })}
                placeholder="example.com"
                className="w-full max-w-md rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none" />
              <p className="mt-1 text-xs text-subtle">Must match your domain. Credentials registered here only work on this domain.</p>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="webAuthnUserVerificationRequired" checked={form.webAuthnUserVerificationRequired}
                onChange={(e) => setForm({ ...form, webAuthnUserVerificationRequired: e.target.checked })}
                className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent" />
              <label htmlFor="webAuthnUserVerificationRequired" className="text-sm font-medium text-muted">Require user verification (biometric/PIN)</label>
            </div>
          </div>
        )}
      </div>

      {/* Rate Limiting */}
      <div className="space-y-6 border-t border-line pt-6">
        <div>
          <h2 className="text-lg font-semibold text-fg">Rate Limiting</h2>
          <p className="mt-1 text-sm text-subtle">
            Throttle authentication requests to prevent abuse.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="rateLimitEnabled" checked={form.rateLimitEnabled}
            onChange={(e) => setForm({ ...form, rateLimitEnabled: e.target.checked })}
            className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent" />
          <label htmlFor="rateLimitEnabled" className="text-sm font-medium text-muted">Enable rate limiting</label>
        </div>
        {form.rateLimitEnabled && (
          <div className="space-y-4 pl-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-muted">Client req/min</label>
                <input type="number" min={1} value={form.clientRateLimitPerMinute}
                  onChange={(e) => setForm({ ...form, clientRateLimitPerMinute: Number(e.target.value) })}
                  className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-muted">Client req/hour</label>
                <input type="number" min={1} value={form.clientRateLimitPerHour}
                  onChange={(e) => setForm({ ...form, clientRateLimitPerHour: Number(e.target.value) })}
                  className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-muted">User req/min</label>
                <input type="number" min={1} value={form.userRateLimitPerMinute}
                  onChange={(e) => setForm({ ...form, userRateLimitPerMinute: Number(e.target.value) })}
                  className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-muted">User req/hour</label>
                <input type="number" min={1} value={form.userRateLimitPerHour}
                  onChange={(e) => setForm({ ...form, userRateLimitPerHour: Number(e.target.value) })}
                  className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-muted">IP req/min</label>
                <input type="number" min={1} value={form.ipRateLimitPerMinute}
                  onChange={(e) => setForm({ ...form, ipRateLimitPerMinute: Number(e.target.value) })}
                  className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-muted">IP req/hour</label>
                <input type="number" min={1} value={form.ipRateLimitPerHour}
                  onChange={(e) => setForm({ ...form, ipRateLimitPerHour: Number(e.target.value) })}
                  className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Impersonation */}
      <div className="space-y-6 border-t border-line pt-6">
        <div>
          <h2 className="text-lg font-semibold text-fg">Impersonation</h2>
          <p className="mt-1 text-sm text-subtle">
            Allow admins to impersonate users for debugging and support.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="impersonationEnabled" checked={form.impersonationEnabled}
            onChange={(e) => setForm({ ...form, impersonationEnabled: e.target.checked })}
            className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent" />
          <label htmlFor="impersonationEnabled" className="text-sm font-medium text-muted">Allow admin impersonation</label>
        </div>
        {form.impersonationEnabled && (
          <div className="pl-6">
            <label className="mb-1.5 block text-sm font-medium text-muted">Max impersonation duration (seconds)</label>
            <div className="flex items-center gap-3">
              <input type="number" min={60} value={form.impersonationMaxDuration}
                onChange={(e) => setForm({ ...form, impersonationMaxDuration: Number(e.target.value) })}
                className="w-40 rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none" />
              <span className="rounded-full bg-sunken px-2.5 py-0.5 text-xs font-medium text-muted">
                {formatDuration(form.impersonationMaxDuration)}
              </span>
            </div>
            <p className="mt-1 text-xs text-subtle">Default: 30 minutes. Impersonation tokens expire after this duration.</p>
          </div>
        )}
      </div>

      {/* Risk Thresholds */}
      <div className="space-y-6 border-t border-line pt-6">
        <div>
          <h2 className="text-lg font-semibold text-fg">Risk Thresholds</h2>
          <p className="mt-1 text-sm text-subtle">
            Score boundaries (0–100) that trigger step-up authentication or session block.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted">Step-up threshold</label>
            <input type="number" min={0} max={100} value={form.riskThresholdStepUp}
              onChange={(e) => setForm({ ...form, riskThresholdStepUp: Number(e.target.value) })}
              className="w-40 rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none" />
            <p className="mt-1 text-xs text-subtle">Risk score ≥ this value triggers MFA step-up. Default: 50.</p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted">Block threshold</label>
            <input type="number" min={0} max={100} value={form.riskThresholdBlock}
              onChange={(e) => setForm({ ...form, riskThresholdBlock: Number(e.target.value) })}
              className="w-40 rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none" />
            <p className="mt-1 text-xs text-subtle">Risk score ≥ this value blocks the session entirely. Default: 80.</p>
          </div>
        </div>
      </div>

      {/* Session Limits */}
      <div className="space-y-6 border-t border-line pt-6">
        <div>
          <h2 className="text-lg font-semibold text-fg">Session Limits</h2>
          <p className="mt-1 text-sm text-subtle">
            Limit the number of concurrent active sessions per user.
          </p>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">Max sessions per user</label>
          <input type="number" min={0} value={form.maxSessionsPerUser}
            onChange={(e) => setForm({ ...form, maxSessionsPerUser: Number(e.target.value) })}
            className="w-40 rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none" />
          <p className="mt-1 text-xs text-subtle">
            Maximum concurrent active sessions per user. When the limit is reached the oldest session is evicted.
            Set to 0 for unlimited.
          </p>
        </div>
      </div>

      {/* Adaptive Authentication */}
      <div className="space-y-6 border-t border-line pt-6">
        <div>
          <h2 className="text-lg font-semibold text-fg">Adaptive Authentication</h2>
          <p className="mt-1 text-sm text-subtle">
            Enable AI-powered risk scoring to dynamically adjust authentication requirements.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="adaptiveAuthEnabled"
            checked={form.adaptiveAuthEnabled}
            onChange={(e) => setForm({ ...form, adaptiveAuthEnabled: e.target.checked })}
            className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
          />
          <label htmlFor="adaptiveAuthEnabled" className="text-sm font-medium text-muted">
            Enable adaptive authentication
          </label>
        </div>
        <p className="ml-6 -mt-4 text-xs text-subtle">
          When enabled, each login attempt is scored for risk. High-risk logins trigger step-up MFA or are
          blocked based on the thresholds above.
        </p>
      </div>

      {updateMutation.isSuccess && (
        <div className="rounded-md bg-success-soft p-3 text-sm text-success-fg">
          Security settings updated successfully.
        </div>
      )}
      {updateMutation.isError && (
        <div className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
          Failed to update security settings.
        </div>
      )}

      <div className="flex justify-end border-t border-line pt-4">
        <button
          type="submit"
          disabled={updateMutation.isPending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </form>
  );
}
