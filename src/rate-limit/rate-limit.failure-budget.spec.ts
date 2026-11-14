import { RateLimitService } from './rate-limit.service.js';
import { createMockPrismaService } from '../prisma/prisma.mock.js';

/** A database counter keyed like rate_limit_entries, enough for the portable path. */
function databaseCounter() {
  const store = new Map<
    string,
    {
      minuteCount: number;
      minuteWindowStart: Date;
      hourCount: number;
      hourWindowStart: Date;
    }
  >();
  const prisma = createMockPrismaService();
  prisma.rateLimitEntry.updateMany = jest.fn().mockResolvedValue({ count: 0 });
  prisma.rateLimitEntry.upsert = jest.fn(
    async (args: { where: { key: string }; create: any }) => {
      const entry = store.get(args.where.key);
      if (!entry) store.set(args.where.key, { ...args.create });
      else {
        entry.minuteCount += 1;
        entry.hourCount += 1;
      }
      return { ...store.get(args.where.key)! };
    },
  );
  prisma.rateLimitEntry.findUnique = jest.fn(
    async (args: { where: { key: string } }) =>
      store.get(args.where.key) ?? null,
  );
  return { prisma, store };
}

describe('RateLimitService failure budget', () => {
  const databaseUrl = process.env['DATABASE_URL'];
  afterAll(() => {
    process.env['DATABASE_URL'] = databaseUrl;
  });

  it('counts failures in the database without Redis, and peeking never counts', async () => {
    process.env['DATABASE_URL'] = 'file:./unit-test.db';
    const { prisma, store } = databaseCounter();
    const service = new RateLimitService(
      prisma as any,
      { isAvailable: () => false } as any,
      {} as any,
    );

    for (let i = 0; i < 3; i++) {
      expect((await service.failureBudget('k', 3)).exhausted).toBe(false);
      await service.recordFailure('k');
    }
    const spent = await service.failureBudget('k', 3);
    expect(spent.exhausted).toBe(true);
    expect(spent.retryAfter).toBeGreaterThanOrEqual(1);
    expect(spent.retryAfter).toBeLessThanOrEqual(60);
    expect(store.get('fail:k')!.minuteCount).toBe(3);
    expect((await service.failureBudget('other', 3)).exhausted).toBe(false);

    // A window that has ended no longer counts.
    store.get('fail:k')!.minuteWindowStart = new Date(Date.now() - 61_000);
    expect((await service.failureBudget('k', 3)).exhausted).toBe(false);
  });

  it('counts failures in Redis when it is available', async () => {
    const counters = new Map<string, number>();
    const redis = {
      isAvailable: () => true,
      get: jest.fn(async (key: string) =>
        counters.has(key) ? String(counters.get(key)) : null,
      ),
      incr: jest.fn(async (key: string) => {
        counters.set(key, (counters.get(key) ?? 0) + 1);
        return counters.get(key)!;
      }),
    };
    const { prisma } = databaseCounter();
    const service = new RateLimitService(
      prisma as any,
      redis as any,
      {} as any,
    );
    await service.recordFailure('k');
    await service.recordFailure('k');
    expect((await service.failureBudget('k', 2)).exhausted).toBe(true);
    expect((await service.failureBudget('k', 3)).exhausted).toBe(false);
    expect(redis.incr).toHaveBeenCalledWith(
      expect.stringMatching(/^rl:m:fail:k:\d+$/),
      120,
    );
    expect(prisma.rateLimitEntry.upsert).not.toHaveBeenCalled();
  });

  it('falls back to the database when Redis fails', async () => {
    process.env['DATABASE_URL'] = 'file:./unit-test.db';
    const { prisma, store } = databaseCounter();
    const redis = {
      isAvailable: () => true,
      get: jest.fn().mockRejectedValue(new Error('down')),
      incr: jest.fn().mockRejectedValue(new Error('down')),
    };
    const service = new RateLimitService(
      prisma as any,
      redis as any,
      {} as any,
    );
    await service.recordFailure('k');
    expect(store.get('fail:k')!.minuteCount).toBe(1);
    expect((await service.failureBudget('k', 1)).exhausted).toBe(true);
  });
});
