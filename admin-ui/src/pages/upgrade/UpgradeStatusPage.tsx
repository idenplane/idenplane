import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getUpgradeStatus,
  getUpgradeHistory,
  runPreValidation,
  runHealthCheck,
  checkRollbackCapability,
  executeRollback,
  type UpgradeAuditEntry,
  type PreUpgradeValidationResult,
  type UpgradeHealthResult,
  type RollbackCapability,
} from '../../api/upgrade';

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

// ─── Check Result Row ──────────────────────────────────────────────────────────

function CheckRow({ name, status, message }: { name: string; status: string; message: string }) {
  const isPass = status === 'pass';
  const isWarn = status === 'warn';

  const bgClass = isPass
    ? 'bg-success-soft border-green-100'
    : isWarn
    ? 'bg-warning-soft border-yellow-100'
    : 'bg-danger-soft border-red-100';

  const iconClass = isPass
    ? 'text-green-500'
    : isWarn
    ? 'text-yellow-500'
    : 'text-danger';

  return (
    <div className={`flex items-start gap-3 rounded-lg border p-3 ${bgClass}`}>
      <svg className={`mt-0.5 h-4 w-4 flex-shrink-0 ${iconClass}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        {isPass ? (
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        ) : isWarn ? (
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        ) : (
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
        )}
      </svg>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">{name}</p>
        <p className="mt-0.5 text-xs text-muted">{message}</p>
      </div>
    </div>
  );
}

// ─── Upgrade History Table ─────────────────────────────────────────────────────

function UpgradeHistoryTable({ entries }: { entries: UpgradeAuditEntry[] }) {
  const formatDate = (date: Date | string | null) => {
    if (!date) return '—';
    return new Date(date).toLocaleString();
  };

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
      <table className="min-w-full divide-y divide-line text-sm" aria-label="Upgrade history">
        <thead className="bg-sunken">
          <tr>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Started</th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">From</th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">To</th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Status</th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">Completed</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {entries.map((entry) => (
            <tr key={entry.id} className="hover:bg-hover">
              <td className="whitespace-nowrap px-4 py-2.5 text-muted">
                {formatDate(entry.startedAt)}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 font-mono text-muted">
                {entry.fromVersion}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 font-mono text-muted">
                {entry.toVersion}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5">
                <StatusBadge status={entry.status} />
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-subtle">
                {formatDate(entry.completedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Validation Section ────────────────────────────────────────────────────────

function ValidationSection() {
  const [hasRunChecks, setHasRunChecks] = useState(false);
  const [hasRunHealth, setHasRunHealth] = useState(false);

  const { data: preValidation, isLoading: preLoading, refetch: runPreChecks } = useQuery<PreUpgradeValidationResult>({
    queryKey: ['preValidation'],
    queryFn: runPreValidation,
    enabled: false,
  });

  const { data: healthCheck, isLoading: healthLoading, refetch: runHealthChecks } = useQuery<UpgradeHealthResult>({
    queryKey: ['upgradeHealth'],
    queryFn: runHealthCheck,
    enabled: false,
  });

  const handleRunChecks = async () => {
    setHasRunChecks(true);
    await runPreChecks();
    setHasRunHealth(true);
    await runHealthChecks();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-fg">Pre-Upgrade Validation</h3>
          <p className="text-sm text-subtle">Run checks before starting an upgrade</p>
        </div>
        <button
          onClick={handleRunChecks}
          disabled={preLoading || healthLoading}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 disabled:opacity-50"
        >
          {preLoading || healthLoading ? 'Running...' : 'Run Checks'}
        </button>
      </div>

      {hasRunChecks && preValidation && (
        <div className="space-y-3">
          <div className="rounded-lg border border-line bg-sunken p-4">
            <div className="flex gap-6">
              <div>
                <p className="text-xs font-medium text-subtle">Passed</p>
                <p className="text-lg font-bold text-success">{preValidation.summary.passed}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-subtle">Warnings</p>
                <p className="text-lg font-bold text-warning">{preValidation.summary.warnings}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-subtle">Failures</p>
                <p className="text-lg font-bold text-danger">{preValidation.summary.failures}</p>
              </div>
            </div>
          </div>
          {preValidation.checks.map((check) => (
            <CheckRow key={check.name} name={check.name} status={check.status} message={check.message} />
          ))}
        </div>
      )}

      {hasRunHealth && healthCheck && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium text-fg">Post-Upgrade Health Check</h4>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                healthCheck.healthy ? 'bg-success-soft text-success-fg' : 'bg-danger-soft text-danger-fg'
              }`}
            >
              {healthCheck.healthy ? 'Healthy' : 'Unhealthy'}
            </span>
          </div>
          {healthCheck.version && (
            <p className="text-sm text-subtle">Current version: <span className="font-mono">{healthCheck.version}</span></p>
          )}
          {healthCheck.checks.map((check) => (
            <CheckRow key={check.name} name={check.name} status={check.status} message={check.message} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Rollback Section ─────────────────────────────────────────────────────────

function RollbackSection({ onRollbackSuccess }: { onRollbackSuccess: () => void }) {
  const queryClient = useQueryClient();

  const { data: rollbackCap, isLoading } = useQuery<RollbackCapability>({
    queryKey: ['rollbackCapability'],
    queryFn: checkRollbackCapability,
  });

  const [showConfirm, setShowConfirm] = useState(false);

  const rollbackMutation = useMutation({
    mutationFn: () => executeRollback(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['upgradeHistory'] });
      queryClient.invalidateQueries({ queryKey: ['upgradeStatus'] });
      onRollbackSuccess();
    },
  });

  if (isLoading) {
    return (
      <div className="animate-pulse rounded-lg border border-line bg-sunken p-4">
        <div className="h-4 w-32 rounded bg-active" />
      </div>
    );
  }

  const canRollback = rollbackCap?.canRollback ?? false;

  return (
    <div className="rounded-lg border border-line bg-surface p-5">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold text-fg">Rollback</h3>
          <p className="mt-1 text-sm text-subtle">
            {canRollback && rollbackCap?.lastSuccessfulUpgrade
              ? `Restore from backup to version ${rollbackCap.lastSuccessfulUpgrade.fromVersion}`
              : rollbackCap?.reason ?? 'Rollback is not available'}
          </p>
          {canRollback && rollbackCap?.lastSuccessfulUpgrade && (
            <p className="mt-2 text-xs text-subtle">
              Last successful: {rollbackCap.lastSuccessfulUpgrade.fromVersion} →{' '}
              {rollbackCap.lastSuccessfulUpgrade.toVersion} (
              {new Date(rollbackCap.lastSuccessfulUpgrade.completedAt).toLocaleString()})
            </p>
          )}
        </div>
        {canRollback ? (
          showConfirm ? (
            <div className="flex gap-2">
              <button
                onClick={() => rollbackMutation.mutate()}
                disabled={rollbackMutation.isPending}
                className="rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-white hover:bg-danger focus:outline-none focus:ring-2 focus:ring-danger focus:ring-offset-2 disabled:opacity-50"
              >
                {rollbackMutation.isPending ? 'Rolling back...' : 'Confirm Rollback'}
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-muted hover:bg-hover focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowConfirm(true)}
              className="rounded-md border border-danger-soft bg-danger-soft px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger-soft focus:outline-none focus:ring-2 focus:ring-danger focus:ring-offset-2"
            >
              Initiate Rollback
            </button>
          )
        ) : (
          <span className="inline-flex items-center rounded-full bg-sunken px-2.5 py-0.5 text-xs font-medium text-subtle">
            Not Available
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main Upgrade Status Page ─────────────────────────────────────────────────

export default function UpgradeStatusPage() {
  const navigate = useNavigate();

  const { data: currentStatus, isLoading: statusLoading } = useQuery<UpgradeAuditEntry | null>({
    queryKey: ['upgradeStatus'],
    queryFn: getUpgradeStatus,
    refetchInterval: 30_000,
  });

  const { data: history, isLoading: historyLoading } = useQuery<UpgradeAuditEntry[]>({
    queryKey: ['upgradeHistory'],
    queryFn: () => getUpgradeHistory(20),
  });

  const formatDate = (date: Date | string | null) => {
    if (!date) return '—';
    return new Date(date).toLocaleString();
  };

  if (statusLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-subtle">Loading upgrade status...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-fg">Upgrade Status</h1>
          <p className="mt-1 text-sm text-subtle">Monitor upgrades and rollback if needed</p>
        </div>
        <button
          onClick={() => navigate('/console/upgrade/new')}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
        >
          Start New Upgrade
        </button>
      </div>

      {/* Current Status Card */}
      <div className="rounded-lg border border-line bg-surface p-6 shadow-sm">
        <h2 className="text-base font-semibold text-fg">Current Status</h2>
        {currentStatus ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-subtle">Status</p>
              <div className="mt-1">
                <StatusBadge status={currentStatus.status} />
              </div>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-subtle">From Version</p>
              <p className="mt-1 font-mono text-sm text-fg">{currentStatus.fromVersion}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-subtle">To Version</p>
              <p className="mt-1 font-mono text-sm text-fg">{currentStatus.toVersion}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-subtle">Started</p>
              <p className="mt-1 text-sm text-muted">{formatDate(currentStatus.startedAt)}</p>
            </div>
            {currentStatus.errorMessage && (
              <div className="sm:col-span-2 lg:col-span-4">
                <p className="text-xs font-medium uppercase tracking-wider text-danger">Error</p>
                <p className="mt-1 text-sm text-danger">{currentStatus.errorMessage}</p>
              </div>
            )}
            {currentStatus.backupId && (
              <div className="sm:col-span-2">
                <p className="text-xs font-medium uppercase tracking-wider text-subtle">Backup ID</p>
                <p className="mt-1 font-mono text-xs text-muted">{currentStatus.backupId}</p>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-3 text-sm text-subtle">No active or recent upgrades.</p>
        )}
      </div>

      {/* Validation Section */}
      <div className="rounded-lg border border-line bg-surface p-6 shadow-sm">
        <ValidationSection />
      </div>

      {/* Rollback Section */}
      <RollbackSection onRollbackSuccess={() => {}} />

      {/* Upgrade History */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-fg">Upgrade History</h2>
          {/* The table below is a recent-activity preview; the history page is
              the paginated deep dive. Nothing linked forward to it before. */}
          <Link
            to="/console/upgrade/history"
            className="text-sm text-accent hover:underline"
          >
            View full history
          </Link>
        </div>
        {historyLoading ? (
          <div className="animate-pulse rounded-lg border border-line bg-sunken p-8">
            <div className="h-4 w-32 rounded bg-active" />
          </div>
        ) : history && history.length > 0 ? (
          <UpgradeHistoryTable entries={history} />
        ) : (
          <div className="rounded-lg border border-line bg-surface p-8 text-center text-sm text-subtle">
            No upgrade history available.
          </div>
        )}
      </div>
    </div>
  );
}