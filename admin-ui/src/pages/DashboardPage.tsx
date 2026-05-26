import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getAllRealms } from '../api/realms';
import { getLoginEvents, getAdminEvents, type LoginEvent, type AdminEvent } from '../api/events';
import { getRealmStats, getHealthStatus, type RealmStats } from '../api/stats';
import { getErrorMessage } from '../utils/getErrorMessage';
import { Card, Badge, Icons } from '../components/ui';

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
    <Card padding="sm">
      <div className="flex items-start gap-4">
        <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg ${colorClass}`}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-medium text-muted">{label}</p>
          <p className="text-[26px] font-bold leading-tight tracking-[-0.02em] text-fg">{value}</p>
          {sublabel && <p className="mt-0.5 text-xs text-subtle">{sublabel}</p>}
        </div>
      </div>
    </Card>
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
      className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface p-4 text-left shadow-soft transition-all duration-150 hover:-translate-y-px hover:border-accent/40 hover:shadow-lift focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
    >
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
        {icon}
      </div>
      <div>
        <p className="text-sm font-semibold text-fg">{label}</p>
        <p className="text-xs text-muted">{description}</p>
      </div>
    </button>
  );
}

// ─── Health Badge ─────────────────────────────────────────────────────────────

function HealthBadge({ status }: { status: string }) {
  const isUp = status === 'ok';
  return (
    <Badge variant={isUp ? 'success' : 'danger'} dot>
      {isUp ? 'Healthy' : 'Degraded'}
    </Badge>
  );
}

// ─── Event type badge ─────────────────────────────────────────────────────────

const ERROR_SUFFIX = ['_ERROR', '_FAILURE'];

function isErrorType(type: string) {
  return ERROR_SUFFIX.some((s) => type.endsWith(s));
}

function EventTypeBadge({ type }: { type: string }) {
  return (
    <Badge variant={isErrorType(type) ? 'danger' : 'success'} mono>
      {type}
    </Badge>
  );
}

// ─── Per-realm stats section ──────────────────────────────────────────────────

function RealmStatsSection({ realmName }: { realmName: string }) {
  const navigate = useNavigate();

  const { data: stats, error: statsError, isLoading: statsLoading } = useQuery<RealmStats>({
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
        <h2 className="mb-3 text-base font-semibold text-fg">
          Stats for{' '}
          <button className="text-accent hover:underline" onClick={() => navigate(`/console/realms/${realmName}`)}>
            {realmName}
          </button>
        </h2>
        {statsLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl border border-line bg-sunken" />
            ))}
          </div>
        ) : statsError ? (
          <div className="rounded-xl border border-danger-soft bg-danger-soft p-4 text-sm text-danger-fg">
            Failed to load stats. Please try again.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              label="Active Users (24h)"
              value={stats?.activeUsers24h ?? 0}
              sublabel="Distinct logins in last 24 hours"
              colorClass="bg-indigo-100"
              icon={<Icons.Users className="h-5 w-5 text-indigo-600" />}
            />
            <StatCard
              label="Active Users (7d)"
              value={stats?.activeUsers7d ?? 0}
              sublabel="Distinct logins in last 7 days"
              colorClass="bg-blue-100"
              icon={<Icons.Groups className="h-5 w-5 text-blue-600" />}
            />
            <StatCard
              label="Active Users (30d)"
              value={stats?.activeUsers30d ?? 0}
              sublabel="Distinct logins in last 30 days"
              colorClass="bg-purple-100"
              icon={<Icons.Activity className="h-5 w-5 text-purple-600" />}
            />
            <StatCard
              label="Login Successes (24h)"
              value={stats?.loginSuccessCount ?? 0}
              sublabel={successRate !== null ? `${successRate}% success rate` : undefined}
              colorClass="bg-green-100"
              icon={<Icons.CheckCircle className="h-5 w-5 text-green-600" />}
            />
            <StatCard
              label="Login Failures (24h)"
              value={stats?.loginFailureCount ?? 0}
              sublabel={successRate !== null ? `${100 - successRate}% failure rate` : undefined}
              colorClass="bg-red-100"
              icon={<Icons.XCircle className="h-5 w-5 text-red-600" />}
            />
            <StatCard
              label="Active Sessions"
              value={stats?.activeSessionCount ?? 0}
              sublabel="OAuth + SSO sessions"
              colorClass="bg-yellow-100"
              icon={<Icons.Sessions className="h-5 w-5 text-yellow-600" />}
            />
          </div>
        )}
      </div>

      {/* Recent events feed */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-fg">Recent Events</h2>
          <span className="text-xs text-subtle" aria-live="polite" aria-atomic="true">
            Auto-refreshes every 30s
          </span>
        </div>
        {eventsLoading ? (
          <div className="h-40 animate-pulse rounded-xl border border-line bg-sunken" />
        ) : recentEvents.length === 0 ? (
          <Card className="text-center text-sm text-muted">
            No events yet. Enable events in realm settings to start collecting them.
          </Card>
        ) : (
          <Card padding="none" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm" aria-label="Recent events">
                <thead>
                  <tr className="border-b border-line bg-sunken">
                    <th scope="col" className="px-4 py-3 text-left font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-subtle">Time</th>
                    <th scope="col" className="px-4 py-3 text-left font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-subtle">Type</th>
                    <th scope="col" className="px-4 py-3 text-left font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-subtle">Detail</th>
                    <th scope="col" className="px-4 py-3 text-left font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-subtle">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {recentEvents.map((ev, i) => (
                    <tr
                      key={`${ev.kind}-${ev.id}`}
                      className={`hover:bg-hover ${i === recentEvents.length - 1 ? '' : 'border-b border-divider'}`}
                    >
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11.5px] text-muted">
                        {new Date(ev.createdAt).toLocaleString()}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5">
                        <EventTypeBadge type={ev.type} />
                      </td>
                      <td className="max-w-xs truncate px-4 py-2.5 text-fg">{ev.detail}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11.5px] text-subtle">{ev.ip ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-line px-4 py-2 text-xs text-subtle">
              Showing last {recentEvents.length} events
            </div>
          </Card>
        )}
      </div>

      {/* Quick actions */}
      <div>
        <h2 className="mb-3 text-base font-semibold text-fg">Quick Actions</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <QuickAction
            label="Create User"
            description={`Add a new user to ${realmName}`}
            onClick={() => navigate(`/console/realms/${realmName}/users/create`)}
            icon={<Icons.User className="h-5 w-5" />}
          />
          <QuickAction
            label="Create Client"
            description={`Register a new application in ${realmName}`}
            onClick={() => navigate(`/console/realms/${realmName}/clients/new`)}
            icon={<Icons.Clients className="h-5 w-5" />}
          />
          <QuickAction
            label="View Logs"
            description="Browse login and admin events"
            onClick={() => navigate(`/console/realms/${realmName}/events`)}
            icon={<Icons.Events className="h-5 w-5" />}
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
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-fg">Dashboard</h1>
          <p className="mt-1 text-sm text-muted">Overview of your Idenplane identity server</p>
        </div>

        {/* System health */}
        <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 shadow-soft">
          <span className="text-sm font-medium text-fg">System</span>
          {healthError ? (
            <Badge variant="danger">{getErrorMessage(healthError, 'Health check failed')}</Badge>
          ) : health ? (
            <HealthBadge status={health.status} />
          ) : (
            <Badge variant="neutral">Checking...</Badge>
          )}
        </div>
      </div>

      {/* Top stats row — realm summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Total Realms"
          value={realms?.length ?? 0}
          colorClass="bg-indigo-100"
          icon={<Icons.Realms className="h-5 w-5 text-indigo-600" />}
        />
        <StatCard
          label="Enabled Realms"
          value={enabledCount}
          colorClass="bg-green-100"
          icon={<Icons.CheckCircle className="h-5 w-5 text-green-600" />}
        />
        <StatCard
          label="Disabled Realms"
          value={disabledCount}
          colorClass="bg-gray-100"
          icon={<Icons.XCircle className="h-5 w-5 text-gray-600" />}
        />
      </div>

      {/* Per-realm section — shown when at least one realm exists */}
      {firstRealm && <RealmStatsSection realmName={firstRealm} />}

      {/* Realm quick-access list */}
      <div className="mt-8">
        <h2 className="mb-4 text-lg font-semibold text-fg">All Realms</h2>
        {realms && realms.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {realms.map((realm) => (
              <button
                key={realm.id}
                onClick={() => navigate(`/console/realms/${realm.name}`)}
                className="rounded-xl border border-line bg-surface p-5 text-left shadow-soft transition-all duration-150 hover:-translate-y-px hover:shadow-lift focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-fg">{realm.displayName || realm.name}</h3>
                  <Badge variant={realm.enabled ? 'success' : 'neutral'}>
                    {realm.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </div>
                <p className="mt-1 font-mono text-sm text-muted">{realm.name}</p>
              </button>
            ))}
          </div>
        ) : (
          <Card className="text-center">
            <p className="text-muted">No realms yet.</p>
            <button
              onClick={() => navigate('/console/realms/create')}
              className="mt-3 text-sm font-medium text-accent hover:text-accent-hover"
            >
              Create your first realm
            </button>
          </Card>
        )}
      </div>
    </div>
  );
}
