import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, type TestContext } from './setup';

/**
 * The per-user session cap under concurrent sign-ins. Each password grant
 * creates a session and its refresh token; with the cap reached, a sign-in
 * evicts older sessions. A concurrent sign-in used to evict a session in the
 * moment between its creation and its refresh token's, which failed that
 * sign-in with a 500 (a foreign-key violation on the refresh token).
 */
describe('Session limit under concurrent sign-ins (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  const REALM = 'e2e-session-limit';

  const signIn = () =>
    request(app.getHttpServer())
      .post(`/realms/${REALM}/protocol/openid-connect/token`)
      .type('form')
      .send({
        grant_type: 'password',
        client_id: 'test-client',
        client_secret: 'test-client-secret',
        username: 'testuser',
        password: 'TestPassword123!',
        scope: 'openid',
      });

  const sessions = async () =>
    ctx.prisma.session.count({
      where: { user: { username: 'testuser', realm: { name: REALM } } },
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app as INestApplication<App>;
    await ctx.seedTestRealm(REALM);
    await ctx.prisma.realm.update({
      where: { name: REALM },
      data: { maxSessionsPerUser: 1, bruteForceEnabled: false },
    });
  }, 30_000);

  afterAll(async () => {
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
  });

  it('answers every one of many concurrent sign-ins with tokens', async () => {
    const responses = await Promise.all(Array.from({ length: 20 }, signIn));

    const statuses = responses.map((r) => r.status);
    expect(statuses).toEqual(Array(20).fill(200));
    for (const r of responses) {
      expect((r.body as { refresh_token?: string }).refresh_token).toBeTruthy();
    }
  }, 60_000);

  it('keeps only the newest session once sign-ins are sequential again', async () => {
    const res = await signIn().expect(200);

    expect(await sessions()).toBe(1);
    const { refresh_token } = res.body as { refresh_token: string };
    await request(app.getHttpServer())
      .post(`/realms/${REALM}/protocol/openid-connect/token`)
      .type('form')
      .send({
        grant_type: 'refresh_token',
        client_id: 'test-client',
        client_secret: 'test-client-secret',
        refresh_token,
      })
      .expect(200);
  });

  it('answers a refresh from an evicted session with invalid_grant, not a 500', async () => {
    const first = (await signIn().expect(200)).body as {
      refresh_token: string;
    };
    await signIn().expect(200); // evicts the first session (cap 1)

    const res = await request(app.getHttpServer())
      .post(`/realms/${REALM}/protocol/openid-connect/token`)
      .type('form')
      .send({
        grant_type: 'refresh_token',
        client_id: 'test-client',
        client_secret: 'test-client-secret',
        refresh_token: first.refresh_token,
      });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('invalid_grant');
  });
});
