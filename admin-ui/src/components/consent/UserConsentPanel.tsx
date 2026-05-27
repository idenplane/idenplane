import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getUserConsents, getUserConsentHistory, type UserConsent } from '../../api/consent';

interface UserConsentPanelProps {
  realmName: string;
  userId: string;
  username: string;
}

const PAGE_SIZE = 20;

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
    queryFn: () => getUserConsentHistory(realmName, userId, historyPage, PAGE_SIZE),
    enabled: !!realmName && !!userId,
  });

  if (loadingConsents && loadingHistory) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading user consents...</div>
      </div>
    );
  }

  const hasConsents = consents && consents.length > 0;
  const hasHistory = historyData && historyData.history.length > 0;
  const pageSize = historyData?.pageSize ?? PAGE_SIZE;
  const total = historyData?.total ?? 0;

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

      {/* Current Consents Tab — one card per client, listing granted scopes */}
      {activeTab === 'current' && (
        <div className="space-y-4">
          {hasConsents ? (
            <div className="space-y-4">
              {consents.map((consent: UserConsent) => (
                <div
                  key={consent.id}
                  className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-base font-medium text-gray-900">
                      {consent.clientName}
                    </h3>
                    <span className="inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                      Active
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {consent.scopes.length > 0 ? (
                      consent.scopes.map((scope) => (
                        <span
                          key={scope}
                          className="inline-flex rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700"
                        >
                          {scope}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-gray-400">No scopes</span>
                    )}
                  </div>
                  <p className="mt-3 text-xs text-gray-500">
                    Granted {formatDate(consent.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No consents found"
              message="This user has not granted any consents yet."
            />
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
                        Client
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Scopes
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Date
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {historyData.history.map((entry) => (
                      <tr key={entry.id} className="hover:bg-gray-50">
                        <td className="whitespace-nowrap px-4 py-3 text-sm">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${actionClass(
                              entry.action,
                            )}`}
                          >
                            {formatAction(entry.action)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                          {entry.clientName}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {entry.scopes.length > 0 ? entry.scopes.join(', ') : '-'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                          {formatDate(entry.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-500">
                  Showing {(historyPage - 1) * pageSize + 1} to{' '}
                  {Math.min(historyPage * pageSize, total)} of {total} entries
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
                    disabled={historyPage * pageSize >= total}
                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          ) : (
            <EmptyState
              title="No consent history"
              message="This user has no recorded consent activity."
            />
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
        <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>
      <h3 className="mt-4 text-sm font-medium text-gray-900">{title}</h3>
      <p className="mt-1 text-sm text-gray-500">{message}</p>
    </div>
  );
}

function actionClass(action: string): string {
  const a = action.toLowerCase();
  if (a === 'granted') return 'bg-green-100 text-green-700';
  if (a === 'revoked') return 'bg-red-100 text-red-700';
  return 'bg-blue-100 text-blue-700';
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
  const labels: Record<string, string> = {
    granted: 'Granted',
    revoked: 'Revoked',
    updated: 'Updated',
    expired: 'Expired',
  };
  return labels[action.toLowerCase()] ?? action;
}
