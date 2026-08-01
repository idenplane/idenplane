import { cpus } from 'os';

/**
 * `pg`'s own default pool size is 10 connections regardless of instance
 * size, which is too small for typical production concurrency. Sizing to
 * available CPU cores is a common heuristic for connection-pool capacity.
 *
 * Caveat for multi-instance deployments: this sizes the pool per process.
 * With N replicas, total connections against Postgres are roughly
 * N * DATABASE_POOL_MAX — tune DATABASE_POOL_MAX down (or raise Postgres's
 * max_connections) if running many replicas on multi-core hosts.
 */
const DEFAULT_POOL_MAX = cpus().length * 2 + 1;
const DEFAULT_POOL_MIN = 2;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

/**
 * Builds a pool config for `PrismaPg` (structurally a `pg.PoolConfig`),
 * with pool size explicitly tuned (rather than left at `pg`'s bare
 * default) and overridable via env vars so operators can adjust for their
 * instance size / replica count.
 */
export function getPgPoolConfig(connectionString: string | undefined) {
  return {
    connectionString,
    max: parseInt(
      process.env['DATABASE_POOL_MAX'] ?? String(DEFAULT_POOL_MAX),
      10,
    ),
    min: parseInt(
      process.env['DATABASE_POOL_MIN'] ?? String(DEFAULT_POOL_MIN),
      10,
    ),
    idleTimeoutMillis: parseInt(
      process.env['DATABASE_POOL_IDLE_TIMEOUT_MS'] ??
        String(DEFAULT_IDLE_TIMEOUT_MS),
      10,
    ),
  };
}
