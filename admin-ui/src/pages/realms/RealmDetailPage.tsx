import { useState, useEffect, type FormEvent } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRealmByName, updateRealm, deleteRealm, sendTestEmail, exportRealm, getThemes } from '../../api/realms';
import type { ThemeInfo } from '../../api/realms';
import { getUsers } from '../../api/users';
import { getClients } from '../../api/clients';
import { getRealmRoles } from '../../api/roles';
import { getGroups } from '../../api/groups';
import { getClientScopes } from '../../api/clientScopes';
import { getRealmSessions } from '../../api/sessions';
import { getIdentityProviders } from '../../api/identityProviders';
import ConfirmDialog from '../../components/ConfirmDialog';
import PasswordInput from '../../components/PasswordInput';
import MagicLinkSettingsForm from '../../components/magic-link/MagicLinkSettingsForm';

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export default function RealmDetailPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showDelete, setShowDelete] = useState(false);
  const [activeTab, setActiveTab] = useState<'general' | 'tokens' | 'email' | 'security' | 'events' | 'theme' | 'magic-link'>('general');
  const [testEmailTo, setTestEmailTo] = useState('');

  const { data: realm, isLoading } = useQuery({
    queryKey: ['realm', name],
    queryFn: () => getRealmByName(name!),
    enabled: !!name,
  });

  const { data: users } = useQuery({
    queryKey: ['users', name],
    queryFn: () => getUsers(name!),
    enabled: !!name && !!realm,
  });

  const { data: clients } = useQuery({
    queryKey: ['clients', name],
    queryFn: () => getClients(name!),
    enabled: !!name && !!realm,
  });

  const { data: roles } = useQuery({
    queryKey: ['roles', name],
    queryFn: () => getRealmRoles(name!),
    enabled: !!name && !!realm,
  });

  const { data: groups } = useQuery({
    queryKey: ['groups', name],
    queryFn: () => getGroups(name!),
    enabled: !!name && !!realm,
  });

  const { data: clientScopes } = useQuery({
    queryKey: ['clientScopes', name],
    queryFn: () => getClientScopes(name!),
    enabled: !!name && !!realm,
  });

  const { data: sessions } = useQuery({
    queryKey: ['sessions', name],
    queryFn: () => getRealmSessions(name!),
    enabled: !!name && !!realm,
  });

  const { data: identityProviders } = useQuery({
    queryKey: ['identity-providers', name],
    queryFn: () => getIdentityProviders(name!),
    enabled: !!name && !!realm,
  });

  const { data: themes } = useQuery({
    queryKey: ['themes'],
    queryFn: () => getThemes(),
  });

  const [form, setForm] = useState({
    displayName: '',
    enabled: true,
    registrationAllowed: true,
    accessTokenLifespan: 300,
    refreshTokenLifespan: 1800,
    offlineTokenLifespan: 2592000,
    smtpHost: '',
    smtpPort: 587,
    smtpUser: '',
    smtpPassword: '',
    smtpFrom: '',
    smtpSecure: false,
    // Security - Password Policy
    passwordMinLength: 8,
    passwordRequireUppercase: false,
    passwordRequireLowercase: false,
    passwordRequireDigits: false,
    passwordRequireSpecialChars: false,
    passwordHistoryCount: 0,
    passwordMaxAgeDays: 0,
    // Security - Brute Force Protection
    bruteForceEnabled: false,
    maxLoginFailures: 5,
    lockoutDuration: 300,
    failureResetTime: 600,
    permanentLockoutAfter: 0,
    // Security - MFA
    mfaRequired: false,
    // Events
    eventsEnabled: false,
    eventsExpiration: 604800,
    adminEventsEnabled: false,
    // Theme
    themeName: 'idenplane',
    loginTheme: 'idenplane',
    accountTheme: 'idenplane',
    emailTheme: 'idenplane',
  });

  // Seed the editable form from fetched data when the loaded realm changes.
  // Adjusting state during render (vs. an effect) avoids an extra render pass.
  const [seededRealm, setSeededRealm] = useState(realm);
  if (realm && realm !== seededRealm) {
    setSeededRealm(realm);
    setForm({
        displayName: realm.displayName ?? '',
        enabled: realm.enabled,
        registrationAllowed: realm.registrationAllowed ?? true,
        accessTokenLifespan: realm.accessTokenLifespan,
        refreshTokenLifespan: realm.refreshTokenLifespan,
        offlineTokenLifespan: realm.offlineTokenLifespan ?? 2592000,
        smtpHost: realm.smtpHost ?? '',
        smtpPort: realm.smtpPort ?? 587,
        smtpUser: realm.smtpUser ?? '',
        smtpPassword: realm.smtpPassword ?? '',
        smtpFrom: realm.smtpFrom ?? '',
        smtpSecure: realm.smtpSecure ?? false,
        // Security - Password Policy
        passwordMinLength: realm.passwordMinLength ?? 8,
        passwordRequireUppercase: realm.passwordRequireUppercase ?? false,
        passwordRequireLowercase: realm.passwordRequireLowercase ?? false,
        passwordRequireDigits: realm.passwordRequireDigits ?? false,
        passwordRequireSpecialChars: realm.passwordRequireSpecialChars ?? false,
        passwordHistoryCount: realm.passwordHistoryCount ?? 0,
        passwordMaxAgeDays: realm.passwordMaxAgeDays ?? 0,
        // Security - Brute Force Protection
        bruteForceEnabled: realm.bruteForceEnabled ?? false,
        maxLoginFailures: realm.maxLoginFailures ?? 5,
        lockoutDuration: realm.lockoutDuration ?? 300,
        failureResetTime: realm.failureResetTime ?? 600,
        permanentLockoutAfter: realm.permanentLockoutAfter ?? 0,
        // Security - MFA
        mfaRequired: realm.mfaRequired ?? false,
        // Events
        eventsEnabled: realm.eventsEnabled ?? false,
        eventsExpiration: realm.eventsExpiration ?? 604800,
        adminEventsEnabled: realm.adminEventsEnabled ?? false,
        // Theme
        themeName: realm.themeName ?? 'idenplane',
        loginTheme: realm.loginTheme ?? 'idenplane',
        accountTheme: realm.accountTheme ?? 'idenplane',
        emailTheme: realm.emailTheme ?? 'idenplane',
    });
  }

  const updateMutation = useMutation({
    mutationFn: () => updateRealm(name!, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['realm', name] });
      queryClient.invalidateQueries({ queryKey: ['realms'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteRealm(name!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['realms'] });
      navigate('/console/realms');
    },
  });

  const testEmailMutation = useMutation({
    mutationFn: () => sendTestEmail(name!, testEmailTo),
  });

  // Clear toast messages when switching tabs
  useEffect(() => {
    updateMutation.reset();
    testEmailMutation.reset();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    updateMutation.mutate();
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading realm...</div>
      </div>
    );
  }

  if (!realm) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
        Realm not found.
      </div>
    );
  }

  const tabs = [
    { key: 'general' as const, label: 'General' },
    { key: 'tokens' as const, label: 'Tokens' },
    { key: 'email' as const, label: 'Email' },
    { key: 'security' as const, label: 'Security' },
    { key: 'events' as const, label: 'Events' },
    { key: 'theme' as const, label: 'Theme' },
    { key: 'magic-link' as const, label: 'Magic Link' },
  ];

  const quickLinks = [
    { to: `/console/realms/${name}/users`, label: 'Users', count: users?.total },
    { to: `/console/realms/${name}/clients`, label: 'Clients', count: clients?.length },
    { to: `/console/realms/${name}/roles`, label: 'Roles', count: roles?.length },
    { to: `/console/realms/${name}/groups`, label: 'Groups', count: groups?.length },
    { to: `/console/realms/${name}/client-scopes`, label: 'Client Scopes', count: clientScopes?.length },
    { to: `/console/realms/${name}/sessions`, label: 'Sessions', count: sessions?.length },
    { to: `/console/realms/${name}/identity-providers`, label: 'Identity Providers', count: identityProviders?.length },
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{realm.name}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {realm.displayName || 'Realm settings and overview'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={async () => {
              const data = await exportRealm(name!, { includeUsers: true });
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${name}-realm-export.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Export Realm
          </button>
          <button
            onClick={() => setShowDelete(true)}
            className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            Delete Realm
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6 border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`border-b-2 py-3 text-sm font-medium ${
                activeTab === tab.key
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* General Tab */}
      {activeTab === 'general' && (
        <div className="space-y-8">
          {/* Quick links */}
          <div className="grid gap-4 sm:grid-cols-3">
            {quickLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow"
              >
                <div>
                  <p className="text-sm font-medium text-gray-500">{link.label}</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {link.count !== undefined ? link.count : '-'}
                  </p>
                </div>
                <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            ))}
          </div>

          {/* General settings form */}
          <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">General Settings</h2>

            <div>
              <label htmlFor="realm-name" className="mb-1.5 block text-sm font-medium text-gray-700">Name</label>
              <input
                id="realm-name"
                type="text"
                value={realm.name}
                disabled
                className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500"
              />
              <p className="mt-1 text-xs text-gray-400">Realm name cannot be changed</p>
            </div>

            <div>
              <label htmlFor="realm-display-name" className="mb-1.5 block text-sm font-medium text-gray-700">Display Name</label>
              <input
                id="realm-display-name"
                type="text"
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="enabled"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <label htmlFor="enabled" className="text-sm font-medium text-gray-700">
                Enabled
              </label>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="registrationAllowed"
                  checked={form.registrationAllowed}
                  onChange={(e) => setForm({ ...form, registrationAllowed: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="registrationAllowed" className="text-sm font-medium text-gray-700">
                  User Registration
                </label>
              </div>
              <p className="mt-1 ml-6 text-xs text-gray-400">When disabled, users cannot self-register. Only admins can create accounts.</p>
            </div>

            {updateMutation.isSuccess && (
              <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
                Realm updated successfully.
              </div>
            )}
            {updateMutation.isError && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
                Failed to update realm.
              </div>
            )}

            <div className="flex justify-end border-t border-gray-200 pt-4">
              <button
                type="submit"
                disabled={updateMutation.isPending}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tokens Tab */}
      {activeTab === 'tokens' && (
        <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Token Lifespans</h2>
          <p className="text-sm text-gray-500">
            Configure how long access and refresh tokens remain valid.
          </p>

          <div className="space-y-6">
            <div>
              <label htmlFor="access-token-lifespan" className="mb-1.5 block text-sm font-medium text-gray-700">
                Access Token Lifespan
              </label>
              <div className="flex items-center gap-3">
                <input
                  id="access-token-lifespan"
                  type="number"
                  min={1}
                  value={form.accessTokenLifespan}
                  onChange={(e) =>
                    setForm({ ...form, accessTokenLifespan: Number(e.target.value) })
                  }
                  className="w-40 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
                <span className="text-sm text-gray-500">seconds</span>
                <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                  {formatDuration(form.accessTokenLifespan)}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                How long an access token is valid before it must be refreshed.
              </p>
            </div>

            <div>
              <label htmlFor="refresh-token-lifespan" className="mb-1.5 block text-sm font-medium text-gray-700">
                Refresh Token Lifespan
              </label>
              <div className="flex items-center gap-3">
                <input
                  id="refresh-token-lifespan"
                  type="number"
                  min={1}
                  value={form.refreshTokenLifespan}
                  onChange={(e) =>
                    setForm({ ...form, refreshTokenLifespan: Number(e.target.value) })
                  }
                  className="w-40 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
                <span className="text-sm text-gray-500">seconds</span>
                <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                  {formatDuration(form.refreshTokenLifespan)}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                How long a refresh token is valid. This also controls session duration.
              </p>
            </div>

            <div>
              <label htmlFor="offline-token-lifespan" className="mb-1.5 block text-sm font-medium text-gray-700">
                Offline Token Lifespan
              </label>
              <div className="flex items-center gap-3">
                <input
                  id="offline-token-lifespan"
                  type="number"
                  min={60}
                  value={form.offlineTokenLifespan}
                  onChange={(e) =>
                    setForm({ ...form, offlineTokenLifespan: Number(e.target.value) })
                  }
                  className="w-40 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
                <span className="text-sm text-gray-500">seconds</span>
                <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                  {formatDuration(form.offlineTokenLifespan)}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                How long offline refresh tokens are valid. These survive session logout. Default: 30 days.
              </p>
            </div>
          </div>

          {updateMutation.isSuccess && (
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
              Token settings updated successfully.
            </div>
          )}
          {updateMutation.isError && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              Failed to update token settings.
            </div>
          )}

          <div className="flex justify-end border-t border-gray-200 pt-4">
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      )}

      {/* Email Tab */}
      {activeTab === 'email' && (
        <div className="space-y-6">
          <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">SMTP Configuration</h2>
            <p className="text-sm text-gray-500">
              Configure email delivery for this realm. Required for email verification and password reset.
            </p>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="smtp-host" className="mb-1.5 block text-sm font-medium text-gray-700">SMTP Host</label>
                <input
                  id="smtp-host"
                  type="text"
                  value={form.smtpHost}
                  onChange={(e) => setForm({ ...form, smtpHost: e.target.value })}
                  placeholder="smtp.example.com"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="smtp-port" className="mb-1.5 block text-sm font-medium text-gray-700">SMTP Port</label>
                <input
                  id="smtp-port"
                  type="number"
                  value={form.smtpPort}
                  onChange={(e) => setForm({ ...form, smtpPort: Number(e.target.value) })}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="smtp-username" className="mb-1.5 block text-sm font-medium text-gray-700">Username</label>
                <input
                  id="smtp-username"
                  type="text"
                  value={form.smtpUser}
                  onChange={(e) => setForm({ ...form, smtpUser: e.target.value })}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="smtp-password" className="mb-1.5 block text-sm font-medium text-gray-700">Password</label>
                <PasswordInput
                  id="smtp-password"
                  value={form.smtpPassword}
                  onChange={(e) => setForm({ ...form, smtpPassword: e.target.value })}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label htmlFor="smtp-from" className="mb-1.5 block text-sm font-medium text-gray-700">From Address</label>
              <input
                id="smtp-from"
                type="email"
                value={form.smtpFrom}
                onChange={(e) => setForm({ ...form, smtpFrom: e.target.value })}
                placeholder="noreply@example.com"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="smtpSecure"
                checked={form.smtpSecure}
                onChange={(e) => setForm({ ...form, smtpSecure: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <label htmlFor="smtpSecure" className="text-sm font-medium text-gray-700">
                Use SSL/TLS
              </label>
              <span className="text-xs text-gray-400">(Enable for port 465, disable for STARTTLS on port 587)</span>
            </div>

            {updateMutation.isSuccess && (
              <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
                Email settings updated successfully.
              </div>
            )}
            {updateMutation.isError && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
                Failed to update email settings.
              </div>
            )}

            <div className="flex justify-end border-t border-gray-200 pt-4">
              <button
                type="submit"
                disabled={updateMutation.isPending}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>

          {/* Test Email */}
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900">Send Test Email</h3>
            <p className="mt-1 text-xs text-gray-500">
              Save your SMTP settings above first, then send a test email to verify the configuration.
            </p>
            <div className="mt-3 flex items-end gap-3">
              <div className="flex-1">
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Recipient</label>
                <input
                  type="email"
                  value={testEmailTo}
                  onChange={(e) => setTestEmailTo(e.target.value)}
                  placeholder="test@example.com"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => testEmailMutation.mutate()}
                disabled={testEmailMutation.isPending || !testEmailTo}
                className="rounded-md bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
              >
                {testEmailMutation.isPending ? 'Sending...' : 'Send Test'}
              </button>
            </div>
            {testEmailMutation.isSuccess && (
              <div className="mt-3 rounded-md bg-green-50 p-3 text-sm text-green-700">
                Test email sent successfully!
              </div>
            )}
            {testEmailMutation.isError && (
              <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
                Failed to send test email. Check your SMTP settings.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Security Tab */}
      {activeTab === 'security' && (
        <form onSubmit={handleSubmit} className="space-y-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          {/* Password Policy */}
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Password Policy</h2>
              <p className="mt-1 text-sm text-gray-500">
                Define password complexity and rotation requirements for users in this realm.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Minimum Password Length
              </label>
              <input
                type="number"
                min={1}
                value={form.passwordMinLength}
                onChange={(e) =>
                  setForm({ ...form, passwordMinLength: Number(e.target.value) })
                }
                className="w-40 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
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
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="passwordRequireUppercase" className="text-sm font-medium text-gray-700">
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
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="passwordRequireLowercase" className="text-sm font-medium text-gray-700">
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
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="passwordRequireDigits" className="text-sm font-medium text-gray-700">
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
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="passwordRequireSpecialChars" className="text-sm font-medium text-gray-700">
                  Require special characters
                </label>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Password History Count
              </label>
              <input
                type="number"
                min={0}
                value={form.passwordHistoryCount}
                onChange={(e) =>
                  setForm({ ...form, passwordHistoryCount: Number(e.target.value) })
                }
                className="w-40 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
              <p className="mt-1 text-xs text-gray-400">
                Number of previous passwords to remember. Users cannot reuse these.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Password Max Age (days)
              </label>
              <input
                type="number"
                min={0}
                value={form.passwordMaxAgeDays}
                onChange={(e) =>
                  setForm({ ...form, passwordMaxAgeDays: Number(e.target.value) })
                }
                className="w-40 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
              <p className="mt-1 text-xs text-gray-400">
                0 = no expiry. Users will be required to change their password after this many days.
              </p>
            </div>
          </div>

          {/* Brute Force Protection */}
          <div className="space-y-6 border-t border-gray-200 pt-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Brute Force Protection</h2>
              <p className="mt-1 text-sm text-gray-500">
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
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <label htmlFor="bruteForceEnabled" className="text-sm font-medium text-gray-700">
                Enable brute force protection
              </label>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Max Login Failures
              </label>
              <input
                type="number"
                min={1}
                value={form.maxLoginFailures}
                onChange={(e) =>
                  setForm({ ...form, maxLoginFailures: Number(e.target.value) })
                }
                className="w-40 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
              <p className="mt-1 text-xs text-gray-400">
                Number of consecutive login failures before the account is locked.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
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
                  className="w-40 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
                <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                  {formatDuration(form.lockoutDuration)}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                How long an account is locked after exceeding max failures.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
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
                  className="w-40 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
                <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                  {formatDuration(form.failureResetTime)}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                Time after which the failure counter is reset if no new failures occur.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Permanent Lockout After
              </label>
              <input
                type="number"
                min={0}
                value={form.permanentLockoutAfter}
                onChange={(e) =>
                  setForm({ ...form, permanentLockoutAfter: Number(e.target.value) })
                }
                className="w-40 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
              <p className="mt-1 text-xs text-gray-400">
                0 = disabled. Number of temporary lockouts before the account is permanently locked.
              </p>
            </div>
          </div>

          {/* MFA */}
          <div className="space-y-6 border-t border-gray-200 pt-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Multi-Factor Authentication</h2>
              <p className="mt-1 text-sm text-gray-500">
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
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <label htmlFor="mfaRequired" className="text-sm font-medium text-gray-700">
                Require all users to set up TOTP
              </label>
            </div>
          </div>

          {updateMutation.isSuccess && (
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
              Security settings updated successfully.
            </div>
          )}
          {updateMutation.isError && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              Failed to update security settings.
            </div>
          )}

          <div className="flex justify-end border-t border-gray-200 pt-4">
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      )}

      {/* Events Tab */}
      {activeTab === 'events' && (
        <form onSubmit={handleSubmit} className="space-y-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Event Configuration</h2>
            <p className="mt-1 text-sm text-gray-500">
              Control whether login and admin events are recorded for this realm.
            </p>
          </div>

          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="eventsEnabled"
                checked={form.eventsEnabled}
                onChange={(e) => setForm({ ...form, eventsEnabled: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <label htmlFor="eventsEnabled" className="text-sm font-medium text-gray-700">
                Enable login events
              </label>
            </div>
            <p className="ml-6 -mt-4 text-xs text-gray-400">
              Records login, logout, token refresh, and authentication error events.
            </p>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="adminEventsEnabled"
                checked={form.adminEventsEnabled}
                onChange={(e) => setForm({ ...form, adminEventsEnabled: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <label htmlFor="adminEventsEnabled" className="text-sm font-medium text-gray-700">
                Enable admin events
              </label>
            </div>
            <p className="ml-6 -mt-4 text-xs text-gray-400">
              Records create, update, and delete operations performed through the admin API.
            </p>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Events Expiration (seconds)
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={60}
                  value={form.eventsExpiration}
                  onChange={(e) =>
                    setForm({ ...form, eventsExpiration: Number(e.target.value) })
                  }
                  className="w-40 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
                <span className="text-sm text-gray-500">seconds</span>
                <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                  {formatDuration(form.eventsExpiration)}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                How long events are kept before automatic cleanup. Default: 7 days (604800s).
              </p>
            </div>
          </div>

          {updateMutation.isSuccess && (
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
              Event settings updated successfully.
            </div>
          )}
          {updateMutation.isError && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              Failed to update event settings.
            </div>
          )}

          <div className="flex justify-end border-t border-gray-200 pt-4">
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      )}

      {/* Theme Tab */}
      {activeTab === 'theme' && (
        <form onSubmit={handleSubmit} className="space-y-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Theme Settings</h2>
            <p className="mt-1 text-sm text-gray-500">
              Assign themes per page type and customize colors for this realm.
            </p>
          </div>

          {/* Per-Type Theme Selectors */}
          {themes && themes.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Theme Assignment</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Login Theme</label>
                  <select
                    value={form.loginTheme}
                    onChange={(e) => setForm({ ...form, loginTheme: e.target.value, themeName: e.target.value })}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  >
                    {themes.map((t: ThemeInfo) => (
                      <option key={t.name} value={t.name}>{t.displayName}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-400">Applied to login, register, consent, and other auth pages</p>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Account Theme</label>
                  <select
                    value={form.accountTheme}
                    onChange={(e) => setForm({ ...form, accountTheme: e.target.value })}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  >
                    {themes.map((t: ThemeInfo) => (
                      <option key={t.name} value={t.name}>{t.displayName}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-400">Applied to account management and TOTP setup pages</p>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Email Theme</label>
                  <select
                    value={form.emailTheme}
                    onChange={(e) => setForm({ ...form, emailTheme: e.target.value })}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  >
                    {themes.map((t: ThemeInfo) => (
                      <option key={t.name} value={t.name}>{t.displayName}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-400">Applied to verification and password reset emails</p>
                </div>
              </div>
            </div>
          )}

          {updateMutation.isSuccess && (
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
              Theme settings updated successfully.
            </div>
          )}
          {updateMutation.isError && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              Failed to update theme settings.
            </div>
          )}

          <div className="flex justify-end border-t border-gray-200 pt-4">
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      )}

      {/* Magic Link Tab */}
      {activeTab === 'magic-link' && realm && (
        <MagicLinkSettingsForm realm={realm} />
      )}

      <ConfirmDialog
        isOpen={showDelete}
        title="Delete Realm"
        message={`Are you sure you want to delete the realm "${realm.name}"? This action is irreversible and will delete all associated users, clients, and roles.`}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setShowDelete(false)}
      />
    </div>
  );
}
