import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, type SeededRealm, type TestContext } from './setup';

describe('OIDC Flows (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;

  const REALM_NAME = 'e2e-oidc-realm';
  const DISCOVERY_URL = `/realms/${REALM_NAME}/.well-known/openid-configuration`;
  const JWKS_URL = `/realms/${REALM_NAME}/protocol/openid-connect/certs`;
  const TOKEN_URL = `/realms/${REALM_NAME}/protocol/openid-connect/token`;
  const USERINFO_URL = `/realms/${REALM_NAME}/protocol/openid-connect/userinfo`;

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

  // ─── 1. DISCOVERY ENDPOINT ─────────────────────────────────────────────

  describe('Discovery endpoint (.well-known/openid-configuration)', () => {
    it('should return a valid OIDC discovery document with all required fields', async () => {
      const res = await request(app.getHttpServer())
        .get(DISCOVERY_URL)
        .expect(200);

      const body = res.body;

      // Core required fields (RFC 8414 / OIDC Core)
      expect(body).toHaveProperty('issuer');
      expect(body).toHaveProperty('authorization_endpoint');
      expect(body).toHaveProperty('token_endpoint');
      expect(body).toHaveProperty('userinfo_endpoint');
      expect(body).toHaveProperty('jwks_uri');
      expect(body).toHaveProperty('response_types_supported');
      expect(body).toHaveProperty('subject_types_supported');
      expect(body).toHaveProperty('id_token_signing_alg_values_supported');
      expect(body).toHaveProperty('scopes_supported');
      expect(body).toHaveProperty('grant_types_supported');
      expect(body).toHaveProperty('token_endpoint_auth_methods_supported');
      expect(body).toHaveProperty('claims_supported');
    });

    it('should contain realm-specific URLs in the discovery document', async () => {
      const res = await request(app.getHttpServer())
        .get(DISCOVERY_URL)
        .expect(200);

      const body = res.body;

      expect(body.issuer).toContain(REALM_NAME);
      expect(body.authorization_endpoint).toContain(REALM_NAME);
      expect(body.token_endpoint).toContain(REALM_NAME);
      expect(body.jwks_uri).toContain(REALM_NAME);
      expect(body.userinfo_endpoint).toContain(REALM_NAME);
    });

    it('should advertise correct supported grant types', async () => {
      const res = await request(app.getHttpServer())
        .get(DISCOVERY_URL)
        .expect(200);

      const { grant_types_supported } = res.body;
      expect(Array.isArray(grant_types_supported)).toBe(true);
      expect(grant_types_supported).toContain('authorization_code');
      expect(grant_types_supported).toContain('client_credentials');
      expect(grant_types_supported).toContain('refresh_token');
    });

    it('should advertise S256 as a supported code challenge method', async () => {
      const res = await request(app.getHttpServer())
        .get(DISCOVERY_URL)
        .expect(200);

      expect(res.body).toHaveProperty('code_challenge_methods_supported');
      expect(res.body.code_challenge_methods_supported).toContain('S256');
    });

    it('should include introspection, revocation, and end_session endpoints', async () => {
      const res = await request(app.getHttpServer())
        .get(DISCOVERY_URL)
        .expect(200);

      expect(res.body).toHaveProperty('introspection_endpoint');
      expect(res.body).toHaveProperty('revocation_endpoint');
      expect(res.body).toHaveProperty('end_session_endpoint');
    });

    it('should advertise RS256 for id_token signing', async () => {
      const res = await request(app.getHttpServer())
        .get(DISCOVERY_URL)
        .expect(200);

      expect(res.body.id_token_signing_alg_values_supported).toContain('RS256');
    });

    it('should return 404 for a non-existent realm', async () => {
      await request(app.getHttpServer())
        .get('/realms/does-not-exist/.well-known/openid-configuration')
        .expect(404);
    });
  });

  // ─── 2. JWKS ENDPOINT ──────────────────────────────────────────────────

  describe('JWKS endpoint (/protocol/openid-connect/certs)', () => {
    it('should return a valid JWKS with at least one RSA key', async () => {
      const res = await request(app.getHttpServer())
        .get(JWKS_URL)
        .expect(200);

      const body = res.body;
      expect(body).toHaveProperty('keys');
      expect(Array.isArray(body.keys)).toBe(true);
      expect(body.keys.length).toBeGreaterThanOrEqual(1);
    });

    it('should return RSA keys with required JWK fields', async () => {
      const res = await request(app.getHttpServer())
        .get(JWKS_URL)
        .expect(200);

      const key = res.body.keys[0];
      expect(key).toHaveProperty('kty', 'RSA');
      expect(key).toHaveProperty('kid');
      expect(key).toHaveProperty('alg', 'RS256');
      expect(key).toHaveProperty('use', 'sig');
      expect(key).toHaveProperty('n'); // RSA modulus (base64url)
      expect(key).toHaveProperty('e'); // RSA exponent (base64url)
    });

    it('should return a key with a kid matching the seeded signing key', async () => {
      const res = await request(app.getHttpServer())
        .get(JWKS_URL)
        .expect(200);

      const kids = res.body.keys.map((k: { kid: string }) => k.kid);
      expect(kids).toContain(seeded.signingKey.kid);
    });

    it('should return 404 for a non-existent realm', async () => {
      await request(app.getHttpServer())
        .get('/realms/does-not-exist/protocol/openid-connect/certs')
        .expect(404);
    });
  });

  // ─── 3. TOKEN ENDPOINT — JWT CLAIMS VALIDATION ─────────────────────────

  describe('Token endpoint — JWT with required claims', () => {
    let accessToken: string;
    let idToken: string;

    beforeAll(async () => {
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

      accessToken = res.body.access_token;
      idToken = res.body.id_token;
    });

    it('should return a JWT access token (three parts separated by dots)', () => {
      expect(typeof accessToken).toBe('string');
      const parts = accessToken.split('.');
      expect(parts).toHaveLength(3);
    });

    it('should return an id_token when scope=openid', () => {
      expect(typeof idToken).toBe('string');
      const parts = idToken.split('.');
      expect(parts).toHaveLength(3);
    });

    it('access_token payload should contain required claims', () => {
      const payloadB64 = accessToken.split('.')[1]!;
      const payload = JSON.parse(
        Buffer.from(payloadB64, 'base64url').toString('utf8'),
      );

      expect(payload).toHaveProperty('sub');
      expect(payload).toHaveProperty('iss');
      expect(payload).toHaveProperty('iat');
      expect(payload).toHaveProperty('exp');
      expect(typeof payload.exp).toBe('number');
      expect(typeof payload.iat).toBe('number');
      // iss must contain the realm name
      expect(payload.iss).toContain(REALM_NAME);
    });

    it('id_token should contain required OIDC claims (sub, iss, aud, exp, iat)', () => {
      const payloadB64 = idToken.split('.')[1]!;
      const payload = JSON.parse(
        Buffer.from(payloadB64, 'base64url').toString('utf8'),
      );

      expect(payload).toHaveProperty('sub');
      expect(payload).toHaveProperty('iss');
      expect(payload).toHaveProperty('aud');
      expect(payload).toHaveProperty('exp');
      expect(payload).toHaveProperty('iat');
      expect(typeof payload.exp).toBe('number');
      expect(typeof payload.iat).toBe('number');
      expect(payload.iss).toContain(REALM_NAME);
    });

    it('id_token sub should match the user id', () => {
      const payloadB64 = idToken.split('.')[1]!;
      const payload = JSON.parse(
        Buffer.from(payloadB64, 'base64url').toString('utf8'),
      );
      expect(payload.sub).toBe(seeded.user.id);
    });

    it('id_token aud should include the client_id', () => {
      const payloadB64 = idToken.split('.')[1]!;
      const payload = JSON.parse(
        Buffer.from(payloadB64, 'base64url').toString('utf8'),
      );

      // aud can be a string or array
      const audList = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      expect(audList).toContain('test-client');
    });

    it('id_token exp should be greater than iat', () => {
      const payloadB64 = idToken.split('.')[1]!;
      const payload = JSON.parse(
        Buffer.from(payloadB64, 'base64url').toString('utf8'),
      );
      expect(payload.exp).toBeGreaterThan(payload.iat);
    });
  });

  // ─── 4. USERINFO ENDPOINT ──────────────────────────────────────────────

  describe('UserInfo endpoint', () => {
    let accessToken: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
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

      accessToken = res.body.access_token;
    });

    it('should return user profile claims with a valid Bearer token', async () => {
      const res = await request(app.getHttpServer())
        .get(USERINFO_URL)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('sub');
      expect(res.body).toHaveProperty('preferred_username', 'testuser');
      expect(res.body).toHaveProperty('email', 'testuser@example.com');
    });

    it('should return the correct sub (user id)', async () => {
      const res = await request(app.getHttpServer())
        .get(USERINFO_URL)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.sub).toBe(seeded.user.id);
    });

    it('should return 401 when no Authorization header is provided', async () => {
      await request(app.getHttpServer())
        .get(USERINFO_URL)
        .expect(401);
    });

    it('should return 401 for a tampered / invalid access token', async () => {
      await request(app.getHttpServer())
        .get(USERINFO_URL)
        .set('Authorization', 'Bearer invalid.token.here')
        .expect(401);
    });
  });
});
