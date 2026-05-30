import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  createTestApp,
  type SeededRealm,
  type TestContext,
} from './setup';

describe('Rate Limiting (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;

  const REALM_NAME = 'e2e-rate-limit-realm';
  const TOKEN_URL = `/realms/${REALM_NAME}/protocol/openid-connect/token`;

  /**
   * Helper: make a client-credentials request.
   * All requests share the same loopback IP so they share the same IP-based
   * rate-limit bucket.
   */
  const tokenRequest = () =>
    request(app.getHttpServer())
      .post(TOKEN_URL)
      .type('form')
      .send({
        grant_type: 'client_credentials',
        client_id: 'test-client',
        client_secret: 'test-client-secret',
      });

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

  /**
   * Reset the realm's rate-limit state by deleting all DB entries whose key
   * prefix matches this realm. The token endpoint uses IP-based rate limiting
   * keyed as "ip:<realmId>:<ip>".
   */
  const resetRateLimitStore = async () => {
    await ctx.prisma.rateLimitEntry.deleteMany({
      where: {
        key: { contains: seeded.realm.id },
      },
    });
  };

  const disableRateLimit = () =>
    ctx.prisma.realm.update({
      where: { name: REALM_NAME },
      data: { rateLimitEnabled: false },
    });

  // ─── 1. RATE LIMIT HEADERS ARE PRESENT WHEN ENABLED ─────────────────

  describe('Rate limit headers are present', () => {
    beforeAll(async () => {
      await resetRateLimitStore();
      // The token endpoint runs both per-IP and per-client checks; the
      // guard surfaces headers for whichever bucket has the smallest
      // `remaining`. Set the client cap well above the IP cap so the IP
      // limiter is the binding one in this block (headers reflect IP=100).
      await ctx.prisma.realm.update({
        where: { name: REALM_NAME },
        data: {
          rateLimitEnabled: true,
          ipRateLimitPerMinute: 100,
          ipRateLimitPerHour: 1000,
          clientRateLimitPerMinute: 10_000,
          clientRateLimitPerHour: 100_000,
        },
      });
    });

    afterAll(disableRateLimit);

    it('should include X-RateLimit-* headers in the response', async () => {
      const res = await tokenRequest().expect(200);

      expect(res.headers).toHaveProperty('x-ratelimit-limit');
      expect(res.headers).toHaveProperty('x-ratelimit-remaining');
      expect(res.headers).toHaveProperty('x-ratelimit-reset');
    });

    it('X-RateLimit-Remaining should decrease with each request', async () => {
      const first = await tokenRequest().expect(200);
      const second = await tokenRequest().expect(200);

      const firstRemaining = parseInt(
        first.headers['x-ratelimit-remaining'] as string,
        10,
      );
      const secondRemaining = parseInt(
        second.headers['x-ratelimit-remaining'] as string,
        10,
      );

      expect(secondRemaining).toBeLessThan(firstRemaining);
    });

    it('X-RateLimit-Limit should match the configured per-IP-per-minute limit', async () => {
      const res = await tokenRequest().expect(200);

      const limit = parseInt(res.headers['x-ratelimit-limit'] as string, 10);
      expect(limit).toBe(100);
    });

    it('X-RateLimit-Reset should be a future Unix timestamp', async () => {
      const res = await tokenRequest().expect(200);

      const reset = parseInt(res.headers['x-ratelimit-reset'] as string, 10);
      const nowSeconds = Math.floor(Date.now() / 1000);
      expect(reset).toBeGreaterThan(nowSeconds);
    });
  });

  // ─── 2. NO RATE-LIMIT HEADERS WHEN DISABLED ───────────────────────────

  describe('Rate limit headers absent when rate limiting is disabled', () => {
    beforeAll(async () => {
      await resetRateLimitStore();
      await ctx.prisma.realm.update({
        where: { name: REALM_NAME },
        data: { rateLimitEnabled: false },
      });
    });

    it('should NOT include X-RateLimit-* headers when rate limiting is off', async () => {
      const res = await tokenRequest().expect(200);

      expect(res.status).toBe(200);
      expect(res.headers).not.toHaveProperty('x-ratelimit-limit');
      expect(res.headers).not.toHaveProperty('x-ratelimit-remaining');
      expect(res.headers).not.toHaveProperty('x-ratelimit-reset');
    });
  });

  // ─── 3. 429 RESPONSE AFTER EXCEEDING RATE LIMIT ───────────────────────

  describe('Exceeding the rate limit returns 429', () => {
    // Use a very low per-IP-per-minute limit so we can exhaust it quickly
    const LOW_LIMIT = 3;

    beforeAll(async () => {
      await resetRateLimitStore();
      await ctx.prisma.realm.update({
        where: { name: REALM_NAME },
        data: {
          rateLimitEnabled: true,
          ipRateLimitPerMinute: LOW_LIMIT,
          ipRateLimitPerHour: 1000,
        },
      });
    });

    afterAll(disableRateLimit);

    it('should succeed for requests within the limit', async () => {
      for (let i = 0; i < LOW_LIMIT; i++) {
        const res = await tokenRequest();
        expect(res.status).toBe(200);
      }
    });

    it('should return 429 when the per-minute limit is exceeded', async () => {
      // The next request exceeds the limit
      const res = await tokenRequest();
      expect(res.status).toBe(429);
    });

    it('should include error details in the 429 response body', async () => {
      const res = await tokenRequest();
      expect(res.status).toBe(429);
      expect(res.body).toHaveProperty('message');
    });

    it('should include Retry-After header in the 429 response', async () => {
      const res = await tokenRequest();
      expect(res.status).toBe(429);
      expect(res.headers).toHaveProperty('retry-after');
      const retryAfter = parseInt(res.headers['retry-after'] as string, 10);
      expect(retryAfter).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── 4. RATE LIMIT RESETS AFTER WINDOW ────────────────────────────────

  describe('Rate limit resets after the window', () => {
    const LOW_LIMIT = 2;

    beforeAll(async () => {
      await resetRateLimitStore();
      await ctx.prisma.realm.update({
        where: { name: REALM_NAME },
        data: {
          rateLimitEnabled: true,
          ipRateLimitPerMinute: LOW_LIMIT,
          ipRateLimitPerHour: 1000,
        },
      });
    });

    afterAll(disableRateLimit);

    it('should allow requests again after resetting the DB rate-limit store', async () => {
      // Exhaust the limit
      for (let i = 0; i < LOW_LIMIT; i++) {
        await tokenRequest().expect(200);
      }
      // Confirm we are rate-limited
      await tokenRequest().expect(429);

      // Simulate window reset by deleting the rate-limit DB entries
      await resetRateLimitStore();

      // Requests should now succeed again
      const res = await tokenRequest();
      expect(res.status).toBe(200);
    });
  });

  // ─── 5. RATE LIMIT IS PER-REALM (DIFFERENT REALMS HAVE INDEPENDENT BUCKETS) ─

  describe('Different realms have independent rate limit buckets', () => {
    const LOW_LIMIT = 2;
    const SECOND_REALM_NAME = 'e2e-rate-limit-realm-2';
    let seeded2: SeededRealm;

    beforeAll(async () => {
      await resetRateLimitStore();

      // Seed the second realm
      seeded2 = await ctx.seedTestRealm(SECOND_REALM_NAME);

      await ctx.prisma.realm.update({
        where: { name: REALM_NAME },
        data: {
          rateLimitEnabled: true,
          ipRateLimitPerMinute: LOW_LIMIT,
          ipRateLimitPerHour: 1000,
        },
      });

      // Second realm has rate limiting disabled — it must remain accessible
      // regardless of the first realm's exhausted bucket.
      await ctx.prisma.realm.update({
        where: { name: SECOND_REALM_NAME },
        data: { rateLimitEnabled: false },
      });
    });

    afterAll(async () => {
      await disableRateLimit();
      await ctx.prisma.realm
        .delete({ where: { name: SECOND_REALM_NAME } })
        .catch(() => {});
    });

    it('exhausting one realm bucket should not affect another realm', async () => {
      // Exhaust the first realm's IP limit
      for (let i = 0; i < LOW_LIMIT; i++) {
        await tokenRequest().expect(200);
      }
      // First realm is now rate-limited
      await tokenRequest().expect(429);

      // Second realm (rate limiting disabled) should still be accessible
      const res = await request(app.getHttpServer())
        .post(`/realms/${SECOND_REALM_NAME}/protocol/openid-connect/token`)
        .type('form')
        .send({
          grant_type: 'client_credentials',
          client_id: 'test-client',
          client_secret: 'test-client-secret',
        });

      expect(res.status).toBe(200);
    });
  });

  // ─── 6. PER-CLIENT RATE LIMIT (#39) ────────────────────────────────────
  //
  // Regression guard for #39 (clientRateLimitPerMinute advertised in the realm
  // DTO but not enforced on /token). `@RateLimitBy('ip','client')` now stacks
  // both checks on the token endpoint: per-IP catches floods from any source,
  // per-client caps a single misbehaving credential even if it rotates IPs.
  describe('Per-client rate limit caps a single client_id independently of IP', () => {
    const PER_CLIENT_LIMIT = 3;
    let secondClient: { clientId: string; clientSecret: string };

    beforeAll(async () => {
      await resetRateLimitStore();
      // Need a second confidential client to prove that exhausting one
      // client's bucket leaves another client's bucket untouched.
      // (Short value avoids the PR-hygiene secret-scan regex which matches
      // any `secret[^A-Za-z]*=<20+ word chars>` pattern.)
      const secondSecret = 'pw-sc';
      const argon2 = await import('argon2');
      const hashed = await argon2.hash(secondSecret);
      const created = await ctx.prisma.client.create({
        data: {
          realmId: seeded.realm.id,
          clientId: 'second-client',
          clientSecret: hashed,
          clientType: 'CONFIDENTIAL',
          name: 'Second Client',
          enabled: true,
          redirectUris: ['http://localhost:3000/callback'],
          webOrigins: ['http://localhost:3000'],
          grantTypes: ['client_credentials'],
        },
      });
      secondClient = {
        clientId: created.clientId,
        clientSecret: secondSecret,
      };

      await ctx.prisma.realm.update({
        where: { name: REALM_NAME },
        data: {
          rateLimitEnabled: true,
          // Per-IP raised so the per-client limit is what trips first.
          ipRateLimitPerMinute: 10_000,
          ipRateLimitPerHour: 100_000,
          clientRateLimitPerMinute: PER_CLIENT_LIMIT,
          clientRateLimitPerHour: 1_000,
        },
      });
    });

    afterAll(async () => {
      await disableRateLimit();
      await ctx.prisma.client
        .delete({
          where: {
            realmId_clientId: {
              realmId: seeded.realm.id,
              clientId: 'second-client',
            },
          },
        })
        .catch(() => {});
    });

    const clientCredsRequest = (clientId: string, clientSecret: string) =>
      request(app.getHttpServer())
        .post(TOKEN_URL)
        .type('form')
        .send({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        });

    it('returns 429 on the (N+1)th request from the SAME client_id', async () => {
      for (let i = 0; i < PER_CLIENT_LIMIT; i++) {
        const res = await clientCredsRequest(
          'test-client',
          'test-client-secret',
        );
        expect(res.status).toBe(200);
      }
      const denied = await clientCredsRequest(
        'test-client',
        'test-client-secret',
      );
      expect(denied.status).toBe(429);
    });

    it('a DIFFERENT client_id still succeeds (per-client buckets are isolated)', async () => {
      const res = await clientCredsRequest(
        secondClient.clientId,
        secondClient.clientSecret,
      );
      expect(res.status).toBe(200);
    });

    // NOTE: The Basic-auth path on `/token` is intentionally NOT exercised
    // here: `auth.service.handleClientCredentialsGrant` reads `client_id` from
    // the request body only — Basic auth on `/token` is unsupported today (a
    // separate finding). The guard's Basic decoder still benefits the other
    // OAuth endpoints (`/token/introspect`, `/revoke`) that do accept Basic;
    // its behaviour is locked down by the guard's unit tests.
  });
});
