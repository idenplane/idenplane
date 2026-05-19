import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  createTestApp,
  TEST_ADMIN_API_KEY,
  type SeededRealm,
  type TestContext,
} from './setup';
import { MfaService } from '../src/mfa/mfa.service.js';

describe('MFA Flows (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;

  const REALM_NAME = 'e2e-mfa-flows-realm';
  const API_KEY_HEADER = 'x-admin-api-key';
  const TOKEN_URL = `/realms/${REALM_NAME}/protocol/openid-connect/token`;

  const withKey = (req: request.Test) =>
    req.set(API_KEY_HEADER, TEST_ADMIN_API_KEY);

  /** Helper: get a password-grant access token for testuser. */
  const doPasswordGrant = async () => {
    const res = await request(app.getHttpServer())
      .post(TOKEN_URL)
      .type('form')
      .send({
        grant_type: 'password',
        client_id: 'test-client',
        client_secret: 'test-client-secret',
        username: 'testuser',
        password: 'TestPassword123!',
        scope: 'openid',
      });
    return res;
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

  // ─── 1. INITIAL MFA STATUS ─────────────────────────────────────────────

  describe('MFA status (initially disabled)', () => {
    it('GET .../mfa/status — should report MFA as disabled for a new user', async () => {
      const res = await withKey(
        request(app.getHttpServer()).get(
          `/admin/realms/${REALM_NAME}/users/${seeded.user.id}/mfa/status`,
        ),
      ).expect(200);

      // The admin MFA controller returns { enabled: boolean }
      expect(res.body).toHaveProperty('enabled', false);
    });
  });

  // ─── 2. PASSWORD GRANT WITHOUT MFA ─────────────────────────────────────

  describe('Password grant without MFA', () => {
    it('should succeed with valid credentials when MFA is not enabled', async () => {
      const res = await doPasswordGrant();
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('access_token');
      expect(res.body).toHaveProperty('refresh_token');
      expect(res.body).toHaveProperty('token_type', 'Bearer');
    });

    it('should fail with wrong password', async () => {
      const res = await request(app.getHttpServer())
        .post(TOKEN_URL)
        .type('form')
        .send({
          grant_type: 'password',
          client_id: 'test-client',
          client_secret: 'test-client-secret',
          username: 'testuser',
          password: 'NotTheRightPassword!',
        });

      expect([400, 401]).toContain(res.status);
    });
  });

  // ─── 3. TOTP ENROLLMENT FLOW ───────────────────────────────────────────

  describe('TOTP enrollment flow', () => {
    let totpSecret: string;

    it('should generate a TOTP secret via direct service call', async () => {
      // Call the MfaService directly through Prisma — the account TOTP setup
      // is behind a session-based UI flow, so we drive enrollment via the
      // service layer directly to keep this test self-contained.
      const mfaService = app.get(MfaService);
      const setup = await mfaService.setupTotp(
        seeded.user.id,
        REALM_NAME,
        'testuser',
      );

      expect(setup).toHaveProperty('secret');
      expect(setup).toHaveProperty('otpauthUrl');
      expect(typeof setup.secret).toBe('string');
      totpSecret = setup.secret;
    });

    it('should have a pending (unverified) TOTP credential after setup', async () => {
      const credential = await ctx.prisma.userCredential.findUnique({
        where: { userId_type: { userId: seeded.user.id, type: 'totp' } },
      });

      expect(credential).toBeDefined();
      expect(credential!.verified).toBe(false);
    });

    it('should activate TOTP with a valid TOTP code', async () => {
      // Generate a valid TOTP code using the secret
      const OTPAuth = await import('otpauth');
      const totp = new OTPAuth.TOTP({
        secret: OTPAuth.Secret.fromBase32(totpSecret),
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
      });
      const validCode = totp.generate();

      const mfaService = app.get(MfaService);
      const recoveryCodes = await mfaService.verifyAndActivateTotp(
        seeded.user.id,
        validCode,
      );

      // Returns array of recovery codes on success, null on failure
      expect(Array.isArray(recoveryCodes)).toBe(true);
      expect(recoveryCodes!.length).toBeGreaterThanOrEqual(1);
    });

    it('should report MFA as enabled after activation', async () => {
      const res = await withKey(
        request(app.getHttpServer()).get(
          `/admin/realms/${REALM_NAME}/users/${seeded.user.id}/mfa/status`,
        ),
      ).expect(200);

      expect(res.body).toHaveProperty('enabled', true);
    });

    it('should have recovery codes stored in the database', async () => {
      const codes = await ctx.prisma.recoveryCode.findMany({
        where: { userId: seeded.user.id, used: false },
      });

      expect(codes.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── 4. RECOVERY CODE GENERATION AND USAGE ────────────────────────────

  describe('Recovery code usage', () => {
    it('should consume a recovery code via the service', async () => {
      // Get one real recovery code (raw text was returned during activation;
      // we regenerate via the service to get fresh raw codes for testing)
      const mfaService = app.get(MfaService);

      // Generate fresh recovery codes (re-generation is idempotent)
      const freshCodes = await mfaService.generateRecoveryCodes(seeded.user.id);
      expect(freshCodes.length).toBeGreaterThanOrEqual(1);

      const codeToUse = freshCodes[0]!;

      // First use — should succeed
      const firstResult = await mfaService.verifyRecoveryCode(
        seeded.user.id,
        codeToUse,
      );
      expect(firstResult).toBe(true);

      // Second use of the same code — must fail (single-use)
      const secondResult = await mfaService.verifyRecoveryCode(
        seeded.user.id,
        codeToUse,
      );
      expect(secondResult).toBe(false);
    });

    it('should reject an invalid recovery code', async () => {
      const mfaService = app.get(MfaService);
      const result = await mfaService.verifyRecoveryCode(
        seeded.user.id,
        'TOTALLY-INVALID-CODE',
      );
      expect(result).toBe(false);
    });
  });

  // ─── 5. MFA DISABLE FLOW ───────────────────────────────────────────────

  describe('MFA disable flow', () => {
    it('DELETE .../mfa — should reject API-key auth (MFA step-up required)', async () => {
      // Resetting a user's MFA requires an MFA-verified interactive admin
      // session; static admin API keys are deliberately forbidden for this
      // account-recovery operation (issue #613 / BUG #3). The harness only
      // has the API key, so it must be rejected with 401.
      await withKey(
        request(app.getHttpServer()).delete(
          `/admin/realms/${REALM_NAME}/users/${seeded.user.id}/mfa`,
        ),
      ).expect(401);
    });

    it('disables TOTP via the service layer (step-up UI flow not driveable in e2e)', async () => {
      // Mirror the enrollment tests: the privileged disable is exercised
      // through the service directly so the post-conditions below can be
      // verified without an MFA-stepped-up session.
      const mfaService = app.get(MfaService);
      await mfaService.disableTotp(seeded.user.id);
    });

    it('MFA status should be disabled after deletion', async () => {
      const res = await withKey(
        request(app.getHttpServer()).get(
          `/admin/realms/${REALM_NAME}/users/${seeded.user.id}/mfa/status`,
        ),
      ).expect(200);

      expect(res.body).toHaveProperty('enabled', false);
    });

    it('should have no TOTP credential in the database after disable', async () => {
      const credential = await ctx.prisma.userCredential.findUnique({
        where: { userId_type: { userId: seeded.user.id, type: 'totp' } },
      });
      expect(credential).toBeNull();
    });

    it('should have no recovery codes after MFA disable', async () => {
      const codes = await ctx.prisma.recoveryCode.findMany({
        where: { userId: seeded.user.id },
      });
      expect(codes.length).toBe(0);
    });

    it('DELETE .../mfa — still rejects API-key auth when MFA is already disabled', async () => {
      // The step-up requirement is enforced regardless of MFA state.
      await withKey(
        request(app.getHttpServer()).delete(
          `/admin/realms/${REALM_NAME}/users/${seeded.user.id}/mfa`,
        ),
      ).expect(401);
    });

    it('password grant should work normally after MFA is disabled', async () => {
      const res = await doPasswordGrant();
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('access_token');
    });
  });
});
