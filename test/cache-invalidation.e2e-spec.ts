import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, TEST_ADMIN_API_KEY, type TestContext } from './setup';
import { CacheBusService } from '../src/cache/cache-bus.service';
import { CorsOriginService } from '../src/cors/cors-origin.service';

/**
 * The in-process cache against a real database. Every change below is made
 * with raw SQL, past the application, so the only thing that can drop the
 * cached entry is the database's own announcement (the
 * cache_invalidation_triggers migration and CacheBusService).
 */
describe('In-process cache invalidation (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let bus: CacheBusService;
  const REALM = 'e2e-cache-invalidation';
  const discovery = (realm: string) =>
    request(app.getHttpServer()).get(
      `/realms/${realm}/.well-known/openid-configuration`,
    );

  /** Retries `check` until it passes: an announcement takes a moment. */
  const eventually = async (check: () => Promise<void>, ms = 3000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      try {
        return await check();
      } catch (err) {
        if (Date.now() > deadline) throw err;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  };

  const waitConnected = () =>
    eventually(async () => expect(bus.isConnected()).toBe(true), 10_000);

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app as INestApplication<App>;
    bus = app.get(CacheBusService);
    await ctx.seedTestRealm(REALM);
    await waitConnected();
  }, 30_000);

  afterAll(async () => {
    await ctx.prisma.$executeRawUnsafe(
      `DELETE FROM realms WHERE name IN ('${REALM}', '${REALM}-renamed')`,
    );
    await ctx.cleanup();
  });

  it('serves a disabled realm as disabled as soon as the row changes', async () => {
    await discovery(REALM).expect(200); // now cached
    await ctx.prisma.$executeRawUnsafe(
      `UPDATE realms SET enabled = false WHERE name = '${REALM}'`,
    );
    await eventually(async () => {
      await discovery(REALM).expect(403);
    });
    await ctx.prisma.$executeRawUnsafe(
      `UPDATE realms SET enabled = true WHERE name = '${REALM}'`,
    );
    await eventually(async () => {
      await discovery(REALM).expect(200);
    });
  });

  it('forgets a realm under its old name when it is renamed', async () => {
    await discovery(REALM).expect(200);
    await ctx.prisma.$executeRawUnsafe(
      `UPDATE realms SET name = '${REALM}-renamed' WHERE name = '${REALM}'`,
    );
    await eventually(async () => {
      await discovery(REALM).expect(404);
    });
    await discovery(`${REALM}-renamed`).expect(200);
    await ctx.prisma.$executeRawUnsafe(
      `UPDATE realms SET name = '${REALM}' WHERE name = '${REALM}-renamed'`,
    );
    await eventually(async () => {
      await discovery(REALM).expect(200);
    });
  });

  it('serves a new signing key in the JWKS as soon as it is added', async () => {
    const kids = async () =>
      (
        (
          await request(app.getHttpServer())
            .get(`/realms/${REALM}/protocol/openid-connect/certs`)
            .expect(200)
        ).body as { keys: Array<{ kid: string }> }
      ).keys.map((k) => k.kid);
    const before = await kids(); // now cached
    const key = await ctx.prisma.realmSigningKey.findFirstOrThrow({
      where: { realm: { name: REALM } },
    });
    await ctx.prisma.$executeRawUnsafe(
      `INSERT INTO realm_signing_keys (id, realm_id, kid, algorithm, public_key, private_key, active, created_at)
       SELECT gen_random_uuid(), realm_id, 'e2e-new-kid', algorithm, public_key, private_key, true, now()
       FROM realm_signing_keys WHERE id = '${key.id}'`,
    );
    await eventually(async () => {
      expect(await kids()).toEqual(
        expect.arrayContaining([...before, 'e2e-new-kid']),
      );
    });
  });

  it('allows a new client web origin for CORS as soon as it is saved', async () => {
    // The test app has no CORS middleware (main.ts sets it up), so this asks
    // the set that middleware reads, the way main.ts does.
    const cors = app.get(CorsOriginService);
    await cors.preloadCache();
    const origin = 'https://cache-e2e.example.com';
    expect(cors.getCachedOrigins()?.has(origin)).toBe(false);

    await ctx.prisma.$executeRawUnsafe(
      `UPDATE clients SET web_origins = array_append(web_origins, '${origin}')
       WHERE client_id = 'test-client' AND realm_id = (SELECT id FROM realms WHERE name = '${REALM}')`,
    );
    await eventually(async () => {
      expect(cors.getCachedOrigins()?.has(origin)).toBe(true);
    });
  });

  it('shows an admin the current client after a change made past the app', async () => {
    const get = async () =>
      (
        (
          await request(app.getHttpServer())
            .get(`/admin/realms/${REALM}/clients/test-client`)
            .set('x-admin-api-key', TEST_ADMIN_API_KEY)
            .expect(200)
        ).body as { name: string | null }
      ).name;
    await get(); // now cached
    await ctx.prisma.$executeRawUnsafe(
      `UPDATE clients SET name = 'renamed by SQL' WHERE client_id = 'test-client'
       AND realm_id = (SELECT id FROM realms WHERE name = '${REALM}')`,
    );
    await eventually(async () => {
      expect(await get()).toBe('renamed by SQL');
    });
  });

  it('goes to the database while the announcement connection is down, and recovers', async () => {
    await discovery(REALM).expect(200);
    await ctx.prisma.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE query = 'LISTEN idenplane_cache' AND pid <> pg_backend_pid()`,
    );
    await eventually(async () => expect(bus.isConnected()).toBe(false));

    // A change made while nobody listens is never announced. It must still
    // be seen: the in-process cache is bypassed until the connection is
    // back, and starts empty then.
    await ctx.prisma.$executeRawUnsafe(
      `UPDATE realms SET enabled = false WHERE name = '${REALM}'`,
    );
    await discovery(REALM).expect(403);
    await waitConnected();
    await discovery(REALM).expect(403);

    await ctx.prisma.$executeRawUnsafe(
      `UPDATE realms SET enabled = true WHERE name = '${REALM}'`,
    );
    await eventually(async () => {
      await discovery(REALM).expect(200);
    });
  }, 30_000);
});
