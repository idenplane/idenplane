/**
 * Process entry point. Runs Idenplane in this process, or as a primary that
 * forks one worker per usable CPU so the server uses the whole machine.
 *
 *   WEB_CONCURRENCY unset or 1   one process (the default): main.js here
 *   WEB_CONCURRENCY=auto         one worker per CPU this container may use
 *   WEB_CONCURRENCY=<n>          n workers
 *
 * The primary never loads the application (no AppModule, no Nest): it forks
 * main.js, restarts a worker that dies, fails the container if workers keep
 * dying at startup (a bad configuration must stop the container, not spin),
 * forwards SIGTERM/SIGINT for a graceful stop, and answers the workers'
 * requests for cluster-wide metrics. Workers share the listening port; the
 * shared state they need between them goes through PostgreSQL (see
 * CacheBusService and LeaderService), not through this process.
 */
import cluster, { type Worker } from 'node:cluster';
import { join } from 'node:path';
import { effectiveCpuCount } from './common/utils/cpu-count.util.js';

/** A worker that dies sooner than this after starting counts as a failed start. */
const FAST_EXIT_MS = 10_000;
/** This many failed starts in a row stop the container. */
const MAX_FAST_EXITS = 5;
/** How long a graceful stop may take before workers are killed. */
const STOP_TIMEOUT_MS = 30_000;

function requestedWorkers(): number {
  const raw = (process.env['WEB_CONCURRENCY'] ?? '1').trim().toLowerCase();
  if (raw === 'auto') return effectiveCpuCount();
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    console.error(
      `WEB_CONCURRENCY must be "auto" or a positive integer, not "${raw}"`,
    );
    process.exit(1);
  }
  return n;
}

function runPrimary(workers: number): void {
  const log = (msg: string) => console.log(`[cluster] ${msg}`);
  let stopping = false;
  let fastExits = 0;
  const startedAt = new Map<number, number>();
  const indexOf = new Map<number, number>();

  cluster.setupPrimary({ exec: join(__dirname, 'main.js') });

  const fork = (index: number): Worker => {
    const worker = cluster.fork({
      IDENPLANE_WORKERS: String(workers),
      IDENPLANE_WORKER_INDEX: String(index),
    });
    startedAt.set(worker.id, Date.now());
    indexOf.set(worker.id, index);
    return worker;
  };

  cluster.on('online', (worker) => {
    // Survived the window: the configuration is good.
    setTimeout(() => {
      if (!worker.isDead()) fastExits = 0;
    }, FAST_EXIT_MS).unref();
  });

  cluster.on('exit', (worker, code, signal) => {
    const index = indexOf.get(worker.id) ?? 0;
    const lived = Date.now() - (startedAt.get(worker.id) ?? 0);
    startedAt.delete(worker.id);
    indexOf.delete(worker.id);
    if (stopping) return;

    log(
      `worker ${index} (pid ${worker.process.pid}) exited ` +
        `(${signal ?? `code ${code}`}) after ${Math.round(lived / 1000)} s`,
    );
    if (lived < FAST_EXIT_MS) {
      fastExits++;
      if (fastExits >= MAX_FAST_EXITS) {
        console.error(
          `[cluster] workers failed to start ${fastExits} times in a row; ` +
            'stopping. Their output above says why.',
        );
        stopping = true;
        for (const w of Object.values(cluster.workers ?? {}))
          w?.kill('SIGKILL');
        process.exit(1);
      }
    }
    const delay = Math.min(1000 * 2 ** Math.max(0, fastExits - 1), 15_000);
    setTimeout(() => {
      if (!stopping) fork(index);
    }, delay);
  });

  const stop = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    log(
      `${signal}: stopping ${Object.keys(cluster.workers ?? {}).length} worker(s)`,
    );
    for (const w of Object.values(cluster.workers ?? {}))
      w?.process.kill(signal);
    const deadline = setTimeout(() => {
      log('workers did not stop in time; killing them');
      for (const w of Object.values(cluster.workers ?? {})) w?.kill('SIGKILL');
      process.exit(1);
    }, STOP_TIMEOUT_MS);
    deadline.unref();
    const check = setInterval(() => {
      if (Object.keys(cluster.workers ?? {}).length === 0) {
        clearInterval(check);
        process.exit(0);
      }
    }, 100);
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  // Cluster-wide metrics for a worker serving /admin/metrics: prom-client
  // gathers every worker's registry (each worker registers its own).
  cluster.on('message', (worker, message: unknown) => {
    const m = message as { type?: string; id?: string };
    if (m?.type !== 'idenplane:metrics:request') return;
    void (async () => {
      try {
        const { AggregatorRegistry } = await import('prom-client');
        const aggregator = new AggregatorRegistry();
        const body = await aggregator.clusterMetrics();
        worker.send({
          type: 'idenplane:metrics:response',
          id: m.id,
          body,
          contentType: aggregator.contentType,
        });
      } catch (err) {
        worker.send({
          type: 'idenplane:metrics:response',
          id: m.id,
          error: String(err),
        });
      }
    })();
  });

  log(`starting ${workers} worker(s)`);
  for (let i = 0; i < workers; i++) fork(i);
}

const workers = requestedWorkers();
if (workers <= 1) {
  // One process: exactly what `node dist/main.js` does.
  void import('./main.js');
} else if (cluster.isPrimary) {
  runPrimary(workers);
}
