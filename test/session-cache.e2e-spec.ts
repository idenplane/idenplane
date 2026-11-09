import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, type TestContext } from './setup';
import { CacheBusService } from '../src/cache/cache-bus.service';

/**
 * A user's token is good only while its session exists. Introspection and
 * userinfo keep the answer in memory; the database announces an ended
 * session (session_cache_triggers), so a session deleted past the app is
 * seen on the next request.
 */
describe('Session existence cache (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let bus: CacheBusService;
  let realmId: string;
  let userId: string;
  const REALM = 'e2e-session-cache';
  const sql = (q: string) => ctx.prisma.$executeRawUnsafe(q);
  const base = `/realms/${REALM}/protocol/openid-connect`;

  const eventually = async (check: () => Promise<void>, ms = 3000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      try {
        return await check();
      } catch (err) {
        if (Date.now() > deadline) throw err;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  };

  const login = async () => {
    const res = await request(app.getHttpServer())
      .post(`${base}/token`)
      .type('form')
      .send({
        grant_type: 'password',
        client_id: 'test-client',
        client_secret: 'test-client-secret',
        username: 'testuser',
        password: 'TestPassword123!',
        scope: 'openid profile',
      })
      .expect(200);
    return res.body as { access_token: string; session_state: string };
  };
  const introspect = async (token: string) =>
    (
      await request(app.getHttpServer())
        .post(`${base}/token/introspect`)
        .type('form')
        .send({
          token,
          client_id: 'test-client',
          client_secret: 'test-client-secret',
        })
        .expect(200)
    ).body as { active: boolean };
  const userinfo = (token: string) =>
    request(app.getHttpServer())
      .get(`${base}/userinfo`)
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app as INestApplication<App>;
    bus = app.get(CacheBusService);
    const seeded = await ctx.seedTestRealm(REALM);
    realmId = seeded.realm.id;
    userId = seeded.user.id;
    await eventually(async () => expect(bus.isConnected()).toBe(true), 10_000);
  }, 30_000);

  afterAll(async () => {
    await sql(`DELETE FROM realms WHERE id = '${realmId}'`);
    await ctx.cleanup();
  });

  it('reports a token inactive, and refuses userinfo, once its session is deleted', async () => {
    const { access_token, session_state } = await login();
    expect((await introspect(access_token)).active).toBe(true); // cached
    await userinfo(access_token).expect(200);

    await sql(`DELETE FROM sessions WHERE id = '${session_state}'`);
    await eventually(async () => {
      expect((await introspect(access_token)).active).toBe(false);
    });
    await userinfo(access_token).expect(401);
  });

  it('keeps the other sessions of the user valid', async () => {
    const a = await login();
    const b = await login();
    await introspect(a.access_token);
    await introspect(b.access_token);
    await sql(`DELETE FROM sessions WHERE id = '${a.session_state}'`);
    await eventually(async () => {
      expect((await introspect(a.access_token)).active).toBe(false);
    });
    expect((await introspect(b.access_token)).active).toBe(true);
  });

  it('ends every cached session in a bulk delete too large to list', async () => {
    const { access_token } = await login();
    await introspect(access_token);
    // 150 extra sessions for the user, then all of them in one statement.
    await sql(
      `INSERT INTO sessions (id, user_id, realm_id, expires_at)
       SELECT 'bulk-' || g, '${userId}', '${realmId}', now() + interval '1 hour'
       FROM generate_series(1, 150) g`,
    );
    await sql(`DELETE FROM sessions WHERE user_id = '${userId}'`);
    await eventually(async () => {
      expect((await introspect(access_token)).active).toBe(false);
    });
  });

  it('shows a changed name in userinfo on the next request', async () => {
    const { access_token } = await login();
    await userinfo(access_token).expect(200); // the profile is now cached
    await sql(`UPDATE users SET first_name = 'Renamed' WHERE id = '${userId}'`);
    await eventually(async () => {
      const res = await userinfo(access_token).expect(200);
      expect((res.body as { given_name?: string }).given_name).toBe('Renamed');
    });
  });
});
