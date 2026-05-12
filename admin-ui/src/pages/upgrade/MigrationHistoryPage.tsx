import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getUpgradeHistory, type UpgradeAuditEntry } from '../../api/upgrade';

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const isSuccess = status === 'SUCCESS' || status === 'COMPLETED';
  const isPending = status === 'IN_PROGRESS' || status === 'PENDING';
  const isFailed = status === 'FAILED' || status === 'ERROR' || status === 'ROLLBACK';

  const colorClass = isSuccess
    ? 'bg-green-100 text-green-700'
    : isPending
    ? 'bg-blue-100 text-blue-700'
    : isFailed
    ? 'bg-red-100 text-red-700'
    : 'bg-gray-100 text-gray-700';

  const dotClass = isSuccess
    ? 'bg-green-500'
    : isPending
    ? 'bg-blue-500'
    : isFailed
    ? 'bg-red-500'
    : 'bg-gray-500';

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${colorClass}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
      {status}
    </span>
  );
}

// ─── Pagination Controls ──────────────────────────────────────────────────────

function PaginationControls({
  page,
  totalPages,
  onPageChange,
  hasNext,
  hasPrev,
}: {
  page: number;
  totalPages: number;
  onPageChange: (newPage: number) => void;
  hasNext: boolean;
  hasPrev: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={!hasPrev}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:hover:bg-white"
      >
        Previous
      </button>
      <span className="text-sm text-gray-500">
        Page {page + 1} of {totalPages}
      </span>
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={!hasNext}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:hover:bg-white"
      >
        Next
      </button>
    </div>
  );
}

// ─── Migration History Table ───────────────────────────────────────────────────

function MigrationHistoryTable({
  entries,
  onViewDetails,
}: {
  entries: UpgradeAuditEntry[];
  onViewDetails: (entry: UpgradeAuditEntry) => void;
}) {
  const formatDate = (date: Date | string | null) => {
    if (!date) return '—';
    return new Date(date).toLocaleString();
  };

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-gray-200 text-sm" aria-label="Migration history">
        <thead className="bg-gray-50">
          <tr>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              Started
            </th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              From Version
            </th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              To Version
            </th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              Status
            </th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              Completed
            </th>
            <th scope="col" className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {entries.map((entry) => (
            <tr key={entry.id} className="hover:bg-gray-50">
              <td className="whitespace-nowrap px-4 py-2.5 text-gray-700">
                {formatDate(entry.startedAt)}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 font-mono text-sm text-gray-600">
                {entry.fromVersion}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 font-mono text-sm text-gray-600">
                {entry.toVersion}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5">
                <StatusBadge status={entry.status} />
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-gray-500">
                {formatDate(entry.completedAt)}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right">
                <button
                  onClick={() => onViewDetails(entry)}
                  className="text-sm text-indigo-600 hover:text-indigo-800 hover:underline"
                >
                  View Details
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────

function DetailModal({
  entry,
  onClose,
}: {
  entry: UpgradeAuditEntry;
  onClose: () => void;
}) {
  const formatDate = (date: Date | string | null) => {
    if (!date) return '—';
    return new Date(date).toLocaleString();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Migration Details</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="space-y-4 px-6 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Migration ID</p>
              <p className="mt-1 font-mono text-sm text-gray-900">{entry.id}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Status</p>
              <div className="mt-1">
                <StatusBadge status={entry.status} />
              </div>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-gray-500">From Version</p>
              <p className="mt-1 font-mono text-sm text-gray-900">{entry.fromVersion}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-gray-500">To Version</p>
              <p className="mt-1 font-mono text-sm text-gray-900">{entry.toVersion}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Started</p>
              <p className="mt-1 text-sm text-gray-700">{formatDate(entry.startedAt)}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Completed</p>
              <p className="mt-1 text-sm text-gray-700">{formatDate(entry.completedAt)}</p>
            </div>
          </div>
          {entry.backupId && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Backup ID</p>
              <p className="mt-1 font-mono text-sm text-gray-600">{entry.backupId}</p>
            </div>
          )}
          {entry.errorMessage && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3">
              <p className="text-xs font-medium uppercase tracking-wider text-red-600">Error</p>
              <p className="mt-1 text-sm text-red-700">{entry.errorMessage}</p>
            </div>
          )}
        </div>
        <div className="flex justify-end border-t border-gray-200 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
      <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <h3 className="mt-4 text-sm font-medium text-gray-900">No migration history</h3>
      <p className="mt-2 text-sm text-gray-500">Migration history will appear here once upgrades are performed.</p>
    </div>
  );
}

// ─── Main Migration History Page ──────────────────────────────────────────────

const PAGE_SIZE = 10;

export default function MigrationHistoryPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [selectedEntry, setSelectedEntry] = useState<UpgradeAuditEntry | null>(null);

  const { data: response, isLoading, isError, error } = useQuery<{ data: UpgradeAuditEntry[]; total: number }>({
    queryKey: ['migration-history', page],
    queryFn: async () => {
      const data = await getUpgradeHistory(100);
      return {
        data,
        total: data.length,
      };
    },
    refetchInterval: 60_000,
  });

  const entries = response?.data ?? [];
  const total = response?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const paginatedEntries = entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const hasNext = (page + 1) * PAGE_SIZE < total;
  const hasPrev = page > 0;

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleViewDetails = (entry: UpgradeAuditEntry) => {
    setSelectedEntry(entry);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Migration History</h1>
          <p className="mt-1 text-sm text-gray-500">View past upgrade migrations and their status</p>
        </div>
        <button
          onClick={() => navigate('/console/upgrade')}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Back to Upgrade
        </button>
      </div>

      {/* Stats Summary */}
      {!isLoading && !isError && total > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Total Migrations</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{total}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Successful</p>
            <p className="mt-1 text-2xl font-bold text-green-600">
              {entries.filter(e => e.status === 'SUCCESS' || e.status === 'COMPLETED').length}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Failed</p>
            <p className="mt-1 text-2xl font-bold text-red-600">
              {entries.filter(e => e.status === 'FAILED' || e.status === 'ERROR').length}
            </p>
          </div>
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center rounded-lg border border-gray-200 bg-white py-12">
          <div className="text-gray-500">Loading migration history...</div>
        </div>
      ) : isError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-8 text-center text-red-600">
          Failed to load migration history.{' '}
          {error instanceof Error ? error.message : 'An unexpected error occurred.'}
        </div>
      ) : total === 0 ? (
        <EmptyState />
      ) : (
        <>
          <MigrationHistoryTable entries={paginatedEntries} onViewDetails={handleViewDetails} />
          {totalPages > 1 && (
            <PaginationControls
              page={page}
              totalPages={totalPages}
              onPageChange={handlePageChange}
              hasNext={hasNext}
              hasPrev={hasPrev}
            />
          )}
        </>
      )}

      {/* Detail Modal */}
      {selectedEntry && (
        <DetailModal entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
      )}
    </div>
  );
}
