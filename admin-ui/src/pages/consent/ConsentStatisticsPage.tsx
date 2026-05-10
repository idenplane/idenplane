import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import {
  getConsentStatistics,
  type ConsentStatistics,
} from '../../api/consent';

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
        <div
          className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg ${colorClass}`}
        >
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

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function ConsentStatisticsPage() {
  const { name } = useParams<{ name: string }>();

  const { data: stats, isLoading, error } = useQuery<ConsentStatistics>({
    queryKey: ['consentStatistics', name],
    queryFn: () => getConsentStatistics(name!),
    enabled: !!name,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading consent statistics...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
        Failed to load consent statistics.
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Consent Statistics</h1>
        <p className="mt-1 text-sm text-gray-500">
          GDPR consent analytics for{' '}
          <span className="font-medium">{name}</span>
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Total Consents"
          value={stats?.totalConsents ?? 0}
          colorClass="bg-indigo-100"
          icon={
            <svg
              className="h-5 w-5 text-indigo-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          }
        />
        <StatCard
          label="Users with Consents (24h)"
          value={stats?.activeUsersWithConsents24h ?? 0}
          sublabel="Distinct users who acted on consent in last 24 hours"
          colorClass="bg-green-100"
          icon={
            <svg
              className="h-5 w-5 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
            </svg>
          }
        />
        <StatCard
          label="Users with Consents (7d)"
          value={stats?.activeUsersWithConsents7d ?? 0}
          sublabel="Distinct users who acted on consent in last 7 days"
          colorClass="bg-blue-100"
          icon={
            <svg
              className="h-5 w-5 text-blue-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          }
        />
        <StatCard
          label="Users with Consents (30d)"
          value={stats?.activeUsersWithConsents30d ?? 0}
          sublabel="Distinct users who acted on consent in last 30 days"
          colorClass="bg-purple-100"
          icon={
            <svg
              className="h-5 w-5 text-purple-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
          }
        />
        <StatCard
          label="Consent Actions (24h)"
          value={stats?.consentActionsLast24h ?? 0}
          sublabel="Grant or revoke actions in last 24 hours"
          colorClass="bg-teal-100"
          icon={
            <svg
              className="h-5 w-5 text-teal-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          }
        />
        <StatCard
          label="Consent Actions (7d)"
          value={stats?.consentActionsLast7d ?? 0}
          sublabel="Grant or revoke actions in last 7 days"
          colorClass="bg-cyan-100"
          icon={
            <svg
              className="h-5 w-5 text-cyan-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          }
        />
        <StatCard
          label="Consent Actions (30d)"
          value={stats?.consentActionsLast30d ?? 0}
          sublabel="Grant or revoke actions in last 30 days"
          colorClass="bg-sky-100"
          icon={
            <svg
              className="h-5 w-5 text-sky-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          }
        />
        <StatCard
          label="Pending Deletions"
          value={stats?.pendingDeletions ?? 0}
          sublabel="Data deletion requests awaiting processing"
          colorClass="bg-orange-100"
          icon={
            <svg
              className="h-5 w-5 text-orange-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          }
        />
      </div>

      {/* Consents by Category */}
      <div className="mt-8">
        <h2 className="mb-3 text-base font-semibold text-gray-900">
          Consents by Category
        </h2>
        {stats?.consentsByCategory && stats.consentsByCategory.length > 0 ? (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                    >
                      Category
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                    >
                      Total Grants
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {stats.consentsByCategory.map((cat) => (
                    <tr key={cat.categoryId} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                        {cat.categoryName}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                        {cat.totalGrants.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
            No consent categories configured or no grants found yet.
          </div>
        )}
      </div>
    </div>
  );
}
