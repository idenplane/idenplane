import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, TEST_ADMIN_API_KEY, type TestContext } from './setup';

/**
 * The import endpoints accept bodies up to 10 MB; every other endpoint
 * keeps body-parser's 100 KB. Before 0.11.0 the imports had 100 KB too, so
 * any realistic export got a 413.
 */
describe('JSON body limit: imports vs the rest (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  const REALM = 'e2e-import-body-limit';
  const OTHER = 'e2e-body-limit-other';

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app as INestApplication<App>;
  }, 30_000);

  afterAll(async () => {
    await ctx.prisma.realm
      .deleteMany({ where: { name: { in: [REALM, OTHER] } } })
      .catch(() => {});
    await ctx.cleanup();
  });

  it('a Keycloak import over 100 KB is accepted and imported', async () => {
    const users = Array.from({ length: 150 }, (_, i) => ({
      username: `bulk-${i}`,
      email: `bulk-${i}@example.com`,
      enabled: true,
      attributes: { note: ['x'.repeat(1000)] },
    }));
    const body = {
      targetRealm: REALM,
      data: { realm: REALM, enabled: true, users },
    };
    expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(150_000);

    const res = await request(app.getHttpServer())
      .post('/admin/migration/keycloak')
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(res.body.summary.users.created).toBe(150);
  }, 60_000);

  it('an import over 10 MB is refused with 413', async () => {
    const res = await request(app.getHttpServer())
      .post('/admin/migration/keycloak')
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .set('content-type', 'application/json')
      .send(
        JSON.stringify({
          targetRealm: REALM,
          data: { realm: REALM, padding: 'x'.repeat(10 * 1024 * 1024 + 1) },
        }),
      );
    expect(res.status).toBe(413);
  }, 60_000);

  it('a normal endpoint still refuses a body over 100 KB', async () => {
    const res = await request(app.getHttpServer())
      .post('/admin/realms')
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .send({ name: OTHER, displayName: 'x'.repeat(150_000) });
    expect(res.status).toBe(413);
    expect(
      await ctx.prisma.realm.findUnique({ where: { name: OTHER } }),
    ).toBeNull();
  });

  it('the same endpoint takes a body under 100 KB', async () => {
    const res = await request(app.getHttpServer())
      .post('/admin/realms')
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .send({ name: OTHER, displayName: 'Body limit check' });
    expect([200, 201]).toContain(res.status);
  });
});
