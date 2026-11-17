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
import { SessionsCleanupService } from '../src/sessions/sessions-cleanup.service.js';
import { VerificationService } from '../src/verification/verification.service.js';
import { AdminAuthService } from '../src/admin-auth/admin-auth.service.js';
import { ACR_MFA } from '../src/authn-core/acr.js';

/**
 * Offline tokens live for the realm's offline lifespan, not the normal
 * session lifespan. Time is moved by rewriting the session's and its refresh
 * tokens' timestamps in the database, then running the real hourly clean-up.
 */
describe('Offline sessions (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;
  let cleanup: SessionsCleanupService;

  const REALM = 'e2e-offline-sessions';
  const REDIRECT_URI = 'http://localhost:3000/callback';
  const SECRET = 'test-client-secret';
  const PASSWORD = 'TestPassword123!';
  const OFFLINE_LIFESPAN = 7 * 24 * 3600;
  const NORMAL_LIFESPAN = 1800;
  const base = `/realms/${REALM}/protocol/openid-connect`;
  const http = () => request(app.getHttpServer());

  interface Tokens {
    access_token: string;
    refresh_token: string;
    scope: string;
  }

  const sidOf = (jwt: string) =>
    (
      JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()) as {
        sid: string;
      }
    ).sid;

  /** Signs in through the hosted login with offline_access. */
  const offlineSignIn = async (): Promise<Tokens & { sid: string }> => {
    const browser = new Browser(app);
    const query = {
      client_id: 'test-client',
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'openid offline_access',
      state: 'xyz',
    };
    const page = await browser.get(
      `/realms/${REALM}/login?${new URLSearchParams(query).toString()}`,
    );
    expect(page.status).toBe(200);
    const res = await browser.post(`/realms/${REALM}/login`, {
      ...query,
      username: 'testuser',
      password: PASSWORD,
      _csrf: csrfFrom(page.text),
    });
    expect(res.status).toBe(302);
    const code = new URL(res.headers['location'] as string).searchParams.get(
      'code',
    );
    expect(code).toBeTruthy();
    const tokens = (
      await http()
        .post(`${base}/token`)
        .type('form')
        .send({
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          client_id: 'test-client',
          client_secret: SECRET,
        })
        .expect(200)
    ).body as Tokens;
    expect(tokens.scope.split(' ')).toContain('offline_access');
    return { ...tokens, sid: sidOf(tokens.access_token) };
  };

  const normalSignIn = async (): Promise<Tokens & { sid: string }> => {
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

  const refreshed = async (refreshToken: string) =>
    (await refresh(refreshToken).expect(200)).body as Tokens;

  const refused = async (refreshToken: string) => {
    const res = await refresh(refreshToken);
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('invalid_grant');
  };

  /** Moves a session, and its refresh tokens, `seconds` into the past. */
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

  const sessionExists = async (id: string) =>
    (await ctx.prisma.session.count({ where: { id } })) === 1;

  const admin = (method: 'put' | 'delete' | 'patch' | 'post', path: string) =>
    http()
      [method](`/admin/realms/${REALM}${path}`)
      .set('x-admin-api-key', TEST_ADMIN_API_KEY);

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app as INestApplication<App>;
    useThemeViews(app);
    seeded = await ctx.seedTestRealm(REALM);
    cleanup = app.get(SessionsCleanupService);
    await ctx.prisma.realm.update({
      where: { id: seeded.realm.id },
      data: {
        bruteForceEnabled: false,
        refreshTokenLifespan: NORMAL_LIFESPAN,
        offlineTokenLifespan: OFFLINE_LIFESPAN,
      },
    });
    const scope = await ctx.prisma.clientScope.upsert({
      where: {
        realmId_name: { realmId: seeded.realm.id, name: 'offline_access' },
      },
      update: {},
      create: { realmId: seeded.realm.id, name: 'offline_access' },
    });
    await ctx.prisma.clientOptionalScope.create({
      data: { clientId: seeded.client.id, clientScopeId: scope.id },
    });
    // Once a client has scopes assigned it is granted only those, so give it
    // openid too: the logout test needs the ID token.
    const openid = await ctx.prisma.clientScope.upsert({
      where: { realmId_name: { realmId: seeded.realm.id, name: 'openid' } },
      update: {},
      create: { realmId: seeded.realm.id, name: 'openid' },
    });
    await ctx.prisma.clientDefaultScope.create({
      data: { clientId: seeded.client.id, clientScopeId: openid.id },
    });
  }, 30_000);

  afterAll(async () => {
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
  });

  it('gives an offline session the offline lifespan', async () => {
    const { sid } = await offlineSignIn();
    const session = await ctx.prisma.session.findUniqueOrThrow({
      where: { id: sid },
      include: { refreshTokens: true },
    });
    expect(
      (session.expiresAt.getTime() - session.createdAt.getTime()) / 1000,
    ).toBe(OFFLINE_LIFESPAN);
    expect(session.refreshTokens).toHaveLength(1);
    expect(session.refreshTokens[0].isOffline).toBe(true);
    expect(session.refreshTokens[0].expiresAt.getTime()).toBeLessThanOrEqual(
      session.expiresAt.getTime(),
    );
  });

  it('keeps an offline session through the clean-up and refreshes it within the offline lifespan', async () => {
    const first = await offlineSignIn();

    // Two hours on: far past the normal 30-minute lifespan.
    await age(first.sid, 2 * 3600);
    await cleanup.cleanupExpiredSessions();
    expect(await sessionExists(first.sid)).toBe(true);
    const second = await refreshed(first.refresh_token);
    expect(second.scope.split(' ')).toContain('offline_access');

    // Six days on: still inside the seven-day lifespan.
    await age(first.sid, 6 * 24 * 3600);
    await cleanup.cleanupExpiredSessions();
    expect(await sessionExists(first.sid)).toBe(true);
    const third = await refreshed(second.refresh_token);

    // The rotated token never outlives its session.
    const session = await ctx.prisma.session.findUniqueOrThrow({
      where: { id: first.sid },
      include: { refreshTokens: { where: { revoked: false } } },
    });
    expect(session.refreshTokens).toHaveLength(1);
    expect(session.refreshTokens[0].isOffline).toBe(true);
    expect(session.refreshTokens[0].expiresAt.getTime()).toBeLessThanOrEqual(
      session.expiresAt.getTime(),
    );
    expect(third.refresh_token).toBeTruthy();
  });

  it('ends an offline session at the offline lifespan', async () => {
    const { sid, refresh_token } = await offlineSignIn();
    await age(sid, OFFLINE_LIFESPAN + 60);

    // Refused at once, before the clean-up has run.
    await refused(refresh_token);
    const introspection = await http()
      .post(`${base}/token/introspect`)
      .type('form')
      .send({
        token: refresh_token,
        client_id: 'test-client',
        client_secret: SECRET,
      })
      .expect(200);
    expect((introspection.body as { active: boolean }).active).toBe(false);

    await cleanup.cleanupExpiredSessions();
    expect(await sessionExists(sid)).toBe(false);
  });

  it('leaves a normal session at the normal lifespan', async () => {
    const { sid, refresh_token } = await normalSignIn();
    const session = await ctx.prisma.session.findUniqueOrThrow({
      where: { id: sid },
    });
    expect(
      (session.expiresAt.getTime() - session.createdAt.getTime()) / 1000,
    ).toBe(NORMAL_LIFESPAN);

    await age(sid, 2 * 3600);
    await refused(refresh_token);
    await cleanup.cleanupExpiredSessions();
    expect(await sessionExists(sid)).toBe(false);
  });

  it('still rotates offline tokens and revokes the family on reuse', async () => {
    const first = await offlineSignIn();
    const second = await refreshed(first.refresh_token);
    await refused(first.refresh_token);
    // The reuse revoked the whole family, the newest token included.
    await refused(second.refresh_token);
  });

  describe('the per-user session cap (maxSessionsPerUser)', () => {
    const setCap = (maxSessionsPerUser: number) =>
      ctx.prisma.realm.update({
        where: { id: seeded.realm.id },
        data: { maxSessionsPerUser },
      });

    afterEach(async () => {
      await setCap(10);
    });

    it('neither counts nor evicts offline sessions', async () => {
      // Start from no sessions, so only this test's count.
      await admin('delete', `/users/${seeded.user.id}/sessions`).expect(204);
      await setCap(1);

      const offline = await offlineSignIn();
      const firstNormal = await normalSignIn();
      // The offline session did not count: the first normal session is
      // within the cap of 1, and it evicted nothing.
      expect(await sessionExists(offline.sid)).toBe(true);
      expect(await sessionExists(firstNormal.sid)).toBe(true);

      // A second normal session evicts the first, never the offline one.
      const secondNormal = await normalSignIn();
      expect(await sessionExists(firstNormal.sid)).toBe(false);
      expect(await sessionExists(secondNormal.sid)).toBe(true);
      expect(await sessionExists(offline.sid)).toBe(true);
      await refused(firstNormal.refresh_token);
      await refreshed(offline.refresh_token);

      // A new offline session evicts no normal session either.
      const secondOffline = await offlineSignIn();
      expect(await sessionExists(secondNormal.sid)).toBe(true);
      expect(await sessionExists(offline.sid)).toBe(true);
      expect(await sessionExists(secondOffline.sid)).toBe(true);
    });
  });

  describe('revocation', () => {
    it('admin "sign out all sessions" ends offline sessions', async () => {
      const { sid, refresh_token } = await offlineSignIn();
      await age(sid, 2 * 3600);
      await admin('delete', `/users/${seeded.user.id}/sessions`).expect(204);
      expect(await sessionExists(sid)).toBe(false);
      await refused(refresh_token);
    });

    it('disabling the user revokes offline tokens for good', async () => {
      const { sid, refresh_token } = await offlineSignIn();
      await admin('put', `/users/${seeded.user.id}`)
        .send({ enabled: false })
        .expect(200);
      try {
        expect(await sessionExists(sid)).toBe(false);
        await refused(refresh_token);
      } finally {
        await admin('put', `/users/${seeded.user.id}`)
          .send({ enabled: true })
          .expect(200);
      }
      // Re-enabling the user does not bring the old token back.
      await refused(refresh_token);
    });

    it('signing out (RP-initiated logout with the offline id_token) ends the offline session', async () => {
      const tokens = await offlineSignIn();
      const idToken = (tokens as unknown as { id_token?: string }).id_token;
      expect(idToken).toBeTruthy();
      await http().get(`${base}/logout`).query({ id_token_hint: idToken });
      expect(await sessionExists(tokens.sid)).toBe(false);
      await refused(tokens.refresh_token);
    });

    it('a password reset ends offline sessions', async () => {
      const { sid, refresh_token } = await offlineSignIn();
      const token = await app
        .get(VerificationService)
        .createToken(seeded.user.id, 'password_reset', 3600);
      const browser = new Browser(app);
      const form = await browser.get(
        `/realms/${REALM}/reset-password?token=${token}`,
      );
      expect(form.status).toBe(200);
      const res = await browser.post(`/realms/${REALM}/reset-password`, {
        token,
        password: PASSWORD,
        confirmPassword: PASSWORD,
        _csrf: csrfFrom(form.text),
      });
      expect(res.status).toBe(302);
      expect(res.headers['location']).toContain('/login?info=');
      expect(await sessionExists(sid)).toBe(false);
      await refused(refresh_token);
    });

    it('SCIM deactivation ends offline sessions', async () => {
      await admin('patch', '').send({ scimEnabled: true }).expect(200);
      const scimToken = (
        (
          await admin('post', '/scim/tokens')
            .send({ name: 'e2e-offline' })
            .expect(201)
        ).body as { token: string }
      ).token;
      const { sid, refresh_token } = await offlineSignIn();
      const SCIM_JSON = 'application/scim+json';
      await http()
        .patch(`/scim/v2/${REALM}/Users/${seeded.user.id}`)
        .set('Authorization', `Bearer ${scimToken}`)
        .set('Accept', SCIM_JSON)
        .set('Content-Type', SCIM_JSON)
        .send(
          JSON.stringify({
            schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
            Operations: [{ op: 'Replace', path: 'active', value: false }],
          }),
        )
        .expect(200);
      try {
        expect(await sessionExists(sid)).toBe(false);
        await refused(refresh_token);
      } finally {
        await admin('put', `/users/${seeded.user.id}`)
          .send({ enabled: true })
          .expect(200);
      }
    });

    /** Signs in to the account console in a fresh browser. */
    const accountSignIn = async () => {
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
      return browser;
    };

    const ssoSessions = () =>
      ctx.prisma.loginSession.count({ where: { userId: seeded.user.id } });

    it('an admin setting the password ends every session, offline ones included', async () => {
      const offline = await offlineSignIn();
      const normal = await normalSignIn();
      const sso = await accountSignIn();

      await admin('put', `/users/${seeded.user.id}/reset-password`)
        .send({ password: PASSWORD })
        .expect(204);

      expect(await sessionExists(offline.sid)).toBe(false);
      expect(await sessionExists(normal.sid)).toBe(false);
      await refused(offline.refresh_token);
      await refused(normal.refresh_token);
      expect(await ssoSessions()).toBe(0);
      const account = await sso.get(`/realms/${REALM}/account`);
      expect(account.status).toBe(302);
      expect(account.headers['location']).toContain('/login');
    });

    it("an admin removing the user's second factors ends every session", async () => {
      // An admin with a recent MFA check: resetting a user's MFA refuses the
      // API key on purpose.
      const master = await ctx.prisma.realm.findUniqueOrThrow({
        where: { name: 'master' },
        include: { roles: true },
      });
      const superAdmin = master.roles.find(
        (r) => r.name === 'super-admin' && !r.clientId,
      );
      const mfaAdmin = await ctx.prisma.user.create({
        data: {
          realmId: master.id,
          username: 'e2e-offline-mfa-admin',
          enabled: true,
          userRoles: { create: { roleId: superAdmin!.id } },
        },
      });
      try {
        const { access_token: adminToken } = await app
          .get(AdminAuthService)
          .issueAdminToken(mfaAdmin, ['super-admin'], {
            amr: ['pwd', 'otp', 'mfa'],
            acr: ACR_MFA,
          });

        for (const path of ['/mfa', '/mfa/totp', '/mfa/sms']) {
          const offline = await offlineSignIn();
          const normal = await normalSignIn();
          await http()
            .delete(`/admin/realms/${REALM}/users/${seeded.user.id}${path}`)
            .set('authorization', `Bearer ${adminToken}`)
            .expect(204);
          expect(await sessionExists(offline.sid)).toBe(false);
          expect(await sessionExists(normal.sid)).toBe(false);
          await refused(offline.refresh_token);
          expect(await ssoSessions()).toBe(0);
        }
      } finally {
        await ctx.prisma.user.delete({ where: { id: mfaAdmin.id } });
      }
    });

    it('changing the password in the account console ends the other sessions and keeps this one', async () => {
      const offline = await offlineSignIn();
      const normal = await normalSignIn();
      const elsewhere = await accountSignIn();
      const here = await accountSignIn();

      const page = await here.get(`/realms/${REALM}/account`);
      expect(page.status).toBe(200);
      const res = await here.post(`/realms/${REALM}/account/password`, {
        currentPassword: PASSWORD,
        newPassword: PASSWORD,
        confirmPassword: PASSWORD,
        _csrf: csrfFrom(page.text),
      });
      expect(res.status).toBe(302);
      expect(res.headers['location']).toContain('success=');

      // Every other session ended, offline ones included.
      expect(await sessionExists(offline.sid)).toBe(false);
      expect(await sessionExists(normal.sid)).toBe(false);
      await refused(offline.refresh_token);
      const other = await elsewhere.get(`/realms/${REALM}/account`);
      expect(other.status).toBe(302);
      // This browser stays signed in.
      expect(await ssoSessions()).toBe(1);
      expect((await here.get(`/realms/${REALM}/account`)).status).toBe(200);
    });

    // Last: the user is gone afterwards.
    it('deleting the user ends offline sessions', async () => {
      const { sid, refresh_token } = await offlineSignIn();
      await admin('delete', `/users/${seeded.user.id}`).expect(204);
      expect(await sessionExists(sid)).toBe(false);
      await refused(refresh_token);
    });
  });
});
