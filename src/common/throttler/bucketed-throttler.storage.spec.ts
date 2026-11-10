import { ThrottlerStorageService } from '@nestjs/throttler';
import { BucketedThrottlerStorage } from './bucketed-throttler.storage.js';

const TTL = 60_000;

describe('BucketedThrottlerStorage', () => {
  let storage: BucketedThrottlerStorage;
  const T0 = Date.UTC(2026, 0, 1, 0, 0, 0); // on a second boundary

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(T0);
    storage = new BucketedThrottlerStorage();
  });

  afterEach(() => {
    storage.shutdown();
    jest.useRealTimers();
  });

  const hit = (key = 'ip', limit = 3, block = TTL) =>
    storage.increment(key, TTL, limit, block, 'default');

  it('allows up to the limit, then blocks for the block duration', async () => {
    for (let i = 1; i <= 3; i++) {
      const r = await hit();
      expect(r).toMatchObject({ totalHits: i, isBlocked: false });
    }
    const over = await hit();
    expect(over.isBlocked).toBe(true);
    expect(over.timeToBlockExpire).toBe(60);

    // Still blocked, and blocked requests are not counted.
    jest.setSystemTime(T0 + 30_000);
    expect(await hit()).toMatchObject({ isBlocked: true, totalHits: 4 });

    // After the block: a fresh start, with this request counted.
    jest.setSystemTime(T0 + 60_001);
    expect(await hit()).toMatchObject({ isBlocked: false, totalHits: 1 });
  });

  it('lets hits leave the window as it slides, never sooner than the library', async () => {
    await hit('k', 100);
    jest.setSystemTime(T0 + 30_000);
    await hit('k', 100);
    // The library would drop the first hit at exactly T0 + 60 s; this keeps
    // it until the end of its second.
    jest.setSystemTime(T0 + 60_500);
    expect((await hit('k', 100)).totalHits).toBe(3);
    jest.setSystemTime(T0 + 61_000);
    expect((await hit('k', 100)).totalHits).toBe(3); // first gone, this one in
  });

  it('counts keys and throttler names apart', async () => {
    await hit('a');
    await hit('a');
    expect((await hit('b')).totalHits).toBe(1);
    expect((await storage.increment('a', TTL, 3, TTL, 'other')).totalHits).toBe(
      1,
    );
  });

  it('without a block duration, refuses over the limit and does not count it', async () => {
    for (let i = 0; i < 3; i++) await hit('n', 3, 0);
    const r = await hit('n', 3, 0);
    expect(r).toMatchObject({ isBlocked: true, totalHits: 4 });
    expect(r.timeToBlockExpire).toBeGreaterThan(0);
    jest.setSystemTime(T0 + 61_000);
    expect(await hit('n', 3, 0)).toMatchObject({
      isBlocked: false,
      totalHits: 1,
    });
  });

  it('agrees with the library storage away from the limit, and is never looser', async () => {
    // Under the limit, then well over it, then under again, for a limit of
    // 40 per 10 s. A hit stays up to a second longer here, so this may
    // block a request or two sooner than the library, never later, and
    // never allow more over the run.
    const lib = new ThrottlerStorageService();
    const ours = new BucketedThrottlerStorage();
    const phases = [
      { until: 15_000, every: 400 }, // 25 per 10 s
      { until: 25_000, every: 100 }, // 100 per 10 s
      { until: 60_000, every: 400 },
    ];
    let t = 0;
    let allowedLib = 0;
    let allowedOurs = 0;
    let disagreements = 0;
    for (const phase of phases) {
      for (; t < phase.until; t += phase.every) {
        jest.setSystemTime(T0 + t);
        const a = await lib.increment('k', 10_000, 40, 10_000, 'default');
        const b = await ours.increment('k', 10_000, 40, 10_000, 'default');
        if (!a.isBlocked) allowedLib++;
        if (!b.isBlocked) allowedOurs++;
        if (a.isBlocked !== b.isBlocked) disagreements++;
      }
    }
    lib.onApplicationShutdown();
    ours.shutdown();
    // Never looser, and stricter by at most one second of hits at the
    // fastest rate above (10 per second): the most a whole-second bucket
    // can hold past the library's exact expiry.
    expect(allowedOurs).toBeLessThanOrEqual(allowedLib);
    expect(allowedLib - allowedOurs).toBeLessThanOrEqual(10);
    expect(disagreements).toBeLessThanOrEqual(10);
    expect(allowedLib).toBeLessThan(t / 100); // the limit was reached
  });

  it('costs the same per request however many hits the key has', async () => {
    jest.useRealTimers();
    const busy = new BucketedThrottlerStorage();
    for (let i = 0; i < 200_000; i++) {
      await busy.increment('ip', TTL, 1e9, TTL, 'default');
    }
    const time = async (s: BucketedThrottlerStorage, key: string) => {
      const start = process.hrtime.bigint();
      for (let i = 0; i < 5_000; i++) {
        await s.increment(key, TTL, 1e9, TTL, 'default');
      }
      return Number(process.hrtime.bigint() - start);
    };
    const crowded = await time(busy, 'ip');
    const quiet = await time(busy, 'fresh');
    busy.shutdown();
    // The library's storage is hundreds of times slower here; allow noise.
    expect(crowded).toBeLessThan(quiet * 5);
  });
});
