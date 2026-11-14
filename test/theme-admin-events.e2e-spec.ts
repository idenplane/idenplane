import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, TEST_ADMIN_API_KEY, type TestContext } from './setup';

/**
 * Theme writes are admin changes like any other: they must leave admin events.
 */
describe('Theme admin events (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;

  const REALM = 'e2e-theme-events';
  const base = `/admin/realms/${REALM}/themes`;

  const api = () => request(app.getHttpServer());
  const key = (r: request.Test) => r.set('x-admin-api-key', TEST_ADMIN_API_KEY);

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.prisma.realm.create({
      data: { name: REALM, adminEventsEnabled: true },
    });
  });

  afterAll(async () => {
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
  });

  it('records creating, updating and deleting a theme', async () => {
    const created = await key(
      api().post(base).send({ name: 'brand', themeType: 'login' }),
    ).expect(201);
    const themeId = (created.body as { id: string }).id;

    await key(
      api().put(`${base}/${themeId}`).send({ displayName: 'Brand' }),
    ).expect(200);
    await key(api().delete(`${base}/${themeId}`)).expect((res) => {
      expect([200, 204]).toContain(res.status);
    });

    // The interceptor writes events without awaiting them; give the last one
    // a moment to land.
    const operations = async () =>
      (
        await ctx.prisma.adminEvent.findMany({
          where: { realm: { name: REALM }, resourceType: 'THEME' },
          orderBy: { createdAt: 'asc' },
        })
      ).map((e) => e.operationType);
    for (let i = 0; i < 20 && (await operations()).length < 3; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(await operations()).toEqual(['CREATE', 'UPDATE', 'DELETE']);
  });

  it('answers 404 for an unknown realm', async () => {
    await key(api().get('/admin/realms/no-such-realm/themes')).expect(404);
  });
});
