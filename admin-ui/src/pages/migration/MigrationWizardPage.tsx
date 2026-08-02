import { useState, type ChangeEvent } from 'react';
import { useParams, useNavigate } from 'react-router';
import { runMigration, type MigrationReport, type MigrationSource } from '../../api/migration';
import { getErrorMessage } from '../../utils/getErrorMessage';
import { Icons } from '../../components/ui';

const SOURCES: { id: MigrationSource; name: string; description: string }[] = [
  { id: 'keycloak', name: 'Keycloak', description: 'Import from a Keycloak realm export JSON file.' },
  { id: 'auth0', name: 'Auth0', description: 'Import from an Auth0 Management API export JSON file.' },
  {
    id: 'zitadel',
    name: 'Zitadel',
    description: 'Import from a hand-assembled Zitadel Management API export (Users/Projects/Roles/Apps/IDPs).',
  },
];

const STEPS = ['source', 'upload', 'preview', 'done'] as const;
type Step = (typeof STEPS)[number];

const STEP_LABELS: Record<Step, string> = {
  source: 'Select Source',
  upload: 'Upload Export',
  preview: 'Preview & Confirm',
  done: 'Summary',
};

function MigrationReportSummary({ report }: { report: MigrationReport }) {
  const entities = Object.entries(report.summary).filter(
    ([, stats]) => stats.created > 0 || stats.skipped > 0 || stats.failed > 0,
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {entities.length === 0 && (
          <p className="col-span-3 text-sm text-subtle">Nothing to import from this file.</p>
        )}
        {entities.map(([entity, stats]) => (
          <div key={entity} className="rounded-md border border-line bg-sunken p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-subtle">{entity}</p>
            <p className="mt-1 text-sm">
              <span className="text-success-fg">{stats.created} created</span>
              {stats.skipped > 0 && <span className="text-subtle">, {stats.skipped} skipped</span>}
              {stats.failed > 0 && <span className="text-danger-fg">, {stats.failed} failed</span>}
            </p>
          </div>
        ))}
      </div>

      {report.warnings.length > 0 && (
        <div className="rounded-md border border-warning-soft bg-warning-soft p-3">
          <p className="text-sm font-medium text-warning-fg">Warnings ({report.warnings.length})</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-warning-fg">
            {report.warnings.map((w, i) => (
              <li key={i}>
                <span className="font-medium">[{w.entity}]</span> {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.errors.length > 0 && (
        <div className="rounded-md border border-danger-soft bg-danger-soft p-3">
          <p className="text-sm font-medium text-danger-fg">Errors ({report.errors.length})</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-danger-fg">
            {report.errors.map((e, i) => (
              <li key={i}>
                <span className="font-medium">
                  [{e.entity}] {e.name}:
                </span>{' '}
                {e.error}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function MigrationWizardPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('source');
  const [source, setSource] = useState<MigrationSource | null>(null);
  const [fileName, setFileName] = useState('');
  const [fileData, setFileData] = useState<Record<string, unknown> | null>(null);
  const [dryRunReport, setDryRunReport] = useState<MigrationReport | null>(null);
  const [finalReport, setFinalReport] = useState<MigrationReport | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      setFileName(file.name);
      setFileData(parsed);
    } catch {
      setError('That file is not valid JSON.');
      setFileData(null);
      setFileName('');
    }
  }

  async function handlePreview() {
    if (!source || !fileData || !name) return;
    setIsRunning(true);
    setError(null);
    try {
      const report = await runMigration(source, fileData, name, true);
      setDryRunReport(report);
      setStep('preview');
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to preview the import.'));
    } finally {
      setIsRunning(false);
    }
  }

  async function handleImport() {
    if (!source || !fileData || !name) return;
    setIsRunning(true);
    setError(null);
    try {
      const report = await runMigration(source, fileData, name, false);
      setFinalReport(report);
      setStep('done');
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to run the import.'));
    } finally {
      setIsRunning(false);
    }
  }

  function startOver() {
    setStep('source');
    setSource(null);
    setFileName('');
    setFileData(null);
    setDryRunReport(null);
    setFinalReport(null);
    setError(null);
  }

  const stepIndex = STEPS.indexOf(step);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-fg">Migration Wizard</h1>
        <p className="mt-1 text-sm text-subtle">
          Import users, clients, roles, and identity providers into <span className="font-medium">{name}</span>
        </p>
      </div>

      {/* Step indicator */}
      <ol className="mb-6 flex items-center gap-2 text-sm">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                i < stepIndex
                  ? 'bg-success text-white'
                  : i === stepIndex
                    ? 'bg-accent text-white'
                    : 'bg-active text-muted'
              }`}
            >
              {i + 1}
            </span>
            <span className={i === stepIndex ? 'font-medium text-fg' : 'text-subtle'}>{STEP_LABELS[s]}</span>
            {i < STEPS.length - 1 && <span className="mx-1 text-subtle">&rarr;</span>}
          </li>
        ))}
      </ol>

      <div className="rounded-lg border border-line bg-surface p-6 shadow-sm">
        {error && <div className="mb-4 rounded-md bg-danger-soft p-3 text-sm text-danger-fg">{error}</div>}

        {step === 'source' && (
          <div>
            <h2 className="mb-3 text-lg font-semibold text-fg">Where are you migrating from?</h2>
            <div className="space-y-2">
              {SOURCES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSource(s.id)}
                  className={`w-full rounded-md border p-4 text-left transition-colors ${
                    source === s.id
                      ? 'border-accent bg-accent-soft'
                      : 'border-line-strong hover:bg-hover'
                  }`}
                >
                  <p className="font-medium text-fg">{s.name}</p>
                  <p className="mt-0.5 text-sm text-subtle">{s.description}</p>
                </button>
              ))}
            </div>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                disabled={!source}
                onClick={() => setStep('upload')}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {step === 'upload' && (
          <div>
            <h2 className="mb-3 text-lg font-semibold text-fg">
              Upload your {SOURCES.find((s) => s.id === source)?.name} export
            </h2>
            <input
              type="file"
              accept="application/json,.json"
              onChange={handleFileChange}
              className="block w-full text-sm text-muted file:mr-4 file:rounded-md file:border-0 file:bg-accent-soft file:px-4 file:py-2 file:text-sm file:font-medium file:text-accent hover:file:bg-accent-soft"
            />
            {fileName && (
              <p className="mt-2 text-sm text-success-fg">
                <Icons.CheckCircle className="mr-1 inline h-4 w-4" />
                {fileName} loaded
              </p>
            )}
            <div className="mt-6 flex justify-between">
              <button
                type="button"
                onClick={() => setStep('source')}
                className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-muted hover:bg-hover"
              >
                Back
              </button>
              <button
                type="button"
                disabled={!fileData || isRunning}
                onClick={handlePreview}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {isRunning ? 'Previewing...' : 'Preview Import (Dry Run)'}
              </button>
            </div>
          </div>
        )}

        {step === 'preview' && dryRunReport && (
          <div>
            <h2 className="mb-3 text-lg font-semibold text-fg">Preview — nothing has been imported yet</h2>
            <MigrationReportSummary report={dryRunReport} />
            <div className="mt-6 flex justify-between">
              <button
                type="button"
                onClick={() => setStep('upload')}
                className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-muted hover:bg-hover"
              >
                Back
              </button>
              <button
                type="button"
                disabled={isRunning}
                onClick={handleImport}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {isRunning ? 'Importing...' : 'Run Import'}
              </button>
            </div>
          </div>
        )}

        {step === 'done' && finalReport && (
          <div>
            <h2 className="mb-3 text-lg font-semibold text-fg">Import complete</h2>
            <MigrationReportSummary report={finalReport} />
            <div className="mt-6 flex justify-between">
              <button
                type="button"
                onClick={startOver}
                className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-muted hover:bg-hover"
              >
                Import Another File
              </button>
              <button
                type="button"
                onClick={() => navigate(`/console/realms/${name}/users`)}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
              >
                View Users
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
