import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getFlowBindings,
  updateFlowBindings,
  getFlowValidationErrors,
  type AuthFlow,
  type FlowBindings,
  type FlowValidationError,
  type UpdateFlowBindingsPayload,
} from '../../api/authFlows';
import { getErrorMessage } from '../../utils/getErrorMessage';
import { useCanWriteRealm } from '../../hooks/usePermissions';

interface FlowBindingsPanelProps {
  realmName: string;
  flows: AuthFlow[];
}

interface Draft {
  browserFlowId: string | null;
  authFlowsEnabled: boolean;
  /** clientId -> flow id ('' = no override) */
  overrides: Record<string, string>;
}

function toDraft(b: FlowBindings): Draft {
  return {
    browserFlowId: b.browserFlowId,
    authFlowsEnabled: b.authFlowsEnabled,
    overrides: Object.fromEntries(b.clients.map((c) => [c.clientId, c.authFlowId ?? ''])),
  };
}

/**
 * Map a server error path back to the field it belongs to:
 * `browserFlowId`, or a client's OAuth client_id.
 */
function errorTarget(
  e: FlowValidationError,
  submittedClients: string[],
): { kind: 'realm' } | { kind: 'client'; clientId: string } | { kind: 'other' } {
  if (e.path.startsWith('browserFlowId')) return { kind: 'realm' };
  const byIndex = /^clients\[(\d+)\]/.exec(e.path);
  if (byIndex) {
    const clientId = submittedClients[Number(byIndex[1])];
    if (clientId !== undefined) return { kind: 'client', clientId };
  }
  const byId = /^clients\[clientId=([^\]]+)\]/.exec(e.path);
  if (byId) return { kind: 'client', clientId: byId[1] };
  return { kind: 'other' };
}

function ErrorList({ errors }: { errors: FlowValidationError[] }) {
  if (errors.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-danger" role="alert">
      {errors.map((e, i) => (
        <li key={`${e.path}-${e.code}-${i}`}>
          {e.message}
          {e.flowErrors && e.flowErrors.length > 1 && (
            <ul className="ml-4 list-disc">
              {e.flowErrors.slice(1).map((fe, j) => (
                <li key={`${fe.path}-${j}`}>
                  <span className="font-mono">{fe.path}</span>: {fe.message}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Realm flow bindings: the realm browser flow, the per-realm enable switch
 * and per-client overrides. Bindings are stored now; login only reads them
 * once the server runs with AUTH_FLOW_RUNTIME_ENABLED.
 */
export default function FlowBindingsPanel({ realmName, flows }: FlowBindingsPanelProps) {
  const canWrite = useCanWriteRealm(realmName);
  const qc = useQueryClient();
  const { data: bindings, isLoading, error } = useQuery({
    queryKey: ['auth-flow-bindings', realmName],
    queryFn: () => getFlowBindings(realmName),
  });

  const [draft, setDraft] = useState<Draft | null>(null);
  const [seeded, setSeeded] = useState<FlowBindings | undefined>(undefined);
  if (bindings && bindings !== seeded) {
    setSeeded(bindings);
    setDraft(toDraft(bindings));
  }

  const [errors, setErrors] = useState<FlowValidationError[]>([]);
  const [submittedClients, setSubmittedClients] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const saveMutation = useMutation({
    mutationFn: (payload: UpdateFlowBindingsPayload) => updateFlowBindings(realmName, payload),
    onSuccess: (updated) => {
      qc.setQueryData(['auth-flow-bindings', realmName], updated);
      setErrors([]);
      setSaveError(null);
      setSaved(true);
    },
    onError: (err) => {
      const list = getFlowValidationErrors(err);
      setErrors(list);
      setSaveError(list.length ? null : getErrorMessage(err));
    },
  });

  if (isLoading || !draft || !bindings) {
    return error ? (
      <div className="mb-6 rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
        Failed to load flow bindings.
      </div>
    ) : (
      <div className="mb-6 text-sm text-subtle">Loading flow bindings...</div>
    );
  }

  const original = toDraft(bindings);
  const changedClients = bindings.clients.filter(
    (c) => (draft.overrides[c.clientId] ?? '') !== (original.overrides[c.clientId] ?? ''),
  );
  const isDirty =
    draft.browserFlowId !== original.browserFlowId ||
    draft.authFlowsEnabled !== original.authFlowsEnabled ||
    changedClients.length > 0;

  function update(next: Partial<Draft>) {
    setDraft((d) => (d ? { ...d, ...next } : d));
    setSaved(false);
  }

  function handleSave() {
    if (!draft || !bindings) return;
    const payload: UpdateFlowBindingsPayload = {};
    if (draft.browserFlowId !== original.browserFlowId) payload.browserFlowId = draft.browserFlowId;
    if (draft.authFlowsEnabled !== original.authFlowsEnabled) {
      payload.authFlowsEnabled = draft.authFlowsEnabled;
    }
    if (changedClients.length > 0) {
      payload.clients = changedClients.map((c) => ({
        clientId: c.clientId,
        authFlowId: draft.overrides[c.clientId] || null,
      }));
    }
    setSubmittedClients(payload.clients?.map((c) => c.clientId) ?? []);
    setErrors([]);
    setSaveError(null);
    saveMutation.mutate(payload);
  }

  const realmErrors = errors.filter((e) => errorTarget(e, submittedClients).kind === 'realm');
  const otherErrors = errors.filter((e) => errorTarget(e, submittedClients).kind === 'other');
  const clientErrors = (clientId: string) =>
    errors.filter((e) => {
      const t = errorTarget(e, submittedClients);
      return t.kind === 'client' && t.clientId === clientId;
    });

  const selectClass =
    'w-full rounded-md border border-line-strong px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent';

  return (
    <section
      aria-labelledby="flow-bindings-heading"
      className="mb-6 rounded-lg border border-line bg-surface p-5 shadow-sm"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 id="flow-bindings-heading" className="text-lg font-semibold text-fg">
            Flow bindings
          </h2>
          <p className="mt-1 text-sm text-subtle">
            Choose which flow runs at login for this realm, and override it per client.
          </p>
          {!canWrite && (
            <p className="mt-1 text-xs text-subtle">Read-only: your admin role can't change this realm.</p>
          )}
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={!canWrite || !isDirty || saveMutation.isPending}
          className="shrink-0 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {saveMutation.isPending ? 'Saving...' : 'Save bindings'}
        </button>
      </div>

      {bindings.runtimeEnabled ? (
        <div
          data-testid="runtime-active-note"
          className="mb-4 rounded-md border border-info-soft bg-info-soft p-3 text-sm text-info-fg"
        >
          <strong>Flow runtime active.</strong> With <em>Use custom flows in this realm</em> on,
          sign-ins run the bound flow; a binding to a missing or invalid flow fails closed with an
          error page. With it off, the built-in login is used.
        </div>
      ) : (
        <div
          data-testid="runtime-inactive-note"
          className="mb-4 rounded-md border border-warning-soft bg-warning-soft p-3 text-sm text-warning-fg"
        >
          <strong>Flow runtime off.</strong> This server runs without{' '}
          <code className="font-mono">AUTH_FLOW_RUNTIME_ENABLED=true</code>, so login ignores these
          bindings and uses the built-in login. You can configure and validate bindings now; they
          take effect once the server is started with that setting.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="realm-browser-flow" className="mb-1 block text-xs font-medium text-muted">
            Realm browser flow
          </label>
          <select
            id="realm-browser-flow"
            value={draft.browserFlowId ?? ''}
            onChange={(e) => update({ browserFlowId: e.target.value || null })}
            className={selectClass}
            aria-invalid={realmErrors.length > 0}
          >
            <option value="">None (built-in login)</option>
            {flows.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <ErrorList errors={realmErrors} />
        </div>

        <div>
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-muted select-none">
            <input
              type="checkbox"
              checked={draft.authFlowsEnabled}
              onChange={(e) => update({ authFlowsEnabled: e.target.checked })}
              className="rounded border-line-strong text-accent focus:ring-accent"
            />
            Use custom flows in this realm
          </label>
          <p className="mt-1 text-xs text-subtle">
            When off, every login in this realm uses the built-in login, even if flows are bound.
            Turning it on validates every bound flow first.
          </p>
        </div>
      </div>

      <div className="mt-5">
        <h3 className="mb-2 text-sm font-semibold text-fg">Per-client overrides</h3>
        {bindings.clients.length === 0 ? (
          <p className="text-sm text-subtle">This realm has no clients.</p>
        ) : (
          <table className="min-w-full divide-y divide-line text-sm">
            <thead>
              <tr>
                <th className="py-2 pr-4 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                  Client
                </th>
                <th className="py-2 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                  Flow
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {bindings.clients.map((c) => {
                const ce = clientErrors(c.clientId);
                return (
                  <tr key={c.id}>
                    <td className="py-2 pr-4 align-top">
                      <span className="font-mono text-fg">{c.clientId}</span>
                      {c.name && <span className="ml-2 text-subtle">{c.name}</span>}
                    </td>
                    <td className="py-2 align-top">
                      <select
                        aria-label={`Flow for client ${c.clientId}`}
                        value={draft.overrides[c.clientId] ?? ''}
                        onChange={(e) =>
                          update({
                            overrides: { ...draft.overrides, [c.clientId]: e.target.value },
                          })
                        }
                        className={selectClass}
                        aria-invalid={ce.length > 0}
                      >
                        <option value="">Realm browser flow</option>
                        {flows.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                      <ErrorList errors={ce} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <ErrorList errors={otherErrors} />
      {saveError && <p className="mt-3 text-sm text-danger">{saveError}</p>}
      {saved && !isDirty && <p className="mt-3 text-sm text-success-fg">Bindings saved.</p>}
    </section>
  );
}
