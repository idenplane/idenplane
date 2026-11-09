import type { ThrottlerStorage } from '@nestjs/throttler';

type ThrottlerStorageRecord = Awaited<
  ReturnType<ThrottlerStorage['increment']>
>;

/** Hits are counted per second of arrival. */
const BUCKET_MS = 1_000;
const SWEEP_INTERVAL_MS = 60_000;

/** The hits of one throttler on one key, per second, oldest first. */
interface Window {
  ttl: number;
  /** Bucket start times (ms), ascending, and the hits in each. */
  starts: number[];
  counts: number[];
  total: number;
}

interface KeyRecord {
  expiresAt: number;
  isBlocked: boolean;
  blockExpiresAt: number;
  windows: Map<string, Window>;
}

/**
 * The in-memory throttler storage, with the hits counted per second instead
 * of one timestamp per hit.
 *
 * @nestjs/throttler's own storage keeps every hit's expiry in an array and
 * filters the whole array on every request. Its cost per request grows
 * with the hits the key already has in the window, so a busy client, or
 * every client behind one proxy address, makes each request slower than
 * the last: with THROTTLE_LIMIT raised to serve real traffic, a request can
 * cost a millisecond in the throttler alone. Here a window holds at most
 * ttl / 1 s + 1 counters, whatever the traffic.
 *
 * The decisions are the library's, from the same inputs: same limit, block
 * and reset rules, same record per key. The one difference is that a hit
 * leaves the window when the whole second it arrived in has, up to one
 * second after the library would let it go, so the limit is never looser.
 */
export class BucketedThrottlerStorage implements ThrottlerStorage {
  private readonly records = new Map<string, KeyRecord>();
  private sweepTimer: NodeJS.Timeout | null = null;

  increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    return Promise.resolve(
      this.incrementNow(key, ttl, limit, blockDuration, throttlerName),
    );
  }

  /** Stops the periodic sweep and forgets every key. */
  shutdown(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    this.records.clear();
  }

  private incrementNow(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): ThrottlerStorageRecord {
    this.ensureSweep();
    const now = Date.now();

    let record = this.records.get(key);
    if (!record) {
      record = {
        expiresAt: now + ttl,
        isBlocked: false,
        blockExpiresAt: 0,
        windows: new Map(),
      };
      this.records.set(key, record);
    }
    let window = record.windows.get(throttlerName);
    if (!window) {
      window = { ttl, starts: [], counts: [], total: 0 };
      record.windows.set(throttlerName, window);
    }
    window.ttl = ttl;
    prune(window, now);

    let timeToExpire = seconds(record.expiresAt - now);
    if (timeToExpire <= 0) {
      record.expiresAt = now + ttl;
      timeToExpire = seconds(record.expiresAt - now);
    }

    if (blockDuration <= 0) {
      // Over the limit, the request is refused and not counted.
      const isBlocked = window.total >= limit;
      if (!isBlocked) addHit(window, now);
      return {
        totalHits: window.total + (isBlocked ? 1 : 0),
        timeToExpire,
        isBlocked,
        timeToBlockExpire: isBlocked ? seconds(oldestExpiry(window) - now) : 0,
      };
    }

    if (!record.isBlocked) addHit(window, now);
    if (window.total > limit && !record.isBlocked) {
      record.isBlocked = true;
      record.blockExpiresAt = now + blockDuration;
    }
    const timeToBlockExpire = seconds(record.blockExpiresAt - now);
    if (timeToBlockExpire <= 0 && record.isBlocked) {
      // The block has run out: start over with this request.
      record.isBlocked = false;
      clear(window);
      addHit(window, now);
    }
    return {
      totalHits: window.total,
      timeToExpire,
      isBlocked: record.isBlocked,
      timeToBlockExpire,
    };
  }

  private ensureSweep(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref();
  }

  /** Forgets keys with no live hits, no live block and an expired record. */
  private sweep(now = Date.now()): void {
    for (const [key, record] of this.records) {
      if (record.isBlocked && record.blockExpiresAt > now) continue;
      if (record.expiresAt > now) continue;
      let live = false;
      for (const window of record.windows.values()) {
        prune(window, now);
        if (window.total > 0) live = true;
      }
      if (!live) this.records.delete(key);
    }
  }
}

const seconds = (ms: number) => Math.ceil(ms / 1000);

/** When the oldest bucket's hits leave the window. */
const oldestExpiry = (w: Window) =>
  w.starts.length ? w.starts[0] + BUCKET_MS + w.ttl : 0;

function addHit(w: Window, now: number): void {
  const start = now - (now % BUCKET_MS);
  const last = w.starts.length - 1;
  if (last >= 0 && w.starts[last] === start) {
    w.counts[last]++;
  } else {
    w.starts.push(start);
    w.counts.push(1);
  }
  w.total++;
}

/** Drops the buckets whose every hit has left the window. */
function prune(w: Window, now: number): void {
  let drop = 0;
  while (drop < w.starts.length && w.starts[drop] + BUCKET_MS + w.ttl <= now) {
    w.total -= w.counts[drop];
    drop++;
  }
  if (drop > 0) {
    w.starts.splice(0, drop);
    w.counts.splice(0, drop);
  }
}

function clear(w: Window): void {
  w.starts.length = 0;
  w.counts.length = 0;
  w.total = 0;
}
