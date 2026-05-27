import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  createTestApp,
  TEST_ADMIN_API_KEY,
  type SeededRealm,
  type TestContext,
} from './setup';

/**
 * E2E for the consent contract (F-16): category CRUD via key+displayName, the
 * realm consent-statistics endpoint, and the per-category stats endpoint.
 *
 * Consent events are linked to a category only through
 * `UserConsentHistory.metadata.categoryKey`, so the seed below tags history
 * rows with a categoryKey and spreads them across the 24h/7d/30d windows; the
 * assertions check the aggregation against those exact seeded counts.
 */
describe('Consent contract + statistics (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;

  const REALM_NAME = 'e2e-consent-realm';
  const API_KEY_HEADER = 'x-admin-api-key';
  const CATEGORY_KEY = 'marketing';

  const adminRequest = () => request(app.getHttpServer());
  const withKey = (req: request.Test) =>
    req.set(API_KEY_HEADER, TEST_ADMIN_API_KEY);

  const base = `/admin/realms/${REALM_NAME}`;

  let categoryId: string;

  // window offsets (ms): inside 24h, inside 7d (not 24h), inside 30d (not 7d)
  const ago = (ms: number) => new Date(Date.now() - ms);
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    seeded = await ctx.seedTestRealm(REALM_NAME);

    // Two extra users so distinct-user counts differ from event counts.
    const u2 = await ctx.prisma.user.create({
      data: {
        realmId: seeded.realm.id,
        username: 'consent-u2',
        email: 'consent-u2@example.com',
        enabled: true,
      },
    });
    const u3 = await ctx.prisma.user.create({
      data: {
        realmId: seeded.realm.id,
        username: 'consent-u3',
        email: 'consent-u3@example.com',
        enabled: true,
      },
    });
    const u1 = seeded.user.id;
    const clientId = seeded.client.id;

    // Category to aggregate against.
    const category = await ctx.prisma.consentCategory.create({
      data: {
        realmId: seeded.realm.id,
        key: CATEGORY_KEY,
        displayName: 'Marketing',
        required: false,
        enabled: true,
      },
    });
    categoryId = category.id;

    // Active UserConsent rows (totalConsents).
    await ctx.prisma.userConsent.createMany({
      data: [
        { userId: u1, clientId, scopes: ['openid'] },
        { userId: u2.id, clientId, scopes: ['openid'] },
      ],
    });

    const tagged = { categoryKey: CATEGORY_KEY };
    const mkHistory = (
      userId: string,
      action: string,
      when: Date,
      withTag = true,
    ) => ({
      userId,
      clientId,
      action,
      scopes: ['openid'],
      metadata: withTag ? tagged : undefined,
      createdAt: when,
    });

    // Granted, category-tagged:
    //   24h: u1, u2  (2)   | 7d adds u3 (1) | 30d adds u1 again (1)
    // Distinct users granted: u1,u2,u3 = 3.  totalGrants events = 4.
    await ctx.prisma.userConsentHistory.createMany({
      data: [
        mkHistory(u1, 'granted', ago(2 * HOUR)),
        mkHistory(u2.id, 'granted', ago(5 * HOUR)),
        mkHistory(u3.id, 'granted', ago(3 * DAY)),
        mkHistory(u1, 'granted', ago(20 * DAY)),
        // One revoke (tagged), inside 24h
        mkHistory(u2.id, 'revoked', ago(1 * HOUR)),
        // One updated (tagged), inside 24h
        mkHistory(u3.id, 'updated', ago(1 * HOUR)),
        // An UNTAGGED action (counts toward realm action windows, not category)
        mkHistory(u1, 'granted', ago(6 * HOUR), false),
      ],
    });
  }, 30_000);

  afterAll(async () => {
    await ctx.prisma.realm
      .delete({ where: { name: REALM_NAME } })
      .catch(() => {});
    await ctx.cleanup();
  });

  // ─── Category CRUD (key + displayName) ─────────────────────

  it('POST consent-categories — creates with key + displayName', async () => {
    const res = await withKey(
      adminRequest()
        .post(`${base}/consent-categories`)
        .send({
          key: 'analytics',
          displayName: 'Analytics',
          description: 'Usage analytics',
          required: false,
        }),
    );
    expect(res.status).toBe(201);
    expect(res.body.key).toBe('analytics');
    expect(res.body.displayName).toBe('Analytics');
    expect(res.body.enabled).toBe(true);
  });

  it('PUT consent-categories/:id — updates displayName', async () => {
    const res = await withKey(
      adminRequest()
        .put(`${base}/consent-categories/${categoryId}`)
        .send({ displayName: 'Marketing & Promotions' }),
    );
    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('Marketing & Promotions');
    expect(res.body.key).toBe(CATEGORY_KEY);
  });

  // ─── Realm consent statistics ──────────────────────────────

  it('GET stats/consents — returns the full canonical contract', async () => {
    const res = await withKey(adminRequest().get(`${base}/stats/consents`));
    expect(res.status).toBe(200);
    const s = res.body;

    expect(s.totalConsents).toBe(2);

    // Action windows count ALL history rows (tagged + untagged):
    // 24h: 2 granted + 1 revoked + 1 updated + 1 untagged granted = 5
    expect(s.consentActionsLast24h).toBe(5);
    // 7d: 24h(5) + u3 granted(3d) = 6
    expect(s.consentActionsLast7d).toBe(6);
    // 30d: 7d(6) + u1 granted(20d) = 7
    expect(s.consentActionsLast30d).toBe(7);

    // Per-type 24h: granted = 2 tagged + 1 untagged = 3; revoked 1; updated 1
    expect(s.consentsGranted24h).toBe(3);
    expect(s.consentsRevoked24h).toBe(1);
    expect(s.consentsUpdated24h).toBe(1);

    // Distinct active users by window (any tagged-or-untagged action):
    // 24h: u1,u2,u3 = 3 ; 7d: +u3(already) = 3 ; 30d: 3
    expect(s.activeUsersWithConsents24h).toBe(3);
    expect(s.activeUsersWithConsents30d).toBe(3);

    // Category breakdown (tagged 'granted' only): 4 events, 3 distinct users
    const marketing = s.consentsByCategory.find(
      (c: { categoryKey: string }) => c.categoryKey === CATEGORY_KEY,
    );
    expect(marketing).toMatchObject({
      categoryName: 'Marketing & Promotions',
      totalGrants: 4,
      distinctUsers: 3,
    });
  });

  // ─── Per-category statistics ───────────────────────────────

  it('GET consent-categories/:id/stats — per-category windows', async () => {
    const res = await withKey(
      adminRequest().get(`${base}/consent-categories/${categoryId}/stats`),
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      categoryId,
      categoryKey: CATEGORY_KEY,
      totalGrants: 4, // tagged granted events
      totalRevokes: 1, // tagged revoked events
      grants24h: 2, // u1, u2 granted in 24h
      grants7d: 3, // + u3 at 3d
      grants30d: 4, // + u1 at 20d
    });
    // Active users (any tagged action) in 24h: u1(granted), u2(granted+revoked),
    // u3(updated) = 3
    expect(res.body.activeUsers24h).toBe(3);
  });

  it('GET consent-categories/:id/stats — 404 for unknown category', async () => {
    const res = await withKey(
      adminRequest().get(
        `${base}/consent-categories/00000000-0000-0000-0000-000000000000/stats`,
      ),
    );
    expect(res.status).toBe(404);
  });
});
