import { readFileSync } from 'fs';
import { availableParallelism } from 'os';

/**
 * The number of CPUs this process can actually use.
 *
 * `availableParallelism()` honours a cpuset (`docker --cpuset-cpus`) but not
 * a CPU quota, which is how Kubernetes enforces `resources.limits.cpu` and
 * Docker `--cpus`: a pod limited to one CPU on a 64-core node would see 64.
 * The quota is read from the cgroup (v2 `cpu.max`, else v1
 * `cpu.cfs_quota_us` / `cpu.cfs_period_us`) and rounded up; the smaller of
 * the two counts wins. At least 1.
 */
export function effectiveCpuCount(): number {
  const parallelism = Math.max(1, availableParallelism());
  const quota = cgroupCpuQuota();
  return quota === null
    ? parallelism
    : Math.max(1, Math.min(parallelism, quota));
}

function cgroupCpuQuota(): number | null {
  return cpusFromCgroup(
    readText('/sys/fs/cgroup/cpu.max'),
    readText('/sys/fs/cgroup/cpu/cpu.cfs_quota_us'),
    readText('/sys/fs/cgroup/cpu/cpu.cfs_period_us'),
  );
}

/**
 * The CPU quota in whole CPUs (rounded up) from the cgroup files' contents,
 * or null if there is none: cgroup v2 `cpu.max` ("<quota> <period>" or
 * "max <period>"), else v1, where a quota of -1 means unlimited.
 */
export function cpusFromCgroup(
  v2CpuMax: string | null,
  v1Quota: string | null,
  v1Period: string | null,
): number | null {
  if (v2CpuMax !== null) {
    const [quota, period] = v2CpuMax.trim().split(/\s+/);
    if (quota === 'max') return null;
    return toCpus(Number(quota), Number(period));
  }
  if (v1Quota === null || v1Period === null) return null;
  return toCpus(Number(v1Quota), Number(v1Period));
}

function toCpus(quota: number, period: number): number | null {
  if (!Number.isFinite(quota) || !Number.isFinite(period)) return null;
  if (quota <= 0 || period <= 0) return null;
  return Math.ceil(quota / period);
}

function readText(path: string): string | null {
  try {
    // A string or nothing: anything else (a test's stub of fs) is no answer.
    const text: unknown = readFileSync(path, 'utf8');
    return typeof text === 'string' ? text : null;
  } catch {
    return null;
  }
}

/**
 * How many processes share this container's CPUs and connection budget:
 * the cluster workers the primary started (cluster.ts sets the variable),
 * or 1 for a single process.
 */
export function workerCount(): number {
  const n = Number(process.env['IDENPLANE_WORKERS'] ?? '1');
  return Number.isInteger(n) && n > 0 ? n : 1;
}
