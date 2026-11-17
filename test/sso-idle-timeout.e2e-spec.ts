import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  createTestApp,
  TEST_ADMIN_API_KEY,
  type SeededRealm,
  type TestContext,
} from './setup';
import { Browser, csrfFrom, useThemeViews } from './helpers/browser';
import { authorizeUrl } from './helpers/auth-flow';
import { SessionsCleanupService } from '../src/sessions/sessions-cleanup.service.js';

/**
 * The realm's SSO session idle timeout (`ssoSessionIdleTimeout`). Time is
 * moved by rewriting timestamps in the database: a browser session's
 * `last_activity_at`, an OAuth session's and its refresh tokens' times.
 */
describe('SSO session idle timeout (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;

  const REALM = 'e2e-sso-idle-timeout';
  const SECRET = 'test-client-secret';
  const PASSWORD = 'TestPassword123!';
  const IDLE = 600;
  const LIFESPAN = 3600;
  const base = `/realms/${REALM}/protocol/openid-connect`;
  const http = () => request(app.getHttpServer());

  const setIdle = (ssoSessionIdleTimeout: number) =>
    ctx.prisma.realm.update({
      where: { id: seeded.realm.id },
      data: { ssoSessionIdleTimeout },
    });

  /** Signs in through the hosted login; the browser holds the SSO cookie. */
  const browserSignIn = async () => {
    const browser = new Browser(app);
    const page = await browser.get(`/realms/${REALM}/login`);
    expect(page.status).toBe(200);
    const res = await browser.post(`/realms/${REALM}/login`, {
      username: 'testuser',
      password: PASSWORD,
      _csrf: csrfFrom(page.text),
    });
    expect(res.status).toBe(302);
    expect(browser.jar.has('IDENPLANE_SESSION')).toBe(true);
    const session = await ctx.prisma.loginSession.findFirstOrThrow({
      where: { userId: seeded.user.id },
      orderBy: { createdAt: 'desc' },
    });
    return { browser, sessionId: session.id };
  };

  /** Moves a browser session's last use `seconds` into the past. */
  const idleFor = (sessionId: string, seconds: number) =>
    ctx.prisma.$executeRaw`
      UPDATE login_sessions
         SET last_activity_at = now() AT TIME ZONE 'UTC'
                                - make_interval(secs => ${seconds})
       WHERE id = ${sessionId}`;

  /** A silent authorization request with the browser's SSO cookie. */
  const silentAuthorize = async (browser: Browser) => {
    const res = await browser.get(authorizeUrl(REALM, { prompt: 'none' }));
    expect(res.status).toBe(302);
    return new URL(res.headers['location'] as string).searchParams;
  };

  const loginSessionExists = async (id: string) =>
    (await ctx.prisma.loginSession.count({ where: { id } })) === 1;

  interface Tokens {
    access_token: string;
    refresh_token: string;
  }

  const sidOf = (jwt: string) =>
    (
      JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()) as {
        sid: string;
      }
    ).sid;

  const passwordGrant = async () => {
    const tokens = (
      await http()
        .post(`${base}/token`)
        .type('form')
        .send({
          grant_type: 'password',
          client_id: 'test-client',
          client_secret: SECRET,
          username: 'testuser',
          password: PASSWORD,
          scope: 'openid',
        })
        .expect(200)
    ).body as Tokens;
    return { ...tokens, sid: sidOf(tokens.access_token) };
  };

  const refresh = (refreshToken: string) =>
    http().post(`${base}/token`).type('form').send({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: 'test-client',
      client_secret: SECRET,
    });

  /** Moves an OAuth session and its refresh tokens `seconds` into the past. */
  const age = async (sessionId: string, seconds: number) => {
    await ctx.prisma.$executeRaw`
      UPDATE sessions
         SET created_at = created_at - make_interval(secs => ${seconds}),
             expires_at = expires_at - make_interval(secs => ${seconds}),
             auth_time = auth_time - make_interval(secs => ${seconds})
       WHERE id = ${sessionId}`;
    await ctx.prisma.$executeRaw`
      UPDATE refresh_tokens
         SET created_at = created_at - make_interval(secs => ${seconds}),
             expires_at = expires_at - make_interval(secs => ${seconds})
       WHERE session_id = ${sessionId}`;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app as INestApplication<App>;
    useThemeViews(app);
    seeded = await ctx.seedTestRealm(REALM);
    await ctx.prisma.realm.update({
      where: { id: seeded.realm.id },
      data: {
        bruteForceEnabled: false,
        refreshTokenLifespan: LIFESPAN,
        maxSessionsPerUser: 0,
      },
    });
  }, 30_000);

  beforeEach(() => setIdle(IDLE));

  afterAll(async () => {
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
  });

  describe('the setting', () => {
    const put = (body: object) =>
      http()
        .put(`/admin/realms/${REALM}`)
        .set('x-admin-api-key', TEST_ADMIN_API_KEY)
        .send(body);

    it('is off for a new realm', async () => {
      const fresh = await ctx.seedTestRealm(`${REALM}-fresh`);
      try {
        expect(fresh.realm.ssoSessionIdleTimeout).toBe(0);
      } finally {
        await ctx.prisma.realm.delete({ where: { id: fresh.realm.id } });
      }
    });

    it('is set through the admin API: 0 or at least 60', async () => {
      await put({ ssoSessionIdleTimeout: 900 }).expect(200);
      const realm = await http()
        .get(`/admin/realms/${REALM}`)
        .set('x-admin-api-key', TEST_ADMIN_API_KEY)
        .expect(200);
      expect(
        (realm.body as { ssoSessionIdleTimeout: number }).ssoSessionIdleTimeout,
      ).toBe(900);
      await put({ ssoSessionIdleTimeout: 0 }).expect(200);
      await put({ ssoSessionIdleTimeout: 30 }).expect(400);
      await put({ ssoSessionIdleTimeout: -1 }).expect(400);
    });
  });

  describe('a browser SSO session', () => {
    it('ends when it has not been used for longer than the idle timeout', async () => {
      const { browser, sessionId } = await browserSignIn();
      await idleFor(sessionId, IDLE + 5);

      const params = await silentAuthorize(browser);
      expect(params.get('error')).toBe('login_required');
      expect(params.get('code')).toBeNull();
      expect(await loginSessionExists(sessionId)).toBe(false);
      // Raising the timeout afterwards does not bring it back.
      await setIdle(0);
      const again = await silentAuthorize(browser);
      expect(again.get('error')).toBe('login_required');
    });

    it('stays alive while it is used', async () => {
      const { browser, sessionId } = await browserSignIn();

      // Used after 500 s, then idle another 500 s: 1000 s since sign-in,
      // never more than 500 s unused.
      await idleFor(sessionId, 500);
      expect((await silentAuthorize(browser)).get('code')).toBeTruthy();
      const touched = await ctx.prisma.loginSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      expect(Date.now() - touched.lastActivityAt.getTime()).toBeLessThan(
        30_000,
      );

      await idleFor(sessionId, 500);
      expect((await silentAuthorize(browser)).get('code')).toBeTruthy();
      expect((await browser.get(`/realms/${REALM}/account`)).status).toBe(200);
    });

    it('is not ended for idleness while the timeout is off', async () => {
      await setIdle(0);
      const { browser, sessionId } = await browserSignIn();
      await idleFor(sessionId, 3000);
      expect((await silentAuthorize(browser)).get('code')).toBeTruthy();
    });

    it('is deleted by the clean-up once idle, and listed nowhere before', async () => {
      const { sessionId } = await browserSignIn();
      await idleFor(sessionId, IDLE + 5);

      const listed = await http()
        .get(`/admin/realms/${REALM}/users/${seeded.user.id}/sessions`)
        .set('x-admin-api-key', TEST_ADMIN_API_KEY)
        .expect(200);
      expect(
        (listed.body as Array<{ id: string }>).map((s) => s.id),
      ).not.toContain(sessionId);

      await app.get(SessionsCleanupService).cleanupExpiredSessions();
      expect(await loginSessionExists(sessionId)).toBe(false);
    });
  });

  describe('an OAuth session', () => {
    it('issues refresh tokens that expire after the idle timeout', async () => {
      const { sid } = await passwordGrant();
      const token = await ctx.prisma.refreshToken.findFirstOrThrow({
        where: { sessionId: sid },
      });
      const seconds =
        (token.expiresAt.getTime() - token.createdAt.getTime()) / 1000;
      expect(seconds).toBeGreaterThan(IDLE - 5);
      expect(seconds).toBeLessThanOrEqual(IDLE);
    });

    it('cannot be refreshed after the idle timeout without use', async () => {
      const { sid, refresh_token } = await passwordGrant();
      await age(sid, IDLE + 5);
      const res = await refresh(refresh_token);
      expect(res.status).toBe(400);
      expect((res.body as { error: string }).error).toBe('invalid_grant');
    });

    it('lives on while it is refreshed within the idle timeout', async () => {
      const first = await passwordGrant();
      await age(first.sid, IDLE - 100);
      const second = (await refresh(first.refresh_token).expect(200))
        .body as Tokens;
      await age(first.sid, IDLE - 100);
      // 1000 s since sign-in, more than the idle timeout, less than the
      // session lifespan: still refreshable, because it was used.
      await refresh(second.refresh_token).expect(200);
    });
  });
});
