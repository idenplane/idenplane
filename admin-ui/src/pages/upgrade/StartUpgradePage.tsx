import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ConfirmDialog from '../../components/ConfirmDialog';
import {
  getSystemVersion,
  runPreValidation,
  checkConfigCompatibility,
  startUpgrade,
  type UpgradeResult,
  type PreUpgradeCheck,
} from '../../api/upgrade';

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

function CheckRow({ check }: { check: PreUpgradeCheck }) {
  const tone =
    check.status === 'pass'
      ? 'bg-success-soft text-success-fg'
      : check.status === 'warn'
        ? 'bg-warning-soft text-warning-fg'
        : 'bg-danger-soft text-danger-fg';

  return (
    <li className="flex items-start gap-3 py-2 border-b border-line last:border-0">
      <span
        className={`px-2 py-0.5 rounded text-xs font-medium uppercase ${tone}`}
      >
        {check.status}
      </span>
      <div className="min-w-0">
        <p className="text-sm text-fg">{check.message}</p>
        <p className="text-xs text-subtle">{check.name}</p>
        {check.details && (
          <p className="text-xs text-subtle mt-1 break-words">
            {check.details}
          </p>
        )}
      </div>
    </li>
  );
}

export default function StartUpgradePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(0);
  const [toVersion, setToVersion] = useState('');
  // Simulation is the default action. A real upgrade must be chosen.
  const [dryRun, setDryRun] = useState(true);
  const [force, setForce] = useState(false);
  const [note, setNote] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typedConfirm, setTypedConfirm] = useState('');
  const [result, setResult] = useState<UpgradeResult | null>(null);

  const versionQuery = useQuery({
    queryKey: ['system-version'],
    queryFn: getSystemVersion,
  });

  const preValidation = useQuery({
    queryKey: ['preValidation'],
    queryFn: runPreValidation,
    enabled: step === 1,
  });

  const compatibility = useQuery({
    queryKey: ['configCompatibility', toVersion],
    queryFn: () => checkConfigCompatibility(toVersion),
    enabled: step === 1 && SEMVER.test(toVersion),
  });

  const mutation = useMutation({
    mutationFn: () =>
      startUpgrade({
        toVersion,
        dryRun,
        force,
        note: note || undefined,
        // Only meaningful for a real upgrade; the server ignores it on dry runs.
        ...(dryRun ? {} : { confirm: toVersion }),
      }),
    retry: false,
    onSuccess: (data) => {
      setResult(data);
      setConfirmOpen(false);
      for (const key of [
        'upgradeStatus',
        'upgradeHistory',
        'migration-history',
        'rollbackCapability',
        'system-version',
      ]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });

  const currentVersion = versionQuery.data?.version;
  const versionValid = SEMVER.test(toVersion) && toVersion !== currentVersion;

  const blockingChecks =
    preValidation.data?.checks.filter((c) => c.status === 'fail') ?? [];
  const compatibilityErrors = compatibility.data?.summary.errors ?? 0;
  const preflightBlocked =
    preValidation.data?.canProceed === false || compatibilityErrors > 0;
  // Mirror the server's own gates, so the UI never promises what it will reject.
  const canProceedPastPreflight =
    !preValidation.isLoading &&
    !preValidation.isError &&
    (!preflightBlocked || force);

  // ── Result view ───────────────────────────────────────────────────────────
  if (result) {
    return (
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold text-fg mb-1">
          {dryRun ? 'Dry run complete' : 'Upgrade complete'}
        </h1>
        <p className="text-sm text-subtle mb-6">
          {result.fromVersion ?? currentVersion} → {result.toVersion}
        </p>

        {/* A rollback that ran and failed is the state an operator most needs
            to tell apart from one that ran and worked — the database is left
            modified with no recovery applied. Never report a restore that did
            not happen. */}
        {result.rollbackTriggered && (
          <div className="mb-6 rounded border border-danger-soft bg-danger-soft p-4">
            <p className="text-sm font-medium text-danger-fg">
              {result.rollbackSucceeded === false
                ? 'A rollback was attempted and failed.'
                : 'A rollback was triggered.'}
            </p>
            <p className="text-sm text-danger-fg mt-1">
              {result.rollbackSucceeded === false
                ? 'The upgrade failed after the database was modified, and the backup could not be restored. The database is still in its post-migration state — restore it manually before using this instance.'
                : 'The upgrade failed after the database was modified and the backup was restored. Verify the system state before retrying.'}
            </p>
          </div>
        )}

        {result.error && (
          <div className="mb-6 rounded border border-danger-soft bg-danger-soft p-4">
            <p className="text-sm text-danger-fg break-words">{result.error}</p>
          </div>
        )}

        <div className="bg-surface border border-line rounded-lg p-4 mb-6">
          <h2 className="text-sm font-semibold text-fg mb-3">Stages</h2>
          <ol className="space-y-2">
            {result.stages.map((s, i) => (
              <li key={`${s.stage}-${i}`} className="flex items-start gap-3">
                <span
                  className={`mt-0.5 px-2 py-0.5 rounded text-xs font-medium ${
                    s.success
                      ? 'bg-success-soft text-success-fg'
                      : 'bg-danger-soft text-danger-fg'
                  }`}
                >
                  {s.success ? 'OK' : 'FAIL'}
                </span>
                <div className="min-w-0">
                  <p className="text-sm text-fg">{s.stage}</p>
                  <p className="text-xs text-muted break-words">
                    {s.message}
                  </p>
                  {s.details && (
                    <p className="text-xs text-subtle mt-0.5 break-words">
                      {s.details}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => navigate('/console/upgrade')}
            className="px-4 py-2 rounded bg-accent text-white text-sm hover:bg-accent-hover"
          >
            Back to Upgrade
          </button>
          {/* Staying put on failure is deliberate: navigating away from a
              failure report is the wrong default. */}
          <button
            onClick={() => {
              setResult(null);
              setStep(0);
            }}
            className="px-4 py-2 rounded border border-line-strong text-muted text-sm hover:bg-hover"
          >
            Start another
          </button>
        </div>
      </div>
    );
  }

  // ── Wizard ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-fg mb-1">
        Start an upgrade
      </h1>
      <p className="text-sm text-subtle mb-6">
        Step {step + 1} of 3 &middot;{' '}
        {['Target', 'Preflight checks', 'Review'][step]}
      </p>

      {mutation.isPending && (
        <div className="mb-6 rounded border border-info-soft bg-info-soft p-4">
          <p className="text-sm font-medium text-blue-900">
            {dryRun ? 'Running dry run…' : 'Applying upgrade…'}
          </p>
          <p className="text-sm text-info-fg mt-1">
            Do not close this tab. The request completes only when every stage
            has finished, which can take several minutes.
          </p>
        </div>
      )}

      {/* Step 1 — target */}
      {step === 0 && (
        <div className="bg-surface border border-line rounded-lg p-4 space-y-4">
          <div>
            <p className="text-sm text-subtle">Current version</p>
            <p className="text-lg font-medium text-fg">
              {versionQuery.isLoading
                ? 'Loading…'
                : (currentVersion ?? 'unknown')}
            </p>
          </div>

          {versionQuery.data?.databaseUpToDate === false && (
            <div className="rounded border border-warning-soft bg-warning-soft p-3">
              <p className="text-sm font-medium text-yellow-900">
                The database has pending migrations.
              </p>
              <p className="text-xs text-warning-fg mt-1 break-words">
                {versionQuery.data.pendingMigrations.join(', ')}
              </p>
            </div>
          )}

          <div>
            <label
              htmlFor="toVersion"
              className="block text-sm font-medium text-muted mb-1"
            >
              Target version
            </label>
            <input
              id="toVersion"
              value={toVersion}
              onChange={(e) => setToVersion(e.target.value)}
              placeholder="0.4.0"
              className="w-full border border-line-strong rounded px-3 py-2 text-sm"
            />
            {toVersion && !SEMVER.test(toVersion) && (
              <p className="text-xs text-danger mt-1">
                Expected a semantic version, e.g. 0.4.0
              </p>
            )}
            {toVersion && toVersion === currentVersion && (
              <p className="text-xs text-danger mt-1">
                That is the version already running.
              </p>
            )}
          </div>

          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="mt-1"
            />
            <span className="text-sm text-muted">
              Dry run
              <span className="block text-xs text-subtle">
                Simulates the upgrade. No backup is taken and no migration is
                applied.
              </span>
            </span>
          </label>

          <div>
            <label
              htmlFor="note"
              className="block text-sm font-medium text-muted mb-1"
            >
              Note <span className="text-subtle">(optional)</span>
            </label>
            <input
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ticket or change reference"
              className="w-full border border-line-strong rounded px-3 py-2 text-sm"
            />
          </div>

          <div className="flex justify-end">
            <button
              disabled={!versionValid}
              onClick={() => setStep(1)}
              className="px-4 py-2 rounded bg-accent text-white text-sm disabled:bg-active hover:bg-accent-hover"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Step 2 — preflight */}
      {step === 1 && (
        <div className="bg-surface border border-line rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">
              Preflight checks
            </h2>
            <button
              onClick={() => {
                void preValidation.refetch();
                void compatibility.refetch();
              }}
              className="text-sm text-accent hover:underline"
            >
              Re-run checks
            </button>
          </div>

          {preValidation.isLoading && (
            <p className="text-sm text-subtle">Running checks…</p>
          )}
          {preValidation.isError && (
            <p className="text-sm text-danger">
              Could not run pre-upgrade validation.
            </p>
          )}

          {preValidation.data && (
            <ul>
              {preValidation.data.checks.map((c) => (
                <CheckRow key={c.name} check={c} />
              ))}
            </ul>
          )}

          {compatibility.data && compatibility.data.issues.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-fg mt-4 mb-2">
                Configuration
              </h3>
              <ul className="space-y-1">
                {compatibility.data.issues.map((issue, i) => (
                  <li key={`${issue.path}-${i}`} className="text-sm">
                    <span
                      className={
                        issue.type === 'error'
                          ? 'text-danger-fg'
                          : 'text-warning-fg'
                      }
                    >
                      {issue.path}
                    </span>
                    <span className="text-muted"> — {issue.message}</span>
                    {issue.requiredValue && (
                      <span className="text-subtle">
                        {' '}
                        (expected {issue.requiredValue})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preflightBlocked && (
            <div className="rounded border border-danger-soft bg-danger-soft p-3">
              <p className="text-sm font-medium text-danger-fg">
                {blockingChecks.length + compatibilityErrors} blocking issue(s).
              </p>
              <label className="flex items-start gap-2 mt-3">
                <input
                  type="checkbox"
                  checked={force}
                  onChange={(e) => setForce(e.target.checked)}
                  className="mt-1"
                />
                <span className="text-sm text-danger-fg">
                  Proceed anyway (force)
                  <span className="block text-xs text-danger-fg">
                    Skips pre-validation entirely — including the checks that
                    verify a backup can be taken. An upgrade forced past these
                    may not be recoverable.
                  </span>
                </span>
              </label>
            </div>
          )}

          <div className="flex justify-between">
            <button
              onClick={() => setStep(0)}
              className="px-4 py-2 rounded border border-line-strong text-muted text-sm hover:bg-hover"
            >
              Back
            </button>
            <button
              disabled={!canProceedPastPreflight}
              onClick={() => setStep(2)}
              className="px-4 py-2 rounded bg-accent text-white text-sm disabled:bg-active hover:bg-accent-hover"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Step 3 — review */}
      {step === 2 && (
        <div className="bg-surface border border-line rounded-lg p-4 space-y-4">
          <h2 className="text-sm font-semibold text-fg">Review</h2>

          <dl className="text-sm">
            <div className="flex justify-between py-1 border-b border-line">
              <dt className="text-subtle">From</dt>
              <dd className="text-fg">{currentVersion ?? 'unknown'}</dd>
            </div>
            <div className="flex justify-between py-1 border-b border-line">
              <dt className="text-subtle">To</dt>
              <dd className="text-fg">{toVersion}</dd>
            </div>
            <div className="flex justify-between py-1 border-b border-line">
              <dt className="text-subtle">Mode</dt>
              <dd className="text-fg">
                {dryRun ? 'Dry run (nothing is written)' : 'Real upgrade'}
              </dd>
            </div>
            <div className="flex justify-between py-1 border-b border-line">
              <dt className="text-subtle">Backup</dt>
              <dd className="text-fg">
                {dryRun ? 'Skipped' : 'Taken before migrating'}
              </dd>
            </div>
            {force && (
              <div className="flex justify-between py-1 border-b border-line">
                <dt className="text-subtle">Force</dt>
                <dd className="text-danger-fg">Pre-validation skipped</dd>
              </div>
            )}
          </dl>

          {mutation.isError && (
            <div className="rounded border border-danger-soft bg-danger-soft p-3">
              <p className="text-sm text-danger-fg">
                The request failed. Nothing was started.
              </p>
            </div>
          )}

          <div className="flex justify-between">
            <button
              onClick={() => setStep(1)}
              disabled={mutation.isPending}
              className="px-4 py-2 rounded border border-line-strong text-muted text-sm disabled:opacity-50 hover:bg-hover"
            >
              Back
            </button>
            {dryRun ? (
              <button
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
                className="px-4 py-2 rounded bg-accent text-white text-sm disabled:bg-active hover:bg-accent-hover"
              >
                Run dry run
              </button>
            ) : (
              <button
                onClick={() => {
                  setTypedConfirm('');
                  setConfirmOpen(true);
                }}
                disabled={mutation.isPending}
                className="px-4 py-2 rounded bg-danger text-white text-sm disabled:bg-active hover:bg-danger"
              >
                Start upgrade
              </button>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmOpen}
        title="Start a real upgrade?"
        confirmText="Start upgrade"
        confirmDisabled={typedConfirm !== toVersion || mutation.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => mutation.mutate()}
        // ConfirmDialog renders `message` inside a <p>, so this must be
        // phrasing content — a <div> or nested <p> here is invalid HTML.
        message={
          <>
            <span className="block">
              This applies database migrations to the live database. A backup is
              taken first, and a failure after that point triggers a rollback.
            </span>
            <label className="block mt-3">
              <span className="block text-sm text-muted mb-1">
                Type <strong>{toVersion}</strong> to confirm
              </span>
              <input
                aria-label="Type the target version to confirm"
                value={typedConfirm}
                onChange={(e) => setTypedConfirm(e.target.value)}
                className="w-full border border-line-strong rounded px-3 py-2 text-sm"
              />
            </label>
          </>
        }
      />
    </div>
  );
}
