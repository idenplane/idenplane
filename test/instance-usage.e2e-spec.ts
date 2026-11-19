import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import {
  createTestApp,
  TEST_ADMIN_API_KEY,
  type SeededRealm,
  type TestContext,
} from './setup';
import { UsageRetentionService } from '../src/usage/usage-retention.service';

/**
 * E2E for GET /admin/system/usage: the instance-wide monthly active users
 * a managed service bills on. Other suites share the database, so the
 * assertions read this suite's realms and check the totals only for
 * consistency with the per-realm rows.
 */
describe('Instance usage (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;

  const REALM_NAME = 'e2e-usage-realm';
  const TOKEN_URL = `/realms/${REALM_NAME}/protocol/openid-connect/token`;
  const USAGE_URL = '/admin/system/usage';

  interface RealmRow {
    id: string;
    name: string | null;
    deleted: boolean;
    users: number;
    monthlyActiveUsers: number;
  }

  const usage = async (query = '') => {
    const res = await request(app.getHttpServer())
      .get(`${USAGE_URL}${query}`)
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .expect(200);
    return res.body as {
      version: string;
      period: {
        month: string;
        start: string;
        end: string;
        closed: boolean;
        complete: boolean;
        pruned: boolean;
      };
      retention: { months: number | null; oldestMonth: string | null };
      tracking: { since: string | null };
      totals: { realms: number; users: number; monthlyActiveUsers: number };
      realms: RealmRow[];
    };
  };
  const rowOf = (body: { realms: RealmRow[] }, id: string) =>
    body.realms.find((r) => r.id === id);

  const passwordGrant = () =>
    request(app.getHttpServer())
      .post(TOKEN_URL)
      .type('form')
      .send({
        grant_type: 'password',
        client_id: 'test-client',
        client_secret: 'test-client-secret',
        username: 'testuser',
        password: 'TestPassword123!',
        scope: 'openid',
      })
      .expect(200);

  const pad = (n: number) => String(n).padStart(2, '0');
  const now = new Date();
  const thisMonth = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}`;
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1));
  const lastMonth = `${prev.getUTCFullYear()}-${pad(prev.getUTCMonth() + 1)}`;
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1));
  const nextMonth = `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}`;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    // Events are off in this fixture realm: usage must not depend on them.
    seeded = await ctx.seedTestRealm(REALM_NAME);

    // A service account user: a user row, but not a person.
    const sa = await ctx.prisma.user.create({
      data: {
        realmId: seeded.realm.id,
        username: 'service-account-test-client',
        enabled: true,
      },
    });
    await ctx.prisma.client.update({
      where: { id: seeded.client.id },
      data: { serviceAccountUserId: sa.id },
    });
  }, 30_000);

  afterAll(async () => {
    await ctx.prisma.realm
      .delete({ where: { name: REALM_NAME } })
      .catch(() => undefined);
    await ctx.cleanup();
  });

  it('needs admin credentials', async () => {
    await request(app.getHttpServer()).get(USAGE_URL).expect(401);
  });

  it('refuses a malformed or future month', async () => {
    for (const month of ['2026-13', 'last', nextMonth]) {
      await request(app.getHttpServer())
        .get(`${USAGE_URL}?month=${month}`)
        .set('x-admin-api-key', TEST_ADMIN_API_KEY)
        .expect(400);
    }
  });

  it('reports the current month, with no activity before any sign-in', async () => {
    const body = await usage();

    expect(body.version).toEqual(expect.any(String));
    expect(body.period.month).toBe(thisMonth);
    expect(body.period.closed).toBe(false);
    expect(body.tracking.since).toEqual(expect.any(String));
    expect(rowOf(body, seeded.realm.id)).toEqual({
      id: seeded.realm.id,
      name: REALM_NAME,
      deleted: false,
      // testuser; the service account is not counted.
      users: 1,
      monthlyActiveUsers: 0,
    });
  });

  it('counts a user once per month, whatever the number of grants', async () => {
    const first = await passwordGrant();
    await passwordGrant();
    await request(app.getHttpServer())
      .post(TOKEN_URL)
      .type('form')
      .send({
        grant_type: 'refresh_token',
        client_id: 'test-client',
        client_secret: 'test-client-secret',
        refresh_token: first.body.refresh_token as string,
      })
      .expect(200);

    const body = await usage();
    expect(rowOf(body, seeded.realm.id)?.monthlyActiveUsers).toBe(1);

    const rows = await ctx.prisma.userMonthlyActivity.findMany({
      where: { realmId: seeded.realm.id },
    });
    expect(rows.map((r) => r.userId)).toEqual([seeded.user.id]);
  });

  it('does not count a service account (client_credentials)', async () => {
    await request(app.getHttpServer())
      .post(TOKEN_URL)
      .type('form')
      .send({
        grant_type: 'client_credentials',
        client_id: 'test-client',
        client_secret: 'test-client-secret',
      })
      .expect(200);

    const body = await usage();
    expect(rowOf(body, seeded.realm.id)?.monthlyActiveUsers).toBe(1);
  });

  it('keeps counting a user deleted after being active', async () => {
    await ctx.prisma.user.delete({ where: { id: seeded.user.id } });

    const body = await usage();
    expect(rowOf(body, seeded.realm.id)).toEqual(
      expect.objectContaining({ users: 0, monthlyActiveUsers: 1 }),
    );
  });

  it('reports a closed past month', async () => {
    const [year, month] = lastMonth.split('-').map(Number);
    await ctx.prisma.userMonthlyActivity.createMany({
      data: [
        {
          month: new Date(Date.UTC(year, month - 1, 1)),
          realmId: seeded.realm.id,
          userId: randomUUID(),
        },
      ],
    });

    const body = await usage(`?month=${lastMonth}`);
    expect(body.period).toEqual(
      expect.objectContaining({ month: lastMonth, closed: true }),
    );
    expect(rowOf(body, seeded.realm.id)?.monthlyActiveUsers).toBe(1);
  });

  it('prunes months older than the retention and reports them as pruned', async () => {
    const retention = app.get(UsageRetentionService);
    const months = retention.retentionMonths;
    expect(months).toBe(13); // the default
    const monthStart = (offset: number) =>
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const label = (d: Date) =>
      `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
    const tooOld = monthStart(months! + 1);
    const oldestKept = monthStart(months!);
    const oldUser = randomUUID();
    const keptUser = randomUUID();
    await ctx.prisma.userMonthlyActivity.createMany({
      data: [
        { month: tooOld, realmId: seeded.realm.id, userId: oldUser },
        { month: oldestKept, realmId: seeded.realm.id, userId: keptUser },
      ],
    });

    expect(await retention.prune()).toBeGreaterThanOrEqual(1);

    const left = await ctx.prisma.userMonthlyActivity.findMany({
      where: { userId: { in: [oldUser, keptUser] } },
    });
    expect(left.map((r) => r.userId)).toEqual([keptUser]);

    const pruned = await usage(`?month=${label(tooOld)}`);
    expect(pruned.period).toEqual(
      expect.objectContaining({ pruned: true, complete: false }),
    );
    expect(pruned.retention).toEqual({
      months,
      oldestMonth: label(oldestKept),
    });
    const kept = await usage(`?month=${label(oldestKept)}`);
    expect(kept.period.pruned).toBe(false);
    expect(rowOf(kept, seeded.realm.id)?.monthlyActiveUsers).toBe(1);

    // The current and previous months are untouched.
    const current = await usage();
    expect(current.period.pruned).toBe(false);
    expect(rowOf(current, seeded.realm.id)?.monthlyActiveUsers).toBe(1);
  });

  it('keeps the activity of a deleted realm, and totals add up', async () => {
    const gone = await ctx.prisma.realm.create({
      data: { name: `e2e-usage-gone-${randomUUID().slice(0, 8)}` },
    });
    const [year, month] = thisMonth.split('-').map(Number);
    await ctx.prisma.userMonthlyActivity.createMany({
      data: [
        {
          month: new Date(Date.UTC(year, month - 1, 1)),
          realmId: gone.id,
          userId: randomUUID(),
        },
      ],
    });
    await ctx.prisma.realm.delete({ where: { id: gone.id } });

    const body = await usage();
    expect(rowOf(body, gone.id)).toEqual({
      id: gone.id,
      name: null,
      deleted: true,
      users: 0,
      monthlyActiveUsers: 1,
    });
    const sum = (key: 'users' | 'monthlyActiveUsers') =>
      body.realms.reduce((n, r) => n + r[key], 0);
    expect(body.totals.users).toBe(sum('users'));
    expect(body.totals.monthlyActiveUsers).toBe(sum('monthlyActiveUsers'));
    expect(body.totals.realms).toBe(
      body.realms.filter((r) => !r.deleted).length,
    );
  });
});
