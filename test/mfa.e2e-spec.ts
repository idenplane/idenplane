import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  createTestApp,
  TEST_ADMIN_API_KEY,
  type SeededRealm,
  type TestContext,
} from './setup';

describe('MFA (TOTP) flows (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;

  const REALM_NAME = 'e2e-mfa-realm';
  const API_KEY_HEADER = 'x-admin-api-key';

  /** Helper: perform an admin request with the API key set. */
  const adminRequest = () => request(app.getHttpServer());
  const withKey = (req: request.Test) =>
    req.set(API_KEY_HEADER, TEST_ADMIN_API_KEY);

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    seeded = await ctx.seedTestRealm(REALM_NAME);
  });

  afterAll(async () => {
    // Clean up the seeded realm
    await ctx.prisma.realm
      .delete({ where: { name: REALM_NAME } })
      .catch(() => {});
    await ctx.cleanup();
  });

  // ─── MFA STATUS CHECK ──────────────────────────────────────

  describe('MFA status (initially disabled)', () => {
    it('GET /admin/realms/:name/users/:userId/mfa/status — should report MFA as disabled', async () => {
      const res = await withKey(
        adminRequest().get(
          `/admin/realms/${REALM_NAME}/users/${seeded.user.id}/mfa/status`,
        ),
      ).expect(200);

      expect(res.body).toHaveProperty('enabled', false);
    });
  });

  // ─── PASSWORD GRANT WITHOUT MFA ─────────────────────────────

  describe('Password grant without MFA', () => {
    it('POST /realms/:name/protocol/openid-connect/token — should succeed with valid credentials', async () => {
      const res = await request(app.getHttpServer())
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
      expect(res.body).toHaveProperty('token_type', 'Bearer');
      expect(res.body).toHaveProperty('expires_in');
    });

    it('POST /realms/:name/protocol/openid-connect/token — should fail with wrong password', async () => {
      await request(app.getHttpServer())
        .post(`/realms/${REALM_NAME}/protocol/openid-connect/token`)
        .send({
          grant_type: 'password',
          client_id: 'test-client',
          client_secret: 'test-client-secret',
          username: 'testuser',
          password: 'WrongPassword!',
        })
        .expect(401);
    });
  });

  // ─── RESET / DISABLE MFA ──────────────────────────────────

  describe('Reset/disable MFA', () => {
    // Resetting another user's MFA is a sensitive account-recovery operation.
    // It deliberately requires an MFA-verified interactive admin session
    // (step-up) and forbids static admin API keys (see issue #613 / the
    // BUG #3 regression test). The E2E harness only has the API key, so the
    // correct, secure expectation here is a 401 rejection.
    it('DELETE /admin/realms/:name/users/:userId/mfa — should reject API-key auth (MFA step-up required)', async () => {
      await withKey(
        adminRequest().delete(
          `/admin/realms/${REALM_NAME}/users/${seeded.user.id}/mfa`,
        ),
      ).expect(401);
    });
  });

  // ─── MFA STATUS AFTER DISABLE ─────────────────────────────

  describe('MFA status after disable', () => {
    it('GET /admin/realms/:name/users/:userId/mfa/status — should still report MFA as disabled', async () => {
      const res = await withKey(
        adminRequest().get(
          `/admin/realms/${REALM_NAME}/users/${seeded.user.id}/mfa/status`,
        ),
      ).expect(200);

      expect(res.body).toHaveProperty('enabled', false);
    });
  });

  // ─── PASSWORD GRANT STILL WORKS AFTER MFA DISABLE ─────────

  describe('Password grant still works after MFA disable', () => {
    it('POST /realms/:name/protocol/openid-connect/token — should still succeed after MFA reset', async () => {
      const res = await request(app.getHttpServer())
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
      expect(res.body).toHaveProperty('token_type', 'Bearer');
    });
  });
});
