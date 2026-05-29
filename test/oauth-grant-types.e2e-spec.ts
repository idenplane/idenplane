import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createHmac } from 'crypto';
import {
  createTestApp,
  TEST_ADMIN_API_KEY,
  type SeededRealm,
  type TestContext,
} from './setup';

describe('OAuth 2.0 Grant Types (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;

  const REALM_NAME = 'e2e-grant-types-realm';
  const TOKEN_URL = `/realms/${REALM_NAME}/protocol/openid-connect/token`;
  const DEVICE_AUTH_URL = `/realms/${REALM_NAME}/protocol/openid-connect/auth/device`;
  const API_KEY_HEADER = 'x-admin-api-key';

  const withKey = (req: request.Test) =>
    req.set(API_KEY_HEADER, TEST_ADMIN_API_KEY);

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    seeded = await ctx.seedTestRealm(REALM_NAME);

    // Add device_code grant type to the existing test client
    await ctx.prisma.client.updateMany({
      where: { realmId: seeded.realm.id, clientId: 'test-client' },
      data: {
        grantTypes: [
          'authorization_code',
          'client_credentials',
          'password',
          'refresh_token',
          'urn:ietf:params:oauth:grant-type:device_code',
        ],
      },
    });
  }, 30_000);

  afterAll(async () => {
    await ctx.prisma.realm
      .delete({ where: { name: REALM_NAME } })
      .catch(() => {});
    await ctx.cleanup();
  });

  // ─── 1. AUTHORIZATION CODE WITH PKCE (S256) ──────────────────────────────

  describe('Authorization Code with PKCE (S256)', () => {
    let authCode: string;

    it('should create an authorization code via direct DB seeding (PKCE S256)', async () => {
      const { randomBytes, createHash } = await import('crypto');

      // Generate PKCE code_verifier and code_challenge
      const codeVerifier = randomBytes(32).toString('base64url');
      const codeChallenge = createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');

      // Seed an authorization code directly (simulates the login page issuing the code)
      const client = await ctx.prisma.client.findFirst({
        where: { realmId: seeded.realm.id, clientId: 'test-client' },
      });
      expect(client).toBeDefined();

      const code = randomBytes(32).toString('hex');
      await ctx.prisma.authorizationCode.create({
        data: {
          code,
          clientId: client!.id,
          userId: seeded.user.id,
          redirectUri: 'http://localhost:3000/callback',
          scope: 'openid',
          codeChallenge,
          codeChallengeMethod: 'S256',
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      // Exchange the code for tokens using code_verifier
      const tokenRes = await request(app.getHttpServer())
        .post(TOKEN_URL)
        .type('form')
        .send({
          grant_type: 'authorization_code',
          code,
          client_id: 'test-client',
          client_secret: 'test-client-secret',
          redirect_uri: 'http://localhost:3000/callback',
          code_verifier: codeVerifier,
        })
        .expect(200);

      expect(tokenRes.body).toHaveProperty('access_token');
      expect(tokenRes.body).toHaveProperty('refresh_token');
      expect(tokenRes.body).toHaveProperty('token_type', 'Bearer');
      expect(tokenRes.body).toHaveProperty('expires_in');

      authCode = code;
    });

    it('should reject reuse of the same authorization code', async () => {
      const { randomBytes, createHash } = await import('crypto');
      const codeVerifier = randomBytes(32).toString('base64url');
      const codeChallenge = createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');

      const client = await ctx.prisma.client.findFirst({
        where: { realmId: seeded.realm.id, clientId: 'test-client' },
      });

      const code = randomBytes(32).toString('hex');
      await ctx.prisma.authorizationCode.create({
        data: {
          code,
          clientId: client!.id,
          userId: seeded.user.id,
          redirectUri: 'http://localhost:3000/callback',
          scope: 'openid',
          codeChallenge,
          codeChallengeMethod: 'S256',
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      // First use — should succeed
      await request(app.getHttpServer())
        .post(TOKEN_URL)
        .type('form')
        .send({
          grant_type: 'authorization_code',
          code,
          client_id: 'test-client',
          client_secret: 'test-client-secret',
          redirect_uri: 'http://localhost:3000/callback',
          code_verifier: codeVerifier,
        })
        .expect(200);

      // Second use — should fail (code replay)
      const replayRes = await request(app.getHttpServer())
        .post(TOKEN_URL)
        .type('form')
        .send({
          grant_type: 'authorization_code',
          code,
          client_id: 'test-client',
          client_secret: 'test-client-secret',
          redirect_uri: 'http://localhost:3000/callback',
          code_verifier: codeVerifier,
        });

      expect([400, 401]).toContain(replayRes.status);
      expect(replayRes.body).toHaveProperty('error');
    });

    it('should reject an invalid code_verifier (wrong PKCE)', async () => {
      const { randomBytes, createHash } = await import('crypto');
      const codeVerifier = randomBytes(32).toString('base64url');
      const codeChallenge = createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');

      const client = await ctx.prisma.client.findFirst({
        where: { realmId: seeded.realm.id, clientId: 'test-client' },
      });

      const code = randomBytes(32).toString('hex');
      await ctx.prisma.authorizationCode.create({
        data: {
          code,
          clientId: client!.id,
          userId: seeded.user.id,
          redirectUri: 'http://localhost:3000/callback',
          scope: 'openid',
          codeChallenge,
          codeChallengeMethod: 'S256',
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      const res = await request(app.getHttpServer())
        .post(TOKEN_URL)
        .type('form')
        .send({
          grant_type: 'authorization_code',
          code,
          client_id: 'test-client',
          client_secret: 'test-client-secret',
          redirect_uri: 'http://localhost:3000/callback',
          code_verifier: 'wrong-verifier-that-does-not-match-the-challenge',
        });

      expect([400, 401]).toContain(res.status);
      expect(res.body).toHaveProperty('error');
    });

    it('should reject a missing code_verifier when code_challenge was set', async () => {
      const { randomBytes, createHash } = await import('crypto');
      const codeVerifier = randomBytes(32).toString('base64url');
      const codeChallenge = createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');

      const client = await ctx.prisma.client.findFirst({
        where: { realmId: seeded.realm.id, clientId: 'test-client' },
      });

      const code = randomBytes(32).toString('hex');
      await ctx.prisma.authorizationCode.create({
        data: {
          code,
          clientId: client!.id,
          userId: seeded.user.id,
          redirectUri: 'http://localhost:3000/callback',
          scope: 'openid',
          codeChallenge,
          codeChallengeMethod: 'S256',
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      const res = await request(app.getHttpServer())
        .post(TOKEN_URL)
        .type('form')
        .send({
          grant_type: 'authorization_code',
          code,
          client_id: 'test-client',
          client_secret: 'test-client-secret',
          redirect_uri: 'http://localhost:3000/callback',
          // no code_verifier
        });

      expect([400, 401]).toContain(res.status);
      expect(res.body).toHaveProperty('error');
    });
  });

  // ─── 2. CLIENT CREDENTIALS GRANT ──────────────────────────────────────────

  describe('Client Credentials Grant', () => {
    it('should return an access_token with no refresh_token', async () => {
      const res = await request(app.getHttpServer())
        .post(TOKEN_URL)
        .type('form')
        .send({
          grant_type: 'client_credentials',
          client_id: 'test-client',
          client_secret: 'test-client-secret',
        })
        .expect(200);

      expect(res.body).toHaveProperty('access_token');
      expect(res.body).toHaveProperty('token_type', 'Bearer');
      expect(res.body).toHaveProperty('expires_in');
      expect(typeof res.body.expires_in).toBe('number');
      // Client credentials grant must NOT return a refresh_token (RFC 6749 §4.4)
      expect(res.body).not.toHaveProperty('refresh_token');
    });

    it('should reject an invalid client secret', async () => {
      const res = await request(app.getHttpServer())
        .post(TOKEN_URL)
        .type('form')
        .send({
          grant_type: 'client_credentials',
          client_id: 'test-client',
          client_secret: 'totally-wrong-secret',
        })
        .expect(401);

      expect(res.body).toHaveProperty('error');
    });

    it('should reject a non-existent client_id', async () => {
      const res = await request(app.getHttpServer())
        .post(TOKEN_URL)
        .type('form')
        .send({
          grant_type: 'client_credentials',
          client_id: 'no-such-client',
          client_secret: 'test-client-secret',
        });

      expect([400, 401, 404]).toContain(res.status);
      expect(res.body).toHaveProperty('error');
    });
  });

  // ─── 3. DEVICE AUTHORIZATION GRANT ────────────────────────────────────────

  describe('Device Authorization Grant', () => {
    it('should initiate device authorization and return device_code and user_code', async () => {
      const res = await request(app.getHttpServer())
        .post(DEVICE_AUTH_URL)
        .send({
          client_id: 'test-client',
          scope: 'openid',
        })
        .expect(200);

      expect(res.body).toHaveProperty('device_code');
      expect(res.body).toHaveProperty('user_code');
      expect(res.body).toHaveProperty('verification_uri');
      expect(res.body).toHaveProperty('expires_in');
      expect(res.body).toHaveProperty('interval');
      expect(typeof res.body.device_code).toBe('string');
      expect(typeof res.body.user_code).toBe('string');
    });

    it('should return authorization_pending when device has not been approved yet', async () => {
      // Initiate the device flow
      const initRes = await request(app.getHttpServer())
        .post(DEVICE_AUTH_URL)
        .send({ client_id: 'test-client' })
        .expect(200);

      const { device_code } = initRes.body;

      // Poll before approval — should return authorization_pending
      const pollRes = await request(app.getHttpServer())
        .post(TOKEN_URL)
        .type('form')
        .send({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code,
          client_id: 'test-client',
          client_secret: 'test-client-secret',
        });

      // Expect 400 with authorization_pending
      expect([400]).toContain(pollRes.status);
      expect(pollRes.body.error).toContain('authorization_pending');
    });

    it('should issue tokens after the device code is approved', async () => {
      // Initiate the device flow
      const initRes = await request(app.getHttpServer())
        .post(DEVICE_AUTH_URL)
        .send({ client_id: 'test-client' })
        .expect(200);

      const { device_code, user_code } = initRes.body;

      // Simulate user approval by directly updating the DB
      await ctx.prisma.deviceCode.update({
        where: { userCode: user_code },
        data: {
          approved: true,
          userId: seeded.user.id,
          // Reset lastPolledAt so we don't hit slow_down
          lastPolledAt: null,
        },
      });

      // Poll — now the code is approved
      const tokenRes = await request(app.getHttpServer())
        .post(TOKEN_URL)
        .type('form')
        .send({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code,
          client_id: 'test-client',
          client_secret: 'test-client-secret',
        })
        .expect(200);

      expect(tokenRes.body).toHaveProperty('access_token');
      expect(tokenRes.body).toHaveProperty('token_type', 'Bearer');
    });

    it('should return access_denied when device code is denied', async () => {
      const initRes = await request(app.getHttpServer())
        .post(DEVICE_AUTH_URL)
        .send({ client_id: 'test-client' })
        .expect(200);

      const { user_code, device_code } = initRes.body;

      // Simulate user denial
      await ctx.prisma.deviceCode.update({
        where: { userCode: user_code },
        data: { denied: true, lastPolledAt: null },
      });

      const res = await request(app.getHttpServer())
        .post(TOKEN_URL)
        .type('form')
        .send({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code,
          client_id: 'test-client',
          client_secret: 'test-client-secret',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('access_denied');
    });
  });

  // ─── 4. REFRESH TOKEN GRANT ───────────────────────────────────────────────

  describe('Refresh Token Grant', () => {
    it('should issue a new access_token and rotated refresh_token', async () => {
      // Obtain initial tokens via password grant
      const tokenRes = await request(app.getHttpServer())
        .post(TOKEN_URL)
        .type('form')
        .send({
          grant_type: 'password',
          client_id: 'test-client',
          client_secret: 'test-client-secret',
          username: 'testuser',
          password: 'TestPassword123!',
          scope: 'openid',
        })
        .expect(200);

      const originalRefreshToken = tokenRes.body.refresh_token;
      expect(originalRefreshToken).toBeDefined();

      // Exchange refresh_token for new tokens
      const refreshRes = await request(app.getHttpServer())
        .post(TOKEN_URL)
        .type('form')
        .send({
          grant_type: 'refresh_token',
          refresh_token: originalRefreshToken,
          client_id: 'test-client',
          client_secret: 'test-client-secret',
        })
        .expect(200);

      expect(refreshRes.body).toHaveProperty('access_token');
      expect(refreshRes.body).toHaveProperty('refresh_token');
      expect(refreshRes.body).toHaveProperty('token_type', 'Bearer');
      // Refresh token rotation — new token must differ
      expect(refreshRes.body.refresh_token).not.toBe(originalRefreshToken);
    });

    it('should preserve scope after refresh', async () => {
      const tokenRes = await request(app.getHttpServer())
        .post(TOKEN_URL)
        .type('form')
        .send({
          grant_type: 'password',
          client_id: 'test-client',
          client_secret: 'test-client-secret',
          username: 'testuser',
          password: 'TestPassword123!',
          scope: 'openid',
        })
        .expect(200);

      const refreshRes = await request(app.getHttpServer())
        .post(TOKEN_URL)
        .type('form')
        .send({
          grant_type: 'refresh_token',
          refresh_token: tokenRes.body.refresh_token,
          client_id: 'test-client',
          client_secret: 'test-client-secret',
        })
        .expect(200);

      // scope should be present and include openid
      expect(refreshRes.body).toHaveProperty('scope');
      expect(refreshRes.body.scope).toContain('openid');
    });

    it('should reject an invalid refresh_token', async () => {
      const res = await request(app.getHttpServer())
        .post(TOKEN_URL)
        .type('form')
        .send({
          grant_type: 'refresh_token',
          refresh_token: 'not-a-real-token',
          client_id: 'test-client',
          client_secret: 'test-client-secret',
        });

      expect([400, 401]).toContain(res.status);
      expect(res.body).toHaveProperty('error');
    });

    it('should reject reuse of a consumed refresh_token', async () => {
      // Obtain initial tokens
      const tokenRes = await request(app.getHttpServer())
        .post(TOKEN_URL)
        .type('form')
        .send({
          grant_type: 'password',
          client_id: 'test-client',
          client_secret: 'test-client-secret',
          username: 'testuser',
          password: 'TestPassword123!',
          scope: 'openid',
        })
        .expect(200);

      const oldRefreshToken = tokenRes.body.refresh_token;

      // First refresh — consumes old token and rotates
      await request(app.getHttpServer())
        .post(TOKEN_URL)
        .type('form')
        .send({
          grant_type: 'refresh_token',
          refresh_token: oldRefreshToken,
          client_id: 'test-client',
          client_secret: 'test-client-secret',
        })
        .expect(200);

      // Second refresh with the old (now consumed) token — must fail
      const replayRes = await request(app.getHttpServer())
        .post(TOKEN_URL)
        .type('form')
        .send({
          grant_type: 'refresh_token',
          refresh_token: oldRefreshToken,
          client_id: 'test-client',
          client_secret: 'test-client-secret',
        });

      expect([400, 401]).toContain(replayRes.status);
    });
  });
});
