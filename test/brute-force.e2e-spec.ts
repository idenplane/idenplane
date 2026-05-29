import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  createTestApp,
  TEST_ADMIN_API_KEY,
  type SeededRealm,
  type TestContext,
} from './setup';
import { BruteForceService } from '../src/brute-force/brute-force.service.js';

describe('Brute-Force Protection (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;

  const REALM_NAME = 'e2e-brute-force-realm';
  const API_KEY_HEADER = 'x-admin-api-key';
  const TOKEN_URL = `/realms/${REALM_NAME}/protocol/openid-connect/token`;

  const withKey = (req: request.Test) =>
    req.set(API_KEY_HEADER, TEST_ADMIN_API_KEY);

  /** Helper: attempt a password grant with bad credentials. */
  const failedLogin = () =>
    request(app.getHttpServer())
      .post(TOKEN_URL)
      .type('form')
      .send({
        grant_type: 'password',
        client_id: 'test-client',
        client_secret: 'test-client-secret',
        username: 'testuser',
        password: 'WrongPassword999!',
      });

  /** Helper: attempt a password grant with correct credentials. */
  const successfulLogin = () =>
    request(app.getHttpServer())
      .post(TOKEN_URL)
      .type('form')
      .send({
        grant_type: 'password',
        client_id: 'test-client',
        client_secret: 'test-client-secret',
        username: 'testuser',
        password: 'TestPassword123!',
      });

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    seeded = await ctx.seedTestRealm(REALM_NAME);

    // Enable brute-force protection on the realm with a low threshold
    // so tests complete quickly (3 failures → lockout for 2 seconds)
    await ctx.prisma.realm.update({
      where: { name: REALM_NAME },
      data: {
        bruteForceEnabled: true,
        maxLoginFailures: 3,
        lockoutDuration: 2,       // 2-second lockout for fast tests
        failureResetTime: 300,    // 5-minute window
        permanentLockoutAfter: 0, // disabled
      },
    });
  }, 30_000);

  afterAll(async () => {
    await ctx.prisma.realm
      .delete({ where: { name: REALM_NAME } })
      .catch(() => {});
    await ctx.cleanup();
  });

  // ─── HELPERS ─────────────────────────────────────────────────────────────

  /** Reset failure counter and unlock the test user between test groups. */
  const resetUser = async () => {
    await ctx.prisma.loginFailure.deleteMany({
      where: { realmId: seeded.realm.id, userId: seeded.user.id },
    });
    await ctx.prisma.user.update({
      where: { id: seeded.user.id },
      data: { lockedUntil: null, enabled: true },
    });
  };

  // ─── 1. SUCCESSFUL LOGIN CLEARS FAILURE COUNTER ──────────────────────────

  describe('Successful login resets the failure counter', () => {
    beforeAll(resetUser);

    it('should record failure attempts without locking', async () => {
      // Two failures (below threshold of 3)
      for (let i = 0; i < 2; i++) {
        const res = await failedLogin();
        expect([400, 401]).toContain(res.status);
      }
    });

    it('should allow a successful login before the threshold', async () => {
      const res = await successfulLogin();
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('access_token');
    });

    it('should have cleared failure records after a successful login', async () => {
      const failures = await ctx.prisma.loginFailure.count({
        where: { realmId: seeded.realm.id, userId: seeded.user.id },
      });
      expect(failures).toBe(0);
    });
  });

  // ─── 2. ACCOUNT LOCKOUT AFTER N FAILED ATTEMPTS ──────────────────────────

  describe('Account lockout after N failed attempts', () => {
    beforeAll(resetUser);

    it('should reject logins with 401 for wrong password', async () => {
      // Exhaust the failure quota (maxLoginFailures = 3)
      for (let i = 0; i < 3; i++) {
        const res = await failedLogin();
        expect([400, 401]).toContain(res.status);
      }
    });

    it('should lock the user account after maxLoginFailures exceeded', async () => {
      const user = await ctx.prisma.user.findUnique({
        where: { id: seeded.user.id },
        select: { lockedUntil: true },
      });

      expect(user).toBeDefined();
      expect(user!.lockedUntil).not.toBeNull();
      expect(user!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    });

    it('should reject further login attempts when account is locked', async () => {
      // Even with correct credentials, the account is locked
      const res = await successfulLogin();
      expect([400, 401, 423]).toContain(res.status);
      expect(res.body).toHaveProperty('error');
    });
  });

  // ─── 3. LOCKOUT DURATION AND AUTO-UNLOCK ─────────────────────────────────

  describe('Lockout duration and auto-unlock', () => {
    beforeAll(resetUser);

    it('should lock the user after threshold failures', async () => {
      for (let i = 0; i < 3; i++) {
        await failedLogin();
      }

      const lockedUser = await ctx.prisma.user.findUnique({
        where: { id: seeded.user.id },
        select: { lockedUntil: true },
      });
      expect(lockedUser!.lockedUntil).not.toBeNull();
    });

    it('should allow login after the lockout duration expires', async () => {
      // Wait for the 2-second lockout to expire
      await new Promise<void>((resolve) => setTimeout(resolve, 2_500));

      // The service checks lockedUntil > now in-memory, so the user is auto-unlocked
      const res = await successfulLogin();
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('access_token');
    });
  });

  // ─── 4. ADMIN UNLOCK ───────────────────────────────────────────────────

  describe('Admin unlock endpoint', () => {
    beforeAll(resetUser);

    it('should lock the user after N failures', async () => {
      for (let i = 0; i < 3; i++) {
        await failedLogin();
      }

      const user = await ctx.prisma.user.findUnique({
        where: { id: seeded.user.id },
        select: { lockedUntil: true },
      });
      expect(user!.lockedUntil).not.toBeNull();
    });

    it('GET /admin/realms/:name/brute-force/locked-users — should list the locked user', async () => {
      const res = await withKey(
        request(app.getHttpServer()).get(
          `/admin/realms/${REALM_NAME}/brute-force/locked-users`,
        ),
      ).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const found = res.body.find(
        (u: { id: string }) => u.id === seeded.user.id,
      );
      expect(found).toBeDefined();
      expect(found).toHaveProperty('lockedUntil');
    });

    it('POST .../brute-force/users/:userId/unlock — should reject API-key auth (MFA step-up required)', async () => {
      // Unlocking a brute-force-locked account is a sensitive operation that
      // requires an MFA-verified interactive admin session; static admin API
      // keys are deliberately forbidden (same step-up control as MFA reset).
      await withKey(
        request(app.getHttpServer()).post(
          `/admin/realms/${REALM_NAME}/brute-force/users/${seeded.user.id}/unlock`,
        ),
      ).expect(401);
    });

    it('unlocks the user via the service layer (step-up UI flow not driveable in e2e)', async () => {
      const bruteForceService = app.get(BruteForceService);
      await bruteForceService.unlockUser(seeded.realm.id, seeded.user.id);
    });

    it('should allow login after admin unlock', async () => {
      const res = await successfulLogin();
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('access_token');
    });

    it('locked-users list should not include the user after unlock', async () => {
      const res = await withKey(
        request(app.getHttpServer()).get(
          `/admin/realms/${REALM_NAME}/brute-force/locked-users`,
        ),
      ).expect(200);

      const found = res.body.find(
        (u: { id: string }) => u.id === seeded.user.id,
      );
      expect(found).toBeUndefined();
    });
  });

  // ─── 5. PERMANENT LOCKOUT THRESHOLD ──────────────────────────────────────

  describe('Permanent lockout threshold', () => {
    beforeAll(async () => {
      await resetUser();
      // Enable permanent lockout after 1 lockout cycle
      await ctx.prisma.realm.update({
        where: { name: REALM_NAME },
        data: { permanentLockoutAfter: 1 },
      });
    });

    afterAll(async () => {
      // Restore to no permanent lockout and re-enable user
      await ctx.prisma.realm.update({
        where: { name: REALM_NAME },
        data: { permanentLockoutAfter: 0 },
      });
      await ctx.prisma.user.update({
        where: { id: seeded.user.id },
        data: { lockedUntil: null, enabled: true },
      });
      await ctx.prisma.loginFailure.deleteMany({
        where: { realmId: seeded.realm.id, userId: seeded.user.id },
      });
    });

    it('should permanently lock the user after reaching permanentLockoutAfter cycles', async () => {
      // First lockout cycle: exhaust maxLoginFailures (3 failures)
      for (let i = 0; i < 3; i++) {
        await failedLogin();
      }

      // Wait briefly, then trigger another failure cycle to cross the threshold
      await new Promise<void>((resolve) => setTimeout(resolve, 2_500));

      for (let i = 0; i < 3; i++) {
        await failedLogin();
      }

      const user = await ctx.prisma.user.findUnique({
        where: { id: seeded.user.id },
        select: { lockedUntil: true, enabled: true },
      });

      // Permanently locked: enabled=false and lockedUntil is far in the future
      expect(user).toBeDefined();
      // After permanent lockout the account is disabled
      expect(user!.enabled).toBe(false);
    });

    it('permanently locked user cannot log in even after lockout duration', async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 2_500));

      const res = await successfulLogin();
      expect([400, 401, 423]).toContain(res.status);
    });
  });
});
