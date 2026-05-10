import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getUserConsents, getUserConsentHistory, type UserConsent } from '../../api/consent';

interface UserConsentPanelProps {
  realmName: string;
  userId: string;
  username: string;
}

export default function UserConsentPanel({ realmName, userId, username }: UserConsentPanelProps) {
  const [activeTab, setActiveTab] = useState<'current' | 'history'>('current');
  const [historyPage, setHistoryPage] = useState(1);

  const { data: consents, isLoading: loadingConsents } = useQuery({
    queryKey: ['userConsents', realmName, userId],
    queryFn: () => getUserConsents(realmName, userId),
    enabled: !!realmName && !!userId,
  });

  const { data: historyData, isLoading: loadingHistory } = useQuery({
    queryKey: ['userConsentHistory', realmName, userId, historyPage],
    queryFn: () => getUserConsentHistory(realmName, userId, historyPage),
    enabled: !!realmName && !!userId,
  });

  if (loadingConsents && loadingHistory) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading user consents...</div>
      </div>
    );
  }

  const groupedConsents = groupConsentsByClient(consents ?? []);
  const hasConsents = consents && consents.length > 0;
  const hasHistory = historyData && historyData.history && historyData.history.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">User Consents</h2>
          <p className="mt-1 text-sm text-gray-500">
            View and manage consent preferences for {username}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('current')}
            className={`border-b-2 px-1 pb-4 text-sm font-medium ${
              activeTab === 'current'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
            }`}
          >
            Current Consents ({consents?.length ?? 0})
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`border-b-2 px-1 pb-4 text-sm font-medium ${
              activeTab === 'history'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
            }`}
          >
            Consent History
          </button>
        </nav>
      </div>

      {/* Current Consents Tab */}
      {activeTab === 'current' && (
        <div className="space-y-4">
          {hasConsents ? (
            <div className="space-y-6">
              {Object.entries(groupedConsents).map(([clientId, clientConsents]) => (
                <div
                  key={clientId}
                  className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-base font-medium text-gray-900">
                      {clientConsents[0].client?.name ?? clientConsents[0].client?.clientId ?? clientId}
                    </h3>
                    <span className="text-xs text-gray-500">
                      {clientConsents[0].client?.clientId ?? clientId}
                    </span>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {clientConsents.map((consent) => (
                      <div key={consent.id} className="flex items-center justify-between py-3">
                        <div className="flex items-center gap-3">
                          <div
                            className={`h-2.5 w-2.5 rounded-full ${
                              consent.category?.required
                                ? 'bg-amber-400'
                                : 'bg-green-400'
                            }`}
                          />
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              {consent.category?.name ?? 'Unknown Category'}
                              {consent.category?.required && (
                                <span className="ml-2 text-xs text-amber-600">(Required)</span>
                              )}
                            </p>
                            <p className="text-xs text-gray-500">
                              Granted on {formatDate(consent.grantedAt)} via {consent.grantedVia}
                              {consent.policyVersion && ` · Policy v${consent.policyVersion}`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                            Active
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                <svg
                  className="h-6 w-6 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <h3 className="mt-4 text-sm font-medium text-gray-900">No consents found</h3>
              <p className="mt-1 text-sm text-gray-500">
                This user has not granted any consents yet.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Consent History Tab */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          {hasHistory ? (
            <>
              <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Action
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Category
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Client
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Date
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Performed By
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {historyData?.history.map((entry) => (
                      <tr key={entry.id} className="hover:bg-gray-50">
                        <td className="whitespace-nowrap px-4 py-3 text-sm">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                              entry.action === 'GRANTED'
                                ? 'bg-green-100 text-green-700'
                                : entry.action === 'REVOKED'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-blue-100 text-blue-700'
                            }`}
                          >
                            {formatAction(entry.action)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                          {entry.category?.name ?? 'Unknown'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                          {entry.client?.name ?? entry.client?.clientId ?? '-'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                          {formatDate(entry.performedAt)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                          {entry.performedBy ?? 'User'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-500">
                  Showing {((historyPage - 1) * 20) + 1} to{' '}
                  {Math.min(historyPage * 20, historyData?.total ?? 0)} of{' '}
                  {historyData?.total ?? 0} entries
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                    disabled={historyPage === 1}
                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setHistoryPage((p) => p + 1)}
                    disabled={!historyData || historyPage * 20 >= historyData.total}
                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                <svg
                  className="h-6 w-6 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <h3 className="mt-4 text-sm font-medium text-gray-900">No consent history</h3>
              <p className="mt-1 text-sm text-gray-500">
                This user has no recorded consent activity.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function groupConsentsByClient(consents: UserConsent[]): Record<string, UserConsent[]> {
  return consents.reduce(
    (acc, consent) => {
      const key = consent.clientId;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(consent);
      return acc;
    },
    {} as Record<string, UserConsent[]>,
  );
}

function formatDate(dateString: string): string {
  try {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateString;
  }
}

function formatAction(action: string): string {
  const actionLabels: Record<string, string> = {
    GRANTED: 'Granted',
    REVOKED: 'Revoked',
    UPDATED: 'Updated',
    EXPIRED: 'Expired',
  };
  return actionLabels[action] ?? action;
}
