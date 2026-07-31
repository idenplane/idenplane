import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { getUpgradeAudit, type UpgradeAuditEntry } from '../../api/upgrade';

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const isSuccess = status === 'SUCCESS' || status === 'COMPLETED';
  const isPending = status === 'IN_PROGRESS' || status === 'PENDING';
  const isFailed = status === 'FAILED' || status === 'ERROR' || status === 'ROLLBACK';

  const colorClass = isSuccess
    ? 'bg-success-soft text-success-fg'
    : isPending
    ? 'bg-info-soft text-info-fg'
    : isFailed
    ? 'bg-danger-soft text-danger-fg'
    : 'bg-sunken text-muted';

  const dotClass = isSuccess
    ? 'bg-success'
    : isPending
    ? 'bg-info'
    : isFailed
    ? 'bg-danger'
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
        className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-muted hover:bg-hover disabled:opacity-50 disabled:hover:bg-surface"
      >
        Previous
      </button>
      <span className="text-sm text-subtle">
        Page {page + 1} of {totalPages}
      </span>
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={!hasNext}
        className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-muted hover:bg-hover disabled:opacity-50 disabled:hover:bg-surface"
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
    <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
      <table className="min-w-full divide-y divide-line text-sm" aria-label="Migration history">
        <thead className="bg-sunken">
          <tr>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
              Started
            </th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
              From Version
            </th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
              To Version
            </th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
              Status
            </th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
              Completed
            </th>
            <th scope="col" className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-subtle">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {entries.map((entry) => (
            <tr key={entry.id} className="hover:bg-hover">
              <td className="whitespace-nowrap px-4 py-2.5 text-muted">
                {formatDate(entry.startedAt)}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 font-mono text-sm text-muted">
                {entry.fromVersion}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 font-mono text-sm text-muted">
                {entry.toVersion}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5">
                <StatusBadge status={entry.status} />
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-subtle">
                {formatDate(entry.completedAt)}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right">
                <button
                  onClick={() => onViewDetails(entry)}
                  className="text-sm text-accent hover:text-indigo-800 hover:underline"
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
      <div className="w-full max-w-2xl rounded-lg bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="text-lg font-semibold text-fg">Migration Details</h2>
          <button
            onClick={onClose}
            data-testid="modal-close-icon-button"
            className="text-subtle hover:text-muted"
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
              <p className="text-xs font-medium uppercase tracking-wider text-subtle">Migration ID</p>
              <p className="mt-1 font-mono text-sm text-fg">{entry.id}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-subtle">Status</p>
              <div className="mt-1">
                <StatusBadge status={entry.status} />
              </div>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-subtle">From Version</p>
              <p className="mt-1 font-mono text-sm text-fg">{entry.fromVersion}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-subtle">To Version</p>
              <p className="mt-1 font-mono text-sm text-fg">{entry.toVersion}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-subtle">Started</p>
              <p className="mt-1 text-sm text-muted">{formatDate(entry.startedAt)}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-subtle">Completed</p>
              <p className="mt-1 text-sm text-muted">{formatDate(entry.completedAt)}</p>
            </div>
          </div>
          {entry.backupId && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-subtle">Backup ID</p>
              <p className="mt-1 font-mono text-sm text-muted">{entry.backupId}</p>
            </div>
          )}
          {entry.errorMessage && (
            <div className="rounded-md border border-danger-soft bg-danger-soft p-3">
              <p className="text-xs font-medium uppercase tracking-wider text-danger">Error</p>
              <p className="mt-1 text-sm text-danger-fg">{entry.errorMessage}</p>
            </div>
          )}
          {/* The per-stage check results. The server has always returned these
              and the UI has always dropped them, even though on a failed
              upgrade they are the most useful thing on the record. */}
          {entry.checksPassed && (
            <details>
              <summary className="cursor-pointer text-xs font-medium uppercase tracking-wider text-subtle">
                Check results
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-sunken p-3 text-xs text-muted">
                {JSON.stringify(entry.checksPassed, null, 2)}
              </pre>
            </details>
          )}
        </div>
        <div className="flex justify-end border-t border-line px-6 py-4">
          <button
            onClick={onClose}
            data-testid="modal-close-button"
            className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-muted hover:bg-hover"
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
    <div className="rounded-lg border border-line bg-surface p-12 text-center">
      <svg className="mx-auto h-12 w-12 text-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <h3 className="mt-4 text-sm font-medium text-fg">No migration history</h3>
      <p className="mt-2 text-sm text-subtle">Migration history will appear here once upgrades are performed.</p>
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
      // /upgrade/audit rather than /upgrade/history: audit honours ?limit
      // (clamped 1..100 server-side) and returns {entries, total}. history
      // ignored ?limit entirely until #1197, which meant this page's
      // pagination worked against the MSW mock and never in production —
      // the mock honoured the parameter while the server capped at 10.
      const { entries, total } = await getUpgradeAudit(100);
      return { data: entries, total };
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
          <h1 className="text-2xl font-bold text-fg">Migration History</h1>
          <p className="mt-1 text-sm text-subtle">View past upgrade migrations and their status</p>
        </div>
        <button
          onClick={() => navigate('/console/upgrade')}
          className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-muted hover:bg-hover"
        >
          Back to Upgrade
        </button>
      </div>

      {/* Stats Summary */}
      {!isLoading && !isError && total > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-line bg-surface p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wider text-subtle">Total Migrations</p>
            <p className="mt-1 text-2xl font-bold text-fg">{total}</p>
          </div>
          <div className="rounded-lg border border-line bg-surface p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wider text-subtle">Successful</p>
            <p className="mt-1 text-2xl font-bold text-success">
              {entries.filter(e => e.status === 'SUCCESS' || e.status === 'COMPLETED').length}
            </p>
          </div>
          <div className="rounded-lg border border-line bg-surface p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wider text-subtle">Failed</p>
            <p className="mt-1 text-2xl font-bold text-danger">
              {entries.filter(e => e.status === 'FAILED' || e.status === 'ERROR').length}
            </p>
          </div>
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center rounded-lg border border-line bg-surface py-12">
          <div className="text-subtle">Loading migration history...</div>
        </div>
      ) : isError ? (
        <div className="rounded-md border border-danger-soft bg-danger-soft p-8 text-center text-danger">
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
