import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
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

/**
 * Secure defaults (0.10.0): a NEW realm has brute-force protection and event
 * recording on; an EXISTING realm is left exactly as it was; and the lockout
 * really locks, really ends, and cannot be used to test passwords.
 */
describe('Secure realm defaults (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;

  const API_REALM = 'e2e-defaults-api-demo';
  const IMPORTED_V1 = 'e2e-defaults-import-v1-demo';
  const IMPORTED_V1_OFF = 'e2e-defaults-import-v1-off-demo';
  const IMPORTED_V2 = 'e2e-defaults-import-v2-demo';
  const LOCK_REALM = 'e2e-defaults-lockout-demo';
  const LEGACY_REALM = 'e2e-defaults-legacy-demo';
  const ALL = [
    API_REALM,
    IMPORTED_V1,
    IMPORTED_V1_OFF,
    IMPORTED_V2,
    LOCK_REALM,
    LEGACY_REALM,
  ];

  const admin = () => request(app.getHttpServer());
  const withKey = (req: request.Test) =>
    req.set('x-admin-api-key', TEST_ADMIN_API_KEY);
  const realmRow = (name: string) =>
    ctx.prisma.realm.findUniqueOrThrow({ where: { name } });

  const EXPECTED = {
    bruteForceEnabled: true,
    maxLoginFailures: 10,
    lockoutDuration: 300,
    failureResetTime: 900,
    permanentLockoutAfter: 0,
    eventsEnabled: true,
    adminEventsEnabled: true,
  };

  const dropAll = async () => {
    for (const name of ALL) {
      await ctx.prisma.realm.delete({ where: { name } }).catch(() => {});
    }
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    useThemeViews(app);
    await dropAll();
  }, 60_000);

  afterAll(async () => {
    await dropAll();
    await ctx.cleanup();
  });

  // ─── New realms ────────────────────────────────────────────────────────

  describe('a new realm', () => {
    it('created through the admin API has brute-force protection on', async () => {
      await withKey(
        admin().post('/admin/realms').send({ name: API_REALM }),
      ).expect(201);

      const res = await withKey(
        admin().get(`/admin/realms/${API_REALM}`),
      ).expect(200);
      expect(res.body).toMatchObject(EXPECTED);
      expect(await realmRow(API_REALM)).toMatchObject(EXPECTED);
    });

    it('imported from a version 1 file without the setting has it on', async () => {
      await withKey(
        admin()
          .post('/admin/realms/import')
          .send({ version: 1, realm: { name: IMPORTED_V1 } }),
      ).expect(201);

      expect(await realmRow(IMPORTED_V1)).toMatchObject(EXPECTED);
    });

    it('imported from a file that turns it off keeps it off', async () => {
      await withKey(
        admin()
          .post('/admin/realms/import')
          .send({
            version: 1,
            realm: { name: IMPORTED_V1_OFF, bruteForceEnabled: false },
          }),
      ).expect(201);

      expect((await realmRow(IMPORTED_V1_OFF)).bruteForceEnabled).toBe(false);
    });

    it('imported from a version 2 export without the setting has it on', async () => {
      const exported = (
        await withKey(admin().get(`/admin/realms/${API_REALM}/export`)).expect(
          200,
        )
      ).body as { realm: Record<string, unknown> };
      const realm = { ...exported.realm, name: IMPORTED_V2 };
      for (const field of Object.keys(EXPECTED)) delete realm[field];

      await withKey(
        admin()
          .post('/admin/realms/import')
          .send({ ...exported, realm }),
      ).expect(201);

      expect(await realmRow(IMPORTED_V2)).toMatchObject(EXPECTED);
    });

    it('the master realm has it on, with a temporary lockout only', async () => {
      // Seeded on first boot by AdminSeedService against a fresh database.
      const master = await realmRow('master');
      expect(master.bruteForceEnabled).toBe(true);
      expect(master.permanentLockoutAfter).toBe(0);
    });
  });

  // ─── Existing realms ───────────────────────────────────────────────────

  describe('the migration', () => {
    const migrationSql = () => {
      const dir = join(process.cwd(), 'prisma', 'migrations');
      const name = readdirSync(dir).find((d) =>
        d.endsWith('_secure_realm_defaults'),
      );
      expect(name).toBeDefined();
      return readFileSync(join(dir, name!, 'migration.sql'), 'utf8');
    };

    it('changes only the column defaults', async () => {
      const rows = await ctx.prisma.$queryRaw<
        { column_name: string; column_default: string }[]
      >`SELECT column_name, column_default FROM information_schema.columns
        WHERE table_name = 'realms' AND column_name IN
        ('brute_force_enabled', 'max_login_failures', 'lockout_duration',
         'failure_reset_time', 'events_enabled', 'admin_events_enabled')`;
      const defaults = Object.fromEntries(
        rows.map((r) => [r.column_name, r.column_default]),
      );
      expect(defaults).toEqual({
        brute_force_enabled: 'true',
        max_login_failures: '10',
        lockout_duration: '300',
        failure_reset_time: '900',
        events_enabled: 'true',
        admin_events_enabled: 'true',
      });
    });

    it('leaves an existing realm exactly as it was', async () => {
      // A realm as an older release created it: protection and events off,
      // the old lockout numbers.
      const legacy = await ctx.prisma.realm.create({
        data: {
          name: LEGACY_REALM,
          bruteForceEnabled: false,
          maxLoginFailures: 5,
          lockoutDuration: 900,
          failureResetTime: 600,
          eventsEnabled: false,
          adminEventsEnabled: false,
        },
      });

      // Run the migration again over it (every statement is idempotent).
      const statements = migrationSql()
        .split('\n')
        .filter((l) => !l.trim().startsWith('--'))
        .join('\n')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      expect(statements.length).toBeGreaterThan(0);
      for (const statement of statements) {
        await ctx.prisma.$executeRawUnsafe(statement);
      }

      const after = await realmRow(LEGACY_REALM);
      expect(after).toMatchObject({
        bruteForceEnabled: false,
        maxLoginFailures: 5,
        lockoutDuration: 900,
        failureResetTime: 600,
        eventsEnabled: false,
        adminEventsEnabled: false,
      });
      expect(after.updatedAt).toEqual(legacy.updatedAt);
    });
  });

  // ─── The lockout itself ────────────────────────────────────────────────

  describe('lockout', () => {
    let seeded: SeededRealm;
    const MAX_FAILURES = 3;
    const LOCK_SECONDS = 2;
    const RIGHT = 'TestPassword123!';
    const WRONG = 'placeholder-wrong-password';
    const TOKEN_URL = `/realms/${LOCK_REALM}/protocol/openid-connect/token`;

    const passwordGrant = (password: string) =>
      admin().post(TOKEN_URL).type('form').send({
        grant_type: 'password',
        client_id: 'test-client',
        client_secret: 'test-client-secret',
        username: 'testuser',
        password,
      });

    /** The hosted login form, as a browser submits it. */
    const browserLogin = async (password: string) => {
      const browser = new Browser(app);
      const page = await browser.get(`/realms/${LOCK_REALM}/login`);
      expect(page.status).toBe(200);
      return browser.post(`/realms/${LOCK_REALM}/login`, {
        username: 'testuser',
        password,
        _csrf: csrfFrom(page.text),
      });
    };

    const lockedUntil = async () =>
      (
        await ctx.prisma.user.findUniqueOrThrow({
          where: { id: seeded.user.id },
        })
      ).lockedUntil;

    const reset = async () => {
      await ctx.prisma.loginFailure.deleteMany({
        where: { userId: seeded.user.id },
      });
      await ctx.prisma.user.update({
        where: { id: seeded.user.id },
        data: { lockedUntil: null },
      });
    };

    const lockOut = async () => {
      for (let i = 0; i < MAX_FAILURES; i++) {
        await passwordGrant(WRONG).expect(400);
      }
      expect(await lockedUntil()).not.toBeNull();
    };

    beforeAll(async () => {
      seeded = await ctx.seedTestRealm(LOCK_REALM);
      // The defaults, with smaller numbers so the test runs in seconds.
      await ctx.prisma.realm.update({
        where: { name: LOCK_REALM },
        data: {
          bruteForceEnabled: true,
          maxLoginFailures: MAX_FAILURES,
          lockoutDuration: LOCK_SECONDS,
          failureResetTime: 300,
          permanentLockoutAfter: 0,
        },
      });
    }, 30_000);

    beforeEach(reset);

    it(`locks the account after ${MAX_FAILURES} failures`, async () => {
      for (let i = 0; i < MAX_FAILURES - 1; i++) {
        await passwordGrant(WRONG).expect(400);
      }
      expect(await lockedUntil()).toBeNull();

      await passwordGrant(WRONG).expect(400);
      expect((await lockedUntil())!.getTime()).toBeGreaterThan(Date.now());

      // Locked: even the right password is refused.
      const res = await passwordGrant(RIGHT).expect(400);
      expect(res.body.error).toBe('invalid_grant');
    });

    it('gives the same answer to the right and the wrong password while locked (token endpoint)', async () => {
      await lockOut();

      const right = await passwordGrant(RIGHT);
      const wrong = await passwordGrant(WRONG);

      expect(right.status).toBe(wrong.status);
      expect(right.body).toEqual(wrong.body);
      // Attempts while locked neither count nor extend the lock.
      expect(
        await ctx.prisma.loginFailure.count({
          where: { userId: seeded.user.id },
        }),
      ).toBe(MAX_FAILURES);
    });

    it('gives the same answer to the right and the wrong password while locked (login page)', async () => {
      await lockOut();

      const right = await browserLogin(RIGHT);
      const wrong = await browserLogin(WRONG);

      expect(right.status).toBe(302);
      expect(right.status).toBe(wrong.status);
      expect(right.headers['location']).toBe(wrong.headers['location']);
      expect(right.headers['location']).toMatch(
        new RegExp(`^/realms/${LOCK_REALM}/login\\?`),
      );
      // No session for the right password either.
      expect(
        (right.headers['set-cookie'] as unknown as string[] | undefined)?.some(
          (c) => c.startsWith('IDENPLANE_SESSION=') && !/=;/.test(c),
        ) ?? false,
      ).toBe(false);
    });

    it('unlocks by itself once the lockout duration has passed', async () => {
      await lockOut();
      await passwordGrant(RIGHT).expect(400);

      await new Promise((r) => setTimeout(r, (LOCK_SECONDS + 1) * 1000));

      const res = await passwordGrant(RIGHT).expect(200);
      expect(res.body.access_token).toBeTruthy();
      // A successful sign-in clears the failures.
      expect(
        await ctx.prisma.loginFailure.count({
          where: { userId: seeded.user.id },
        }),
      ).toBe(0);
    });

    it('relocks at once on a wrong password right after the lock ends (progressive)', async () => {
      await lockOut();
      await new Promise((r) => setTimeout(r, (LOCK_SECONDS + 1) * 1000));

      // The failures are still inside the reset window, so one more wrong
      // guess locks again instead of granting a fresh set of attempts.
      await passwordGrant(WRONG).expect(400);
      expect((await lockedUntil())!.getTime()).toBeGreaterThan(Date.now());
      await passwordGrant(RIGHT).expect(400);
    });

    it('can be cleared with the admin API key by setting a new password (the documented break-glass path)', async () => {
      await lockOut();
      const NEW_PASSWORD = 'placeholder-New-Pass-1';

      await withKey(
        admin()
          .put(
            `/admin/realms/${LOCK_REALM}/users/${seeded.user.id}/reset-password`,
          )
          .send({ password: NEW_PASSWORD }),
      ).expect(204);

      expect(await lockedUntil()).toBeNull();
      await passwordGrant(NEW_PASSWORD).expect(200);

      // Put the fixture password back for any later test.
      await withKey(
        admin()
          .put(
            `/admin/realms/${LOCK_REALM}/users/${seeded.user.id}/reset-password`,
          )
          .send({ password: RIGHT }),
      ).expect(204);
    });
  });
});
