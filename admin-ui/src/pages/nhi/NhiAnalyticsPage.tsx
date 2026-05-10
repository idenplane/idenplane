import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getNhiIdentities, getRotationStatusSummary, queryNhiAuditLogs } from '../../api/nhi';
import type { NhiIdentityType, NhiLifecycleStatus } from '../../types';

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

// ─── Type Distribution Bar ────────────────────────────────────────────────────

interface TypeDistributionProps {
  identities: Array<{ identityType: NhiIdentityType; name: string }>;
}

function TypeDistribution({ identities }: TypeDistributionProps) {
  const counts: Record<NhiIdentityType, number> = {
    IOT_DEVICE: 0,
    AI_AGENT: 0,
    BOT: 0,
    MACHINE_TO_MACHINE: 0,
  };

  identities.forEach((id) => {
    counts[id.identityType]++;
  });

  const total = identities.length || 1;
  const typeColors: Record<NhiIdentityType, string> = {
    IOT_DEVICE: 'bg-blue-500',
    AI_AGENT: 'bg-purple-500',
    BOT: 'bg-amber-500',
    MACHINE_TO_MACHINE: 'bg-green-500',
  };

  const typeLabels: Record<NhiIdentityType, string> = {
    IOT_DEVICE: 'IoT Device',
    AI_AGENT: 'AI Agent',
    BOT: 'Bot',
    MACHINE_TO_MACHINE: 'M2M',
  };

  return (
    <div className="space-y-3">
      {(Object.keys(counts) as NhiIdentityType[]).map((type) => {
        const percentage = Math.round((counts[type] / total) * 100);
        return (
          <div key={type}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="font-medium text-gray-700">{typeLabels[type]}</span>
              <span className="text-gray-500">{counts[type]} ({percentage}%)</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className={`h-full ${typeColors[type]}`}
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Status Distribution ─────────────────────────────────────────────────────

interface StatusDistributionProps {
  identities: Array<{ lifecycleStatus: NhiLifecycleStatus }>;
}

function StatusDistribution({ identities }: StatusDistributionProps) {
  const counts: Record<NhiLifecycleStatus, number> = {
    PROVISIONING: 0,
    ACTIVE: 0,
    SUSPENDED: 0,
    DECOMMISSIONED: 0,
  };

  identities.forEach((id) => {
    counts[id.lifecycleStatus]++;
  });

  const statusColors: Record<NhiLifecycleStatus, string> = {
    PROVISIONING: 'bg-yellow-100 text-yellow-700',
    ACTIVE: 'bg-green-100 text-green-700',
    SUSPENDED: 'bg-orange-100 text-orange-700',
    DECOMMISSIONED: 'bg-gray-100 text-gray-700',
  };

  return (
    <div className="flex flex-wrap gap-3">
      {(Object.keys(counts) as NhiLifecycleStatus[]).map((status) => (
        <span
          key={status}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${statusColors[status]}`}
        >
          <span className="h-2 w-2 rounded-full bg-current" />
          {status}: {counts[status]}
        </span>
      ))}
    </div>
  );
}

// ─── Simple Bar Chart ─────────────────────────────────────────────────────────

interface BarChartProps {
  data: Array<{ label: string; value: number; color: string }>;
  maxValue?: number;
}

function BarChart({ data, maxValue }: BarChartProps) {
  const max = maxValue ?? Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="space-y-2">
      {data.map((item) => (
        <div key={item.label} className="flex items-center gap-3">
          <span className="w-32 truncate text-sm text-gray-600">{item.label}</span>
          <div className="flex-1">
            <div className="h-6 overflow-hidden rounded-full bg-gray-100">
              <div
                className={`h-full ${item.color}`}
                style={{ width: `${Math.round((item.value / max) * 100)}%` }}
              />
            </div>
          </div>
          <span className="w-16 text-right text-sm font-medium text-gray-900">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Rotation Status Card ─────────────────────────────────────────────────────

interface RotationStatusCardProps {
  total: number;
  requiring: number;
  recentlyRotated: number;
  atRisk: number;
}

function RotationStatusCard({ total, requiring, recentlyRotated, atRisk }: RotationStatusCardProps) {
  const items = [
    { label: 'Total Credentials', value: total, color: 'bg-gray-500' },
    { label: 'Requiring Rotation', value: requiring, color: 'bg-amber-500' },
    { label: 'Recently Rotated', value: recentlyRotated, color: 'bg-blue-500' },
    { label: 'At Risk', value: atRisk, color: 'bg-red-500' },
  ];

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.label} className="flex items-center justify-between">
          <span className="text-sm text-gray-600">{item.label}</span>
          <div className="flex items-center gap-2">
            <div className="h-2 w-20 overflow-hidden rounded-full bg-gray-100">
              <div
                className={`h-full ${item.color}`}
                style={{ width: `${total > 0 ? Math.round((item.value / total) * 100) : 0}%` }}
              />
            </div>
            <span className="w-12 text-right text-sm font-semibold text-gray-900">{item.value}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Recent Activity Feed ────────────────────────────────────────────────────

interface ActivityItem {
  id: string;
  action: string;
  nhiIdentityId: string;
  success: boolean;
  ipAddress: string | null;
  createdAt: string;
}

interface ActivityFeedProps {
  activities: ActivityItem[];
}

function ActivityFeed({ activities }: ActivityFeedProps) {
  if (activities.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-gray-500">No recent activity</p>
    );
  }

  return (
    <div className="divide-y divide-gray-100">
      {activities.slice(0, 20).map((activity) => (
        <div key={activity.id} className="flex items-start gap-3 py-3">
          <span
            className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${
              activity.success ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-900">{activity.action}</p>
            <p className="text-xs text-gray-500">
              {activity.ipAddress ?? '—'} · {new Date(activity.createdAt).toLocaleString()}
            </p>
          </div>
          <span
            className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
              activity.success
                ? 'bg-green-100 text-green-700'
                : 'bg-red-100 text-red-700'
            }`}
          >
            {activity.success ? 'Success' : 'Failed'}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Main Page Component ──────────────────────────────────────────────────────

export default function NhiAnalyticsPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();

  const [activityFilter, setActivityFilter] = useState<'all' | 'success' | 'failure'>('all');

  const { data: identities, isLoading: identitiesLoading } = useQuery({
    queryKey: ['nhi-identities', name],
    queryFn: () => getNhiIdentities(name!),
    enabled: !!name,
  });

  const { data: rotationStatus, isLoading: rotationLoading } = useQuery({
    queryKey: ['nhi-rotation-status', name],
    queryFn: () => getRotationStatusSummary(name!),
    enabled: !!name,
    retry: false,
  });

  const { data: auditLogs, isLoading: auditLoading } = useQuery({
    queryKey: ['nhi-audit-logs', name, activityFilter],
    queryFn: () =>
      queryNhiAuditLogs(name!, {
        max: 50,
        success: activityFilter === 'success' ? true : activityFilter === 'failure' ? false : undefined,
      }),
    enabled: !!name,
    refetchInterval: 60_000,
  });

  if (identitiesLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading analytics...</div>
      </div>
    );
  }

  const totalIdentities = identities?.length ?? 0;

  const activeCount = identities?.filter((id) => id.lifecycleStatus === 'ACTIVE').length ?? 0;
  const suspendedCount = identities?.filter((id) => id.lifecycleStatus === 'SUSPENDED').length ?? 0;
  const decommissionedCount = identities?.filter((id) => id.lifecycleStatus === 'DECOMMISSIONED').length ?? 0;

  const withCertificate = identities?.filter((id) => id.certificateFingerprint).length ?? 0;
  const enabledCount = identities?.filter((id) => id.enabled).length ?? 0;

  // Group by identity type for chart
  const typeCounts: Record<NhiIdentityType, number> = {
    IOT_DEVICE: 0,
    AI_AGENT: 0,
    BOT: 0,
    MACHINE_TO_MACHINE: 0,
  };
  identities?.forEach((id) => {
    typeCounts[id.identityType]++;
  });

  const typeChartData = (Object.keys(typeCounts) as NhiIdentityType[]).map((type) => ({
    label: type.replace(/_/g, ' ').replace('MACHINE TO MACHINE', 'M2M'),
    value: typeCounts[type],
    color:
      type === 'IOT_DEVICE'
        ? 'bg-blue-500'
        : type === 'AI_AGENT'
        ? 'bg-purple-500'
        : type === 'BOT'
        ? 'bg-amber-500'
        : 'bg-green-500',
  }));

  // Filter audit logs
  const filteredLogs = auditLogs ?? [];
  const successCount = filteredLogs.filter((log) => log.success).length;
  const failureCount = filteredLogs.length - successCount;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">NHI Analytics</h1>
          <p className="mt-1 text-sm text-gray-500">
            Usage metrics for non-human identities in <span className="font-medium">{name}</span>
          </p>
        </div>
        <button
          onClick={() => navigate(`/console/realms/${name}/nhi`)}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          View All Identities
        </button>
      </div>

      {/* Overview Stats */}
      <div>
        <h2 className="mb-3 text-base font-semibold text-gray-900">Overview</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total Identities"
            value={totalIdentities}
            colorClass="bg-indigo-100"
            icon={
              <svg className="h-5 w-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
              </svg>
            }
          />
          <StatCard
            label="Active Identities"
            value={activeCount}
            sublabel={`${suspendedCount} suspended, ${decommissionedCount} decommissioned`}
            colorClass="bg-green-100"
            icon={
              <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
          <StatCard
            label="With Certificates"
            value={withCertificate}
            sublabel={`${totalIdentities > 0 ? Math.round((withCertificate / totalIdentities) * 100) : 0}% of total`}
            colorClass="bg-emerald-100"
            icon={
              <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            }
          />
          <StatCard
            label="Enabled"
            value={enabledCount}
            sublabel={`${totalIdentities > 0 ? Math.round((enabledCount / totalIdentities) * 100) : 0}% enabled rate`}
            colorClass="bg-blue-100"
            icon={
              <svg className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
              </svg>
            }
          />
        </div>
      </div>

      {/* Two column layout for charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Identity Type Distribution */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Identity Type Distribution</h2>
          {totalIdentities > 0 ? (
            <TypeDistribution identities={identities ?? []} />
          ) : (
            <p className="py-6 text-center text-sm text-gray-500">No identities to display</p>
          )}
        </div>

        {/* Rotation Status */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Credential Rotation Status</h2>
          {rotationLoading ? (
            <div className="h-24 animate-pulse rounded-lg bg-gray-100" />
          ) : rotationStatus ? (
            <RotationStatusCard
              total={rotationStatus.totalCredentials}
              requiring={rotationStatus.requiringRotation}
              recentlyRotated={rotationStatus.recentlyRotated}
              atRisk={rotationStatus.credentialsAtRisk}
            />
          ) : (
            <p className="py-6 text-center text-sm text-gray-500">Rotation data unavailable</p>
          )}
        </div>
      </div>

      {/* Identity Type Breakdown Chart */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-gray-900">Identities by Type</h2>
        {totalIdentities > 0 ? (
          <BarChart data={typeChartData} />
        ) : (
          <p className="py-6 text-center text-sm text-gray-500">No identities to display</p>
        )}
      </div>

      {/* Activity Summary */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Recent Activity</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActivityFilter('all')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                activityFilter === 'all'
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setActivityFilter('success')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                activityFilter === 'success'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Success
            </button>
            <button
              onClick={() => setActivityFilter('failure')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                activityFilter === 'failure'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Failed
            </button>
          </div>
        </div>

        {/* Activity Stats */}
        <div className="mb-4 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-green-500" />
            <span className="text-sm text-gray-600">Success: {successCount}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-red-500" />
            <span className="text-sm text-gray-600">Failed: {failureCount}</span>
          </div>
          {filteredLogs.length > 0 && (
            <span className="text-sm text-gray-400">
              ({Math.round((successCount / filteredLogs.length) * 100)}% success rate)
            </span>
          )}
        </div>

        {auditLoading ? (
          <div className="h-40 animate-pulse rounded-lg bg-gray-100" />
        ) : (
          <ActivityFeed activities={filteredLogs} />
        )}
      </div>

      {/* Status Distribution */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-gray-900">Lifecycle Status Distribution</h2>
        {totalIdentities > 0 ? (
          <StatusDistribution identities={identities ?? []} />
        ) : (
          <p className="py-6 text-center text-sm text-gray-500">No identities to display</p>
        )}
      </div>
    </div>
  );
}