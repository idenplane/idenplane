import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from './setup';
import { RateLimitService } from '../src/rate-limit/rate-limit.service';

/**
 * The database-backed rate-limit counter (no Redis) against PostgreSQL:
 * counting and restarting a window are one statement, so concurrent
 * requests are neither lost nor counted twice.
 */
describe('Rate-limit window on the database (e2e)', () => {
  let app: INestApplication;
  let ctx: TestContext;
  let service: RateLimitService;
  let realmId: string;
  const REALM = 'e2e-rate-limit-window';
  const sql = (q: string) => ctx.prisma.$executeRawUnsafe(q);
  const row = async (clientId: string) =>
    ctx.prisma.rateLimitEntry.findUniqueOrThrow({
      where: { key: `client:${realmId}:${clientId}` },
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    service = app.get(RateLimitService);
    realmId = (await ctx.seedTestRealm(REALM)).realm.id;
    await sql(
      `UPDATE realms SET rate_limit_enabled = true,
         client_rate_limit_per_minute = 1000, client_rate_limit_per_hour = 100000
       WHERE id = '${realmId}'`,
    );
  }, 30_000);

  afterAll(async () => {
    await sql(
      `DELETE FROM rate_limit_entries WHERE key LIKE 'client:${realmId}:%'`,
    );
    await sql(`DELETE FROM realms WHERE id = '${realmId}'`);
    await ctx.cleanup();
  });

  it('counts every one of many concurrent requests exactly once', async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        service.checkClientLimit('concurrent', realmId),
      ),
    );
    expect(results.every((r) => r.allowed)).toBe(true);
    const remaining = results.map((r) => r.remaining).sort((a, b) => a - b);
    // Each request saw its own count: 1..50, no two the same.
    expect(new Set(remaining).size).toBe(50);
    expect(remaining[0]).toBe(1000 - 50);
    const entry = await row('concurrent');
    expect(entry.minuteCount).toBe(50);
    expect(entry.hourCount).toBe(50);
  });

  it('starts a new minute window once the old one has run out, keeping the hour', async () => {
    await service.checkClientLimit('window', realmId);
    await service.checkClientLimit('window', realmId);
    await sql(
      `UPDATE rate_limit_entries SET minute_window_start = minute_window_start - interval '2 minutes'
       WHERE key = 'client:${realmId}:window'`,
    );
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        service.checkClientLimit('window', realmId),
      ),
    );
    const entry = await row('window');
    // Restarted once, by one of the 20; none of the 20 was wiped out.
    expect(entry.minuteCount).toBe(20);
    expect(entry.hourCount).toBe(22);
    expect(Math.min(...results.map((r) => r.remaining))).toBe(1000 - 20);
    expect(entry.minuteWindowStart.getTime()).toBeGreaterThan(
      Date.now() - 60_000,
    );
  });

  it('rejects over the limit without counting the rejections', async () => {
    await sql(
      `UPDATE realms SET client_rate_limit_per_minute = 3 WHERE id = '${realmId}'`,
    );
    // The realm settings are cached; wait for the change to be announced.
    const deadline = Date.now() + 3000;
    let results: Awaited<ReturnType<RateLimitService['checkClientLimit']>>[];
    for (;;) {
      await sql(
        `DELETE FROM rate_limit_entries WHERE key = 'client:${realmId}:limited'`,
      );
      results = [];
      for (let i = 0; i < 6; i++) {
        results.push(await service.checkClientLimit('limited', realmId));
      }
      if (results[3] && !results[3].allowed) break;
      if (Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(results.map((r) => r.allowed)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
    expect((await row('limited')).minuteCount).toBe(3);
  });
});
