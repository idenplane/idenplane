import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  createTestApp,
  TEST_ADMIN_API_KEY,
  type SeededRealm,
  type TestContext,
} from './setup';
import { ConsentService } from '../src/consent/consent.service';

/**
 * F-16 follow-up: a real consent grant (through ConsentService.grantConsent —
 * the single entry point every HTTP consent path funnels to) must tag history
 * with its consent categories, so the per-category stats endpoint increments
 * for the right category only. Not a direct stats seed.
 */
describe('Consent grant category tagging (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;
  let consentService: ConsentService;

  const REALM_NAME = 'e2e-grant-tag-realm';
  const API_KEY_HEADER = 'x-admin-api-key';
  const base = `/admin/realms/${REALM_NAME}`;

  const withKey = (req: request.Test) =>
    req.set(API_KEY_HEADER, TEST_ADMIN_API_KEY);
  const totalGrants = async (categoryId: string): Promise<number> => {
    const res = await withKey(
      request(app.getHttpServer()).get(
        `${base}/consent-categories/${categoryId}/stats`,
      ),
    );
    expect(res.status).toBe(200);
    return res.body.totalGrants as number;
  };

  let profileCatId: string; // explicit scopes:['profile']
  let analyticsCatId: string; // explicit scopes:['analytics']
  let emailCatId: string; // empty scopes → key fallback ('email')
  let secondUserId: string; // a fresh user so the email grant is `granted`

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    seeded = await ctx.seedTestRealm(REALM_NAME);
    consentService = app.get(ConsentService);

    const mk = (key: string, scopes: string[]) =>
      ctx.prisma.consentCategory.create({
        data: {
          realmId: seeded.realm.id,
          key,
          displayName: key,
          enabled: true,
          scopes,
        },
        select: { id: true },
      });

    profileCatId = (await mk('profile', ['profile'])).id;
    analyticsCatId = (await mk('analytics', ['analytics'])).id;
    emailCatId = (await mk('email', [])).id; // empty → key fallback

    const u2 = await ctx.prisma.user.create({
      data: {
        realmId: seeded.realm.id,
        username: 'grant-tag-u2',
        email: 'grant-tag-u2@example.com',
        enabled: true,
      },
      select: { id: true },
    });
    secondUserId = u2.id;
  }, 30_000);

  afterAll(async () => {
    await ctx.prisma.realm
      .delete({ where: { name: REALM_NAME } })
      .catch(() => {});
    await ctx.cleanup();
  });

  it('tags a real grant by explicit scope mapping (profile only)', async () => {
    expect(await totalGrants(profileCatId)).toBe(0);
    expect(await totalGrants(analyticsCatId)).toBe(0);

    // Real grant for `openid profile` — profile category governs `profile`.
    await consentService.grantConsent(
      seeded.realm.id,
      seeded.user.id,
      seeded.client.id,
      ['openid', 'profile'],
    );

    expect(await totalGrants(profileCatId)).toBe(1); // incremented
    expect(await totalGrants(analyticsCatId)).toBe(0); // untouched
  });

  it('tags a real grant by key fallback when scopes are unconfigured', async () => {
    expect(await totalGrants(emailCatId)).toBe(0);

    // `email` category has empty scopes, so it governs the `email` scope via
    // the key==scope convention. Fresh user → a `granted` action.
    await consentService.grantConsent(
      seeded.realm.id,
      secondUserId,
      seeded.client.id,
      ['openid', 'email'],
    );

    expect(await totalGrants(emailCatId)).toBe(1); // key fallback tagged it
    expect(await totalGrants(profileCatId)).toBe(1); // unchanged from test 1
  });
});
