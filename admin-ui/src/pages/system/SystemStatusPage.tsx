import { useQuery } from '@tanstack/react-query';
import { getHealthStatus, type HealthStatus } from '../../api/stats';
import { Card, Badge, Icons } from '../../components/ui';

// ─── Component status row ─────────────────────────────────────────────────────

interface ComponentRowProps {
  name: string;
  status: string;
  message?: string;
}

function ComponentRow({ name, status, message }: ComponentRowProps) {
  const isUp = status === 'up' || status === 'ok';
  return (
    <div className="flex items-center justify-between px-6 py-4">
      <div className="min-w-0">
        <span className="text-sm font-medium capitalize text-fg">{name.replace(/_/g, ' ')}</span>
        {message && <p className="mt-0.5 truncate text-xs text-muted">{message}</p>}
      </div>
      <Badge variant={isUp ? 'success' : 'danger'} dot>
        {status}
      </Badge>
    </div>
  );
}

// ─── Overall status banner ────────────────────────────────────────────────────

function OverallStatusBanner({ health }: { health: HealthStatus }) {
  const isHealthy = health.status === 'ok';
  return (
    <Card padding="sm" className={isHealthy ? 'border-success-soft bg-success-soft' : 'border-danger-soft bg-danger-soft'}>
      <div className="flex items-center gap-3">
        <div className={`h-3 w-3 rounded-full ${isHealthy ? 'bg-success' : 'bg-danger'}`} />
        <Icons.Server
          className={`h-5 w-5 ${isHealthy ? 'text-success-fg' : 'text-danger-fg'}`}
        />
        <h2 className={`text-base font-semibold ${isHealthy ? 'text-success-fg' : 'text-danger-fg'}`}>
          {isHealthy ? 'All Systems Operational' : 'Service Degraded'}
        </h2>
      </div>
    </Card>
  );
}

// ─── Component details panel ──────────────────────────────────────────────────

function ComponentDetails({ health }: { health: HealthStatus }) {
  // Terminus merges healthy indicators into `info` and unhealthy ones into `error`.
  // We want to show all of them together.
  const components: Record<string, { status: string; message?: string }> = {
    ...(health.info ?? {}),
    ...(health.error ?? {}),
  };

  const entries = Object.entries(components);
  if (entries.length === 0) return null;

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="border-b border-line px-6 py-4">
        <h3 className="text-sm font-semibold text-fg">Component Status</h3>
      </div>
      <div className="divide-y divide-line">
        {entries.map(([name, detail]) => (
          <ComponentRow
            key={name}
            name={name}
            status={detail.status}
            message={detail.message}
          />
        ))}
      </div>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SystemStatusPage() {
  const {
    data: health,
    isLoading,
    error,
    refetch,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['system-health'],
    queryFn: getHealthStatus,
    refetchInterval: 30_000,
    retry: false,
  });

  return (
    <div>
      {/* Page header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-fg">System Status</h1>
          <p className="mt-1 text-sm text-muted">
            Health and operational status of the Idenplane server
          </p>
        </div>
        <button
          onClick={() => void refetch()}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3.5 text-[13.5px] font-medium text-fg shadow-soft transition-all duration-150 hover:border-subtle hover:bg-hover focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
        >
          <Icons.Refresh className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-muted">Checking system health&hellip;</div>
        </div>
      )}

      {/* Error — server unreachable */}
      {error && !isLoading && (
        <Card padding="sm" className="border-danger-soft bg-danger-soft">
          <div className="flex items-start gap-3">
            <Icons.Alert className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
            <p className="text-sm text-danger-fg">
              Unable to reach the health endpoint. The server may be unavailable.
            </p>
          </div>
        </Card>
      )}

      {/* Data */}
      {health && (
        <div className="space-y-6">
          <OverallStatusBanner health={health} />
          <ComponentDetails health={health} />

          {dataUpdatedAt > 0 && (
            <p className="text-right text-xs text-subtle" aria-live="polite">
              Last checked{' '}
              {new Date(dataUpdatedAt).toLocaleTimeString()}&nbsp;&middot;&nbsp;Auto-refreshes
              every 30 seconds
            </p>
          )}
        </div>
      )}
    </div>
  );
}
