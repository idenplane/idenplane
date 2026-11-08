import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, type TestContext } from './setup';

/**
 * Refresh-token rotation against a real database: one refresh token is
 * good for one refresh, even when it is presented several times at once,
 * and a refresh can neither widen the scope nor outlive the user.
 */
describe('Refresh token rotation (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  const REALM = 'e2e-refresh-rotation';
  const TOKEN = `/realms/${REALM}/protocol/openid-connect/token`;
  const client = {
    client_id: 'test-client',
    client_secret: 'test-client-secret',
  };

  const signIn = async () =>
    (
      (
        await request(app.getHttpServer())
          .post(TOKEN)
          .type('form')
          .send({
            ...client,
            grant_type: 'password',
            username: 'testuser',
            password: 'TestPassword123!',
            scope: 'openid profile',
          })
          .expect(200)
      ).body as { refresh_token: string }
    ).refresh_token;

  const refresh = (refresh_token: string, extra: Record<string, string> = {}) =>
    request(app.getHttpServer())
      .post(TOKEN)
      .type('form')
      .send({
        ...client,
        grant_type: 'refresh_token',
        refresh_token,
        ...extra,
      });

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app as INestApplication<App>;
    await ctx.seedTestRealm(REALM);
    await ctx.prisma.realm.update({
      where: { name: REALM },
      data: { bruteForceEnabled: false },
    });
  }, 30_000);

  afterAll(async () => {
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
  });

  it('honours a refresh token once when it is presented five times at once', async () => {
    const rt = await signIn();
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => refresh(rt)),
    );

    const ok = responses.filter((r) => r.status === 200);
    expect(ok.length).toBeLessThanOrEqual(1);
    expect(responses.filter((r) => r.status === 400)).toHaveLength(
      5 - ok.length,
    );
    // A reuse revokes the whole family, the winner's new token included.
    if (ok.length === 1) {
      const next = (ok[0].body as { refresh_token: string }).refresh_token;
      await refresh(next).expect(400);
    }
  });

  it('refuses a scope the token was not granted', async () => {
    const res = await refresh(await signIn(), {
      scope: 'openid profile email',
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('invalid_scope');
  });

  it('allows a narrower scope', async () => {
    await refresh(await signIn(), { scope: 'openid' }).expect(200);
  });

  it('refuses a refresh once the user is disabled', async () => {
    const rt = await signIn();
    await ctx.prisma.user.updateMany({
      where: { username: 'testuser', realm: { name: REALM } },
      data: { enabled: false },
    });
    try {
      const res = await refresh(rt);
      expect(res.status).toBe(400);
      expect((res.body as { error: string }).error).toBe('invalid_grant');
    } finally {
      await ctx.prisma.user.updateMany({
        where: { username: 'testuser', realm: { name: REALM } },
        data: { enabled: true },
      });
    }
  });
});
