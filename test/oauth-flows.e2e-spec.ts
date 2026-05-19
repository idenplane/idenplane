import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, TEST_ADMIN_API_KEY, type SeededRealm, type TestContext } from './setup';

describe('OAuth2 / OIDC Token Flows (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;

  const REALM_NAME = 'oauth-realm';
  const TOKEN_URL = `/realms/${REALM_NAME}/protocol/openid-connect/token`;
  const INTROSPECT_URL = `/realms/${REALM_NAME}/protocol/openid-connect/token/introspect`;
  const REVOKE_URL = `/realms/${REALM_NAME}/protocol/openid-connect/revoke`;
  const USERINFO_URL = `/realms/${REALM_NAME}/protocol/openid-connect/userinfo`;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    seeded = await ctx.seedTestRealm(REALM_NAME);
  });

  afterAll(async () => {
    if (!ctx) return;
    await ctx.prisma.realm
      .delete({ where: { name: REALM_NAME } })
      .catch(() => {});
    await ctx.cleanup();
  });

  // ─── 1. CLIENT CREDENTIALS GRANT ─────────────────────────────

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
      expect(res.body).not.toHaveProperty('refresh_token');
    });
  });

  // ─── 2. PASSWORD GRANT ────────────────────────────────────────

  describe('Password Grant', () => {
    it('should return access_token, refresh_token, and id_token when scope=openid', async () => {
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
        })
        .expect(200);

      expect(res.body).toHaveProperty('access_token');
      expect(res.body).toHaveProperty('refresh_token');
      expect(res.body).toHaveProperty('id_token');
      expect(res.body).toHaveProperty('token_type', 'Bearer');
      expect(typeof res.body.access_token).toBe('string');
      expect(typeof res.body.refresh_token).toBe('string');
      expect(typeof res.body.id_token).toBe('string');
    });
  });

  // ─── 3. PASSWORD GRANT — INVALID PASSWORD ────────────────────

  describe('Password Grant — invalid password', () => {
    it('should return 401 for wrong password', async () => {
      const res = await request(app.getHttpServer())
        .post(TOKEN_URL)
        .type('form')
        .send({
          grant_type: 'password',
          client_id: 'test-client',
          client_secret: 'test-client-secret',
          username: 'testuser',
          password: 'WrongPassword999!',
          scope: 'openid',
        })
        .expect(401);

      expect(res.body).toHaveProperty('message');
    });
  });

  // ─── 4. PASSWORD GRANT — MISSING USERNAME ─────────────────────

  describe('Password Grant — missing username', () => {
    it('should return 400 when username is not provided', async () => {
      const res = await request(app.getHttpServer())
        .post(TOKEN_URL)
        .type('form')
        .send({
          grant_type: 'password',
          client_id: 'test-client',
          client_secret: 'test-client-secret',
          password: 'TestPassword123!',
        })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });
  });

  // ─── 5. REFRESH TOKEN GRANT ───────────────────────────────────

  describe('Refresh Token Grant', () => {
    it('should exchange a refresh_token for new tokens (rotation)', async () => {
      // Step 1: obtain tokens via password grant
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

      // Step 2: use the refresh_token to get new tokens
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

      // New refresh_token should differ from the old one (rotation)
      expect(refreshRes.body.refresh_token).not.toBe(originalRefreshToken);
    });
  });

  // ─── 6. TOKEN INTROSPECTION ───────────────────────────────────

  describe('Token Introspection', () => {
    it('should return active=true with claims for a valid access_token', async () => {
      // Obtain a token
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

      const accessToken = tokenRes.body.access_token;

      // Introspect
      const introspectRes = await request(app.getHttpServer())
        .post(INTROSPECT_URL)
        .type('form')
        .send({ token: accessToken, client_id: 'test-client', client_secret: 'test-client-secret' })
        .expect(200);

      expect(introspectRes.body).toHaveProperty('active', true);
      expect(introspectRes.body).toHaveProperty('sub');
      expect(introspectRes.body).toHaveProperty('iss');
    });
  });

  // ─── 7. TOKEN REVOCATION ──────────────────────────────────────

  describe('Token Revocation', () => {
    it('should revoke a token so introspection returns active=false', async () => {
      // Obtain a token
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

      const accessToken = tokenRes.body.access_token;

      // Revoke the token
      await request(app.getHttpServer())
        .post(REVOKE_URL)
        .type('form')
        .send({ token: accessToken, client_id: 'test-client', client_secret: 'test-client-secret' })
        .expect(200);

      // Introspect — should now be inactive
      const introspectRes = await request(app.getHttpServer())
        .post(INTROSPECT_URL)
        .type('form')
        .send({ token: accessToken, client_id: 'test-client', client_secret: 'test-client-secret' })
        .expect(200);

      expect(introspectRes.body).toHaveProperty('active', false);
    });
  });

  // ─── 8. USERINFO ENDPOINT ─────────────────────────────────────

  describe('Userinfo Endpoint', () => {
    it('should return user claims when called with a valid Bearer token', async () => {
      // Obtain a token with profile and email scopes so userinfo returns those claims
      const tokenRes = await request(app.getHttpServer())
        .post(TOKEN_URL)
        .type('form')
        .send({
          grant_type: 'password',
          client_id: 'test-client',
          client_secret: 'test-client-secret',
          username: 'testuser',
          password: 'TestPassword123!',
          scope: 'openid profile email',
        })
        .expect(200);

      const accessToken = tokenRes.body.access_token;

      // Call userinfo
      const userinfoRes = await request(app.getHttpServer())
        .get(USERINFO_URL)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(userinfoRes.body).toHaveProperty('sub');
      expect(userinfoRes.body).toHaveProperty('preferred_username', 'testuser');
      expect(userinfoRes.body).toHaveProperty('email', 'testuser@example.com');
    });
  });

  // ─── 9. UNSUPPORTED GRANT TYPE ────────────────────────────────

  describe('Unsupported grant_type', () => {
    it('should return 400 for an unknown grant_type', async () => {
      const res = await request(app.getHttpServer())
        .post(TOKEN_URL)
        .type('form')
        .send({
          grant_type: 'foo',
          client_id: 'test-client',
          client_secret: 'test-client-secret',
        })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });
  });

  // ─── 10. CLIENT CREDENTIALS WITH WRONG SECRET ─────────────────

  describe('Client Credentials — wrong secret', () => {
    it('should return 401 when client_secret is incorrect', async () => {
      const res = await request(app.getHttpServer())
        .post(TOKEN_URL)
        .type('form')
        .send({
          grant_type: 'client_credentials',
          client_id: 'test-client',
          client_secret: 'wrong-secret',
        })
        .expect(401);

      expect(res.body).toHaveProperty('message');
    });
  });
});
