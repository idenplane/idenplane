import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  getContinuousRiskDashboard,
  listSessionProfiles,
  type ContinuousRiskDashboard as DashboardData,
  type SessionRiskProfile,
} from '../../api/continuousVerification';

function formatDate(date: string) {
  return new Date(date).toLocaleString();
}

function formatNumber(n: number) {
  return n.toFixed(1);
}

// ─── Risk Level Badge ─────────────────────────────────────────────────────────

function RiskLevelBadge({ level }: { level: string }) {
  const config: Record<string, { bg: string; text: string }> = {
    LOW: { bg: 'bg-green-100', text: 'text-green-700' },
    MEDIUM: { bg: 'bg-yellow-100', text: 'text-yellow-700' },
    HIGH: { bg: 'bg-orange-100', text: 'text-orange-700' },
    CRITICAL: { bg: 'bg-red-100', text: 'text-red-700' },
  };
  const c = config[level] ?? { bg: 'bg-gray-100', text: 'text-gray-700' };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${c.bg} ${c.text}`}>
      {level}
    </span>
  );
}

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

// ─── Distribution Bar ─────────────────────────────────────────────────────────

interface DistributionBarProps {
  distribution: { LOW: number; MEDIUM: number; HIGH: number; CRITICAL: number };
  total: number;
}

function DistributionBar({ distribution, total }: DistributionBarProps) {
  const levels: Array<{ key: keyof typeof distribution; label: string; color: string }> = [
    { key: 'LOW', label: 'Low', color: 'bg-green-500' },
    { key: 'MEDIUM', label: 'Medium', color: 'bg-yellow-500' },
    { key: 'HIGH', label: 'High', color: 'bg-orange-500' },
    { key: 'CRITICAL', label: 'Critical', color: 'bg-red-500' },
  ];

  if (total === 0) {
    return (
      <div className="flex h-6 w-full items-center rounded-full bg-gray-100 text-xs text-gray-400">
        No active sessions
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex h-6 w-full overflow-hidden rounded-full">
        {levels.map(({ key, color }) => {
          const count = distribution[key];
          const pct = (count / total) * 100;
          return (
            <div
              key={key}
              className={color}
              style={{ width: `${pct}%` }}
              title={`${key}: ${count} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-xs">
        {levels.map(({ key, label }) => {
          const count = distribution[key];
          const pct = total > 0 ? ((count / total) * 100).toFixed(0) : '0';
          return (
            <div key={key} className="flex items-center gap-1">
              <span className="font-medium text-gray-700">{count}</span>
              <span className="text-gray-400">{label} ({pct}%)</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Trend Row ────────────────────────────────────────────────────────────────

function TrendRow({ trend }: { trend: { date: string; total: number; stepUp: number; terminate: number } }) {
  return (
    <div className="flex items-center justify-between border-b border-gray-100 py-2 text-sm">
      <span className="text-gray-500">{new Date(trend.date).toLocaleDateString()}</span>
      <div className="flex items-center gap-4">
        <span className="text-gray-700">{trend.total} events</span>
        {trend.stepUp > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
            {trend.stepUp} step-up
          </span>
        )}
        {trend.terminate > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
            {trend.terminate} terminated
          </span>
        )}
      </div>
    </div>
  );
}

// ─── High Risk Session Row ────────────────────────────────────────────────────

function HighRiskRow({ profile, realmName }: { profile: SessionRiskProfile; realmName: string }) {
  return (
    <tr className="hover:bg-gray-50">
      <td className="whitespace-nowrap px-4 py-3 text-sm">
        <Link
          to={`/console/realms/${realmName}/users/${profile.userId}`}
          className="font-medium text-indigo-600 hover:text-indigo-900"
        >
          {profile.userId}
        </Link>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">{profile.sessionId.slice(0, 8)}...</td>
      <td className="whitespace-nowrap px-4 py-3 text-sm">
        <RiskLevelBadge level={profile.riskLevel} />
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-sm">
        <span className={profile.riskScore >= 70 ? 'font-bold text-red-600' : 'text-gray-700'}>
          {profile.riskScore.toFixed(0)}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-sm">
        <span className={profile.trustScore <= 30 ? 'font-bold text-red-600' : 'text-gray-700'}>
          {profile.trustScore.toFixed(0)}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-sm">
        {profile.stepUpRequired ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
            Step-up
          </span>
        ) : profile.terminateSession ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
            Terminate
          </span>
        ) : (
          <span className="text-gray-400">OK</span>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
        {formatDate(profile.lastEvaluatedAt)}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right">
        <Link
          to={`/console/realms/${realmName}/continuous-verification/session/${profile.sessionId}`}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-900"
        >
          Details
        </Link>
      </td>
    </tr>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ContinuousRiskDashboard() {
  const { name: realmName } = useParams<{ name: string }>();

  const { data: dashboard, isLoading: dashboardLoading } = useQuery<DashboardData>({
    queryKey: ['continuousRiskDashboard', realmName],
    queryFn: () => getContinuousRiskDashboard(realmName!),
    enabled: !!realmName,
    refetchInterval: 60_000,
  });

  const { data: profiles, isLoading: profilesLoading } = useQuery({
    queryKey: ['sessionRiskProfiles', realmName],
    queryFn: () => listSessionProfiles(realmName!, { max: 10 }),
    enabled: !!realmName,
    refetchInterval: 60_000,
  });

  const highRiskProfiles = profiles?.items.filter(
    (p) => p.riskLevel === 'HIGH' || p.riskLevel === 'CRITICAL' || p.stepUpRequired,
  );

  const totalDistribution = dashboard
    ? dashboard.distribution.LOW +
      dashboard.distribution.MEDIUM +
      dashboard.distribution.HIGH +
      dashboard.distribution.CRITICAL
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Continuous Risk Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">
            Real-time session risk monitoring for <span className="font-medium">{realmName}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to={`/console/realms/${realmName}/continuous-verification/policies`}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Risk Policies
          </Link>
        </div>
      </div>

      {/* Loading state */}
      {dashboardLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-gray-500">Loading risk dashboard...</div>
        </div>
      )}

      {/* Stats grid */}
      {!dashboardLoading && dashboard && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Active Sessions"
              value={dashboard.activeSessions}
              sublabel={`Evaluated ${dashboard.totalEvaluations} times`}
              colorClass="bg-indigo-100"
              icon={
                <svg className="h-5 w-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              }
            />
            <StatCard
              label="Step-up Triggered"
              value={dashboard.stepUpTriggered}
              sublabel="Sessions requiring re-auth"
              colorClass="bg-orange-100"
              icon={
                <svg className="h-5 w-5 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              }
            />
            <StatCard
              label="Sessions Terminated"
              value={dashboard.sessionsTerminated}
              sublabel="Automatically revoked"
              colorClass="bg-red-100"
              icon={
                <svg className="h-5 w-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
              }
            />
            <StatCard
              label="Avg Risk Score"
              value={formatNumber(dashboard.avgRiskScore)}
              sublabel={`Avg trust: ${formatNumber(dashboard.avgTrustScore)}`}
              colorClass="bg-purple-100"
              icon={
                <svg className="h-5 w-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              }
            />
          </div>

          {/* Risk Distribution */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-base font-semibold text-gray-900">Risk Distribution</h2>
              <DistributionBar distribution={dashboard.distribution} total={totalDistribution} />
              <p className="mt-2 text-xs text-gray-400">
                Period: {new Date(dashboard.period.from).toLocaleDateString()} — {new Date(dashboard.period.to).toLocaleDateString()}
              </p>
            </div>

            {/* Trend */}
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="mb-3 text-base font-semibold text-gray-900">Daily Trend</h2>
              {dashboard.trend.length > 0 ? (
                <div className="space-y-0">
                  {dashboard.trend.slice(-7).map((t) => (
                    <TrendRow key={t.date} trend={t} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No trend data available yet.</p>
              )}
            </div>
          </div>

          {/* High Risk Sessions */}
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-6 py-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-900">High Risk Sessions</h2>
                <span className="text-sm text-gray-500">
                  {highRiskProfiles?.length ?? 0} requiring attention
                </span>
              </div>
            </div>

            {profilesLoading ? (
              <div className="px-6 py-8 text-center text-sm text-gray-500">Loading session profiles...</div>
            ) : !highRiskProfiles || highRiskProfiles.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-gray-500">
                No high-risk sessions at this time.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        User
                      </th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Session
                      </th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Risk Level
                      </th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Risk Score
                      </th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Trust Score
                      </th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Status
                      </th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Last Evaluated
                      </th>
                      <th scope="col" className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {highRiskProfiles.map((profile) => (
                      <HighRiskRow key={profile.id} profile={profile} realmName={realmName!} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="border-t border-gray-200 px-6 py-3 text-xs text-gray-400">
              Auto-refreshes every 60 seconds
            </div>
          </div>
        </>
      )}
    </div>
  );
}