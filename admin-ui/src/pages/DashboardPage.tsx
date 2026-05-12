import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getAllRealms } from '../api/realms';
import { getLoginEvents, getAdminEvents, type LoginEvent, type AdminEvent } from '../api/events';
import { getRealmStats, getHealthStatus, type RealmStats } from '../api/stats';
import { getErrorMessage } from '../utils/getErrorMessage';

// ─── Stat Card ────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: number | string;
  sublabel?: string;
  colorClass: string;
  icon: React.ReactNode;
}

function StatCard({ label, value, sublabel, colorClass, icon }: StatCardProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg ${colorClass}`}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-500">{label}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          {sublabel && <p className="mt-0.5 text-xs text-gray-400">{sublabel}</p>}
        </div>
      </div>
    </div>
  );
}

// ─── Quick-action Button ──────────────────────────────────────────────────────

interface QuickActionProps {
  label: string;
  description: string;
  onClick: () => void;
  icon: React.ReactNode;
}

function QuickAction({ label, description, onClick, icon }: QuickActionProps) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm transition-all hover:border-indigo-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
    >
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
        {icon}
      </div>
      <div>
        <p className="text-sm font-semibold text-gray-900">{label}</p>
        <p className="text-xs text-gray-500">{description}</p>
      </div>
    </button>
  );
}

// ─── Health Badge ─────────────────────────────────────────────────────────────

function HealthBadge({ status }: { status: string }) {
  const isUp = status === 'ok';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        isUp ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isUp ? 'bg-green-500' : 'bg-red-500'}`} />
      {isUp ? 'Healthy' : 'Degraded'}
    </span>
  );
}

// ─── Event type badge ─────────────────────────────────────────────────────────

const ERROR_SUFFIX = ['_ERROR', '_FAILURE'];

function isErrorType(type: string) {
  return ERROR_SUFFIX.some((s) => type.endsWith(s));
}

function EventTypeBadge({ type }: { type: string }) {
  const isError = isErrorType(type);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        isError ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
      }`}
    >
      {type}
    </span>
  );
}

// ─── Per-realm stats section ──────────────────────────────────────────────────

function RealmStatsSection({ realmName }: { realmName: string }) {
  const navigate = useNavigate();

  const { data: stats, isLoading: statsLoading } = useQuery<RealmStats>({
    queryKey: ['realmStats', realmName],
    queryFn: () => getRealmStats(realmName),
    staleTime: 60_000,
  });

  const { data: loginEvents, isLoading: eventsLoading } = useQuery<LoginEvent[]>({
    queryKey: ['dashboardLoginEvents', realmName],
    queryFn: () => getLoginEvents(realmName, { max: 20 }),
    refetchInterval: 60_000,
    staleTime: 60_000,
  });

  const { data: adminEvents } = useQuery<AdminEvent[]>({
    queryKey: ['dashboardAdminEvents', realmName],
    queryFn: () => getAdminEvents(realmName, { max: 20 }),
    refetchInterval: 60_000,
    staleTime: 60_000,
  });

  const recentEvents = [
    ...(loginEvents ?? []).map((e) => ({
      id: e.id,
      kind: 'login' as const,
      type: e.type,
      detail: e.userId ? `User: ${e.userId}` : e.clientId ? `Client: ${e.clientId}` : '—',
      ip: e.ipAddress,
      error: e.error,
      createdAt: e.createdAt,
    })),
    ...(adminEvents ?? []).map((e) => ({
      id: e.id,
      kind: 'admin' as const,
      type: `${e.operationType} ${e.resourceType}`,
      detail: e.resourcePath,
      ip: e.ipAddress,
      error: null,
      createdAt: e.createdAt,
    })),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 20);

  const totalRate = (stats?.loginSuccessCount ?? 0) + (stats?.loginFailureCount ?? 0);
  const successRate =
    totalRate > 0
      ? Math.round(((stats?.loginSuccessCount ?? 0) / totalRate) * 100)
      : null;

  return (
    <div className="mt-8 space-y-6">
      {/* Stats cards */}
      <div>
        <h2 className="mb-3 text-base font-semibold text-gray-900">
          Stats for{' '}
          <button
            className="text-indigo-600 hover:underline"
            onClick={() => navigate(`/console/realms/${realmName}`)}
          >
            {realmName}
          </button>
        </h2>
        {statsLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-lg border border-gray-200 bg-gray-100" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              label="Active Users (24h)"
              value={stats?.activeUsers24h ?? 0}
              sublabel="Distinct logins in last 24 hours"
              colorClass="bg-indigo-100"
              icon={
                <svg className="h-5 w-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              }
            />
            <StatCard
              label="Active Users (7d)"
              value={stats?.activeUsers7d ?? 0}
              sublabel="Distinct logins in last 7 days"
              colorClass="bg-blue-100"
              icon={
                <svg className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              }
            />
            <StatCard
              label="Active Users (30d)"
              value={stats?.activeUsers30d ?? 0}
              sublabel="Distinct logins in last 30 days"
              colorClass="bg-purple-100"
              icon={
                <svg className="h-5 w-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              }
            />
            <StatCard
              label="Login Successes (24h)"
              value={stats?.loginSuccessCount ?? 0}
              sublabel={successRate !== null ? `${successRate}% success rate` : undefined}
              colorClass="bg-green-100"
              icon={
                <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
            />
            <StatCard
              label="Login Failures (24h)"
              value={stats?.loginFailureCount ?? 0}
              sublabel={successRate !== null ? `${100 - successRate}% failure rate` : undefined}
              colorClass="bg-red-100"
              icon={
                <svg className="h-5 w-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
            />
            <StatCard
              label="Active Sessions"
              value={stats?.activeSessionCount ?? 0}
              sublabel="OAuth + SSO sessions"
              colorClass="bg-yellow-100"
              icon={
                <svg className="h-5 w-5 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              }
            />
          </div>
        )}
      </div>

      {/* Recent events feed */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Recent Events</h2>
          <span className="text-xs text-gray-400" aria-live="polite" aria-atomic="true">Auto-refreshes every 30s</span>
        </div>
        {eventsLoading ? (
          <div className="h-40 animate-pulse rounded-lg border border-gray-200 bg-gray-100" />
        ) : recentEvents.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
            No events yet. Enable events in realm settings to start collecting them.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm" aria-label="Recent events">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Time</th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Type</th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Detail</th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {recentEvents.map((ev) => (
                    <tr key={`${ev.kind}-${ev.id}`} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-2.5 text-gray-500">
                        {new Date(ev.createdAt).toLocaleString()}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5">
                        <EventTypeBadge type={ev.type} />
                      </td>
                      <td className="max-w-xs truncate px-4 py-2.5 text-gray-700">{ev.detail}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-gray-500">
                        {ev.ip ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-gray-200 px-4 py-2 text-xs text-gray-400">
              Showing last {recentEvents.length} events
            </div>
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div>
        <h2 className="mb-3 text-base font-semibold text-gray-900">Quick Actions</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <QuickAction
            label="Create User"
            description={`Add a new user to ${realmName}`}
            onClick={() => navigate(`/console/realms/${realmName}/users/create`)}
            icon={
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
            }
          />
          <QuickAction
            label="Create Client"
            description={`Register a new application in ${realmName}`}
            onClick={() => navigate(`/console/realms/${realmName}/clients/new`)}
            icon={
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
              </svg>
            }
          />
          <QuickAction
            label="View Logs"
            description="Browse login and admin events"
            onClick={() => navigate(`/console/realms/${realmName}/events`)}
            icon={
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            }
          />
        </div>
      </div>
    </div>
  );
}

// ─── Main Dashboard Page ──────────────────────────────────────────────────────

export default function DashboardPage() {
  const navigate = useNavigate();

  const { data: realms, isLoading: realmsLoading } = useQuery({
    queryKey: ['realms'],
    queryFn: getAllRealms,
  });

  const { data: health, error: healthError } = useQuery({
    queryKey: ['health'],
    queryFn: getHealthStatus,
    refetchInterval: 120_000,
    staleTime: 60_000,
    retry: false,
  });

  const enabledCount = realms?.filter((r) => r.enabled).length ?? 0;
  const disabledCount = (realms?.length ?? 0) - enabledCount;

  // Show per-realm stats for the first realm (if any)
  const firstRealm = realms?.[0]?.name;

  if (realmsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">Overview of your Authme identity server</p>
        </div>

        {/* System health */}
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 shadow-sm">
          <span className="text-sm font-medium text-gray-700">System</span>
          {healthError ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-600">
              {getErrorMessage(healthError, 'Health check failed')}
            </span>
          ) : health ? (
            <HealthBadge status={health.status} />
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">
              Checking...
            </span>
          )}
        </div>
      </div>

      {/* Top stats row — realm summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Total Realms"
          value={realms?.length ?? 0}
          colorClass="bg-indigo-100"
          icon={
            <svg className="h-5 w-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
            </svg>
          }
        />
        <StatCard
          label="Enabled Realms"
          value={enabledCount}
          colorClass="bg-green-100"
          icon={
            <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          label="Disabled Realms"
          value={disabledCount}
          colorClass="bg-gray-100"
          icon={
            <svg className="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          }
        />
      </div>

      {/* Per-realm section — shown when at least one realm exists */}
      {firstRealm && <RealmStatsSection realmName={firstRealm} />}

      {/* Realm quick-access list */}
      <div className="mt-8">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">All Realms</h2>
        {realms && realms.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {realms.map((realm) => (
              <button
                key={realm.id}
                onClick={() => navigate(`/console/realms/${realm.name}`)}
                className="rounded-lg border border-gray-200 bg-white p-5 text-left shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900">
                    {realm.displayName || realm.name}
                  </h3>
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      realm.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {realm.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <p className="mt-1 text-sm text-gray-500">{realm.name}</p>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
            <p className="text-gray-500">No realms yet.</p>
            <button
              onClick={() => navigate('/console/realms/create')}
              className="mt-3 text-sm font-medium text-indigo-600 hover:text-indigo-500"
            >
              Create your first realm
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
