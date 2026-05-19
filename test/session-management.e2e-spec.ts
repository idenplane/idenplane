import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  createTestApp,
  TEST_ADMIN_API_KEY,
  type SeededRealm,
  type TestContext,
} from './setup';

describe('Session Management API (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;

  const REALM_NAME = 'e2e-session-realm';
  const API_KEY_HEADER = 'x-admin-api-key';

  /** Helper: perform a request against the running app. */
  const adminRequest = () => request(app.getHttpServer());
  /** Helper: attach the admin API key to a request. */
  const withKey = (req: request.Test) =>
    req.set(API_KEY_HEADER, TEST_ADMIN_API_KEY);

  /** Helper: perform a password grant and return the token response body. */
  const doPasswordGrant = async () => {
    const res = await adminRequest()
      .post(`/realms/${REALM_NAME}/protocol/openid-connect/token`)
      .send({
        grant_type: 'password',
        client_id: 'test-client',
        client_secret: 'test-client-secret',
        username: 'testuser',
        password: 'TestPassword123!',
      })
      .expect(200);

    expect(res.body).toHaveProperty('access_token');
    expect(res.body).toHaveProperty('refresh_token');
    return res.body as {
      access_token: string;
      refresh_token: string;
      token_type: string;
    };
  };

  /** Helper: attempt a refresh_token grant. */
  const doRefreshGrant = async (refreshToken: string) => {
    return adminRequest()
      .post(`/realms/${REALM_NAME}/protocol/openid-connect/token`)
      .send({
        grant_type: 'refresh_token',
        client_id: 'test-client',
        client_secret: 'test-client-secret',
        refresh_token: refreshToken,
      });
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    seeded = await ctx.seedTestRealm(REALM_NAME);
  }, 30_000);

  afterAll(async () => {
    await ctx.prisma.realm
      .delete({ where: { name: REALM_NAME } })
      .catch(() => {});
    await ctx.cleanup();
  });

  // ─── 1. LOGIN CREATES A SESSION ───────────────────────────

  describe('Login creates a session', () => {
    it('password grant should create an OAuth session visible in admin API', async () => {
      // Perform a password grant to create a session
      await doPasswordGrant();

      // Query the admin sessions endpoint
      const res = await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}/sessions`),
      ).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);

      // At least one session should belong to our test user
      const userSession = res.body.find(
        (s: { userId: string }) => s.userId === seeded.user.id,
      );
      expect(userSession).toBeDefined();
      expect(userSession).toHaveProperty('type', 'oauth');
      expect(userSession).toHaveProperty('username', 'testuser');
    });
  });

  // ─── 2. GET USER SESSIONS ────────────────────────────────

  describe('Get user sessions', () => {
    it('GET /admin/realms/:name/users/:userId/sessions — should list sessions for the user', async () => {
      const res = await withKey(
        adminRequest().get(
          `/admin/realms/${REALM_NAME}/users/${seeded.user.id}/sessions`,
        ),
      ).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);

      // Every session should belong to the queried user
      for (const session of res.body) {
        expect(session.userId).toBe(seeded.user.id);
      }
    });
  });

  // ─── 3. LOGOUT ENDPOINT ──────────────────────────────────

  describe('Logout endpoint', () => {
    let refreshToken: string;

    it('should obtain tokens via password grant', async () => {
      const tokens = await doPasswordGrant();
      refreshToken = tokens.refresh_token;
    });

    it('POST /realms/:name/protocol/openid-connect/logout — should return 204', async () => {
      await adminRequest()
        .post(`/realms/${REALM_NAME}/protocol/openid-connect/logout`)
        .send({ refresh_token: refreshToken })
        .expect(204);
    });

    it('refresh grant should fail after logout', async () => {
      const res = await doRefreshGrant(refreshToken);

      // The refresh token should be invalidated — expect 400 or 401
      expect([400, 401]).toContain(res.status);
    });
  });

  // ─── 4. REVOKE ALL USER SESSIONS ─────────────────────────

  describe('Revoke all user sessions via admin API', () => {
    let refreshToken: string;

    it('should obtain tokens via password grant', async () => {
      const tokens = await doPasswordGrant();
      refreshToken = tokens.refresh_token;
    });

    it('DELETE /admin/realms/:name/users/:userId/sessions — should revoke all sessions', async () => {
      await withKey(
        adminRequest().delete(
          `/admin/realms/${REALM_NAME}/users/${seeded.user.id}/sessions`,
        ),
      ).expect(204);
    });

    it('refresh grant should fail after all sessions are revoked', async () => {
      const res = await doRefreshGrant(refreshToken);

      // The refresh token should be invalidated — expect 400 or 401
      expect([400, 401]).toContain(res.status);
    });

    it('user sessions list should be empty after revocation', async () => {
      const res = await withKey(
        adminRequest().get(
          `/admin/realms/${REALM_NAME}/users/${seeded.user.id}/sessions`,
        ),
      ).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0);
    });
  });
});
