import request from 'supertest';
import { createTestApp, TEST_ADMIN_API_KEY, type TestContext } from './setup';
import { CryptoService } from '../src/crypto/crypto.service';

/**
 * Admin RBAC: every admin route is authorized by role and realm scope.
 *
 * Callers: a super-admin, a realm-admin assigned realm A only, an unscoped
 * realm-admin, a view-only admin, and the admin API key. Each expectation
 * is the exact status the access matrix gives (docs: admin roles).
 */
describe('Admin RBAC (e2e)', () => {
  let ctx: TestContext;

  const PREFIX = 'rbac-e2e-';
  const REALM_A = `${PREFIX}a`;
  const REALM_B = `${PREFIX}b`;
  const NEW_REALM = `${PREFIX}created`;
  const USER_PASSWORD = 'Rbac-E2E-dummy-Pa55word!';
  const USERS = {
    super: `${PREFIX}super`,
    realmAdmin: `${PREFIX}realm-admin`,
    unscoped: `${PREFIX}unscoped`,
    viewer: `${PREFIX}viewer`,
  } as const;

  let realmAId = '';
  let realmBId = '';
  const ids: Record<keyof typeof USERS, string> = {
    super: '',
    realmAdmin: '',
    unscoped: '',
    viewer: '',
  };
  const tokens: Record<keyof typeof USERS, string> = {
    super: '',
    realmAdmin: '',
    unscoped: '',
    viewer: '',
  };

  const http = () => request(ctx.app.getHttpServer());
  type Who = keyof typeof USERS | 'apiKey';
  const auth = (who: Who): [string, string] =>
    who === 'apiKey'
      ? ['x-admin-api-key', TEST_ADMIN_API_KEY]
      : ['authorization', `Bearer ${tokens[who]}`];
  const get = (who: Who, path: string) =>
    http()
      .get(path)
      .set(...auth(who));
  const post = (who: Who, path: string, body?: object) =>
    http()
      .post(path)
      .set(...auth(who))
      .send(body ?? {});
  const put = (who: Who, path: string, body?: object) =>
    http()
      .put(path)
      .set(...auth(who))
      .send(body ?? {});
  const del = (who: Who, path: string) =>
    http()
      .delete(path)
      .set(...auth(who));

  const login = async (username: string) => {
    const res = await http()
      .post('/admin/auth/login')
      .send({ username, password: USER_PASSWORD })
      .expect(200);
    return res.body.access_token as string;
  };

  const masterRealm = () =>
    ctx.prisma.realm.findUniqueOrThrow({
      where: { name: 'master' },
      include: { roles: true },
    });

  const cleanup = async () => {
    await ctx.prisma.realm.deleteMany({
      where: { name: { startsWith: PREFIX } },
    });
    const master = await ctx.prisma.realm.findUnique({
      where: { name: 'master' },
    });
    if (master) {
      await ctx.prisma.user.deleteMany({
        where: { realmId: master.id, username: { in: Object.values(USERS) } },
      });
    }
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await cleanup();

    realmAId = (await ctx.seedTestRealm(REALM_A)).realm.id;
    realmBId = (await ctx.seedTestRealm(REALM_B)).realm.id;

    const master = await masterRealm();
    const roleId = (name: string) => {
      const role = master.roles.find((r) => r.name === name && !r.clientId);
      if (!role) throw new Error(`master realm has no ${name} role`);
      return role.id;
    };
    const passwordHash = await ctx.app
      .get(CryptoService)
      .hashPassword(USER_PASSWORD);
    const roleOf: Record<keyof typeof USERS, string> = {
      super: 'super-admin',
      realmAdmin: 'realm-admin',
      unscoped: 'realm-admin',
      viewer: 'view-only',
    };
    for (const key of Object.keys(USERS) as (keyof typeof USERS)[]) {
      const user = await ctx.prisma.user.create({
        data: {
          realmId: master.id,
          username: USERS[key],
          enabled: true,
          passwordHash,
          userRoles: { create: { roleId: roleId(roleOf[key]) } },
        },
      });
      ids[key] = user.id;
    }
    for (const key of Object.keys(USERS) as (keyof typeof USERS)[]) {
      tokens[key] = await login(USERS[key]);
    }

    // The super-admin assigns realm A to the realm-admin through the API.
    await put('super', `/admin/admin-accounts/${ids.realmAdmin}/realms`, {
      realms: [REALM_A],
    }).expect(200, { realms: [REALM_A] });
  }, 120_000);

  afterAll(async () => {
    await cleanup();
    await ctx.cleanup();
  });

  describe('who am I', () => {
    it('describes each admin from the database', async () => {
      const me = async (who: Who) =>
        (await get(who, '/admin/auth/me').expect(200)).body;
      expect(await me('super')).toMatchObject({
        roles: ['super-admin'],
        superAdmin: true,
        writeAllRealms: true,
      });
      expect(await me('realmAdmin')).toMatchObject({
        roles: ['realm-admin'],
        superAdmin: false,
        readAllRealms: false,
        managedRealms: [REALM_A],
      });
      expect(await me('unscoped')).toMatchObject({ managedRealms: [] });
      expect(await me('viewer')).toMatchObject({
        roles: ['view-only'],
        readAllRealms: true,
        writeAllRealms: false,
      });
      expect(await me('apiKey')).toMatchObject({
        kind: 'api-key',
        roles: ['super-admin'],
      });
    });

    it('needs credentials', async () => {
      await http().get('/admin/auth/me').expect(401);
    });

    it('lists only the realms a realm-admin manages', async () => {
      const names = async (who: Who) =>
        (
          (await get(who, '/admin/realms').expect(200)).body as {
            name: string;
          }[]
        )
          .map((r) => r.name)
          .filter((n) => n.startsWith(PREFIX) || n === 'master');
      expect(await names('realmAdmin')).toEqual([REALM_A]);
      expect(await names('unscoped')).toEqual([]);
      expect((await names('viewer')).sort()).toEqual(
        ['master', REALM_A, REALM_B].sort(),
      );
      expect((await names('super')).sort()).toEqual(
        ['master', REALM_A, REALM_B].sort(),
      );
    });
  });

  describe('realm-scoped reads', () => {
    const clients = (realm: string) => `/admin/realms/${realm}/clients`;

    it.each([
      ['super', REALM_A, 200],
      ['apiKey', REALM_A, 200],
      ['realmAdmin', REALM_A, 200],
      ['viewer', REALM_A, 200],
      ['unscoped', REALM_A, 403],
      ['super', REALM_B, 200],
      ['realmAdmin', REALM_B, 403],
      ['viewer', REALM_B, 200],
      ['realmAdmin', 'master', 403],
      ['viewer', 'master', 200],
    ] as const)(
      '%s reading clients of %s answers %i',
      async (who, realm, status) => {
        await get(who, clients(realm)).expect(status);
      },
    );

    it('lets view-only read users (the old "admin" role typo is gone)', async () => {
      await get('viewer', `/admin/realms/${REALM_A}/users`).expect(200);
      await get('realmAdmin', `/admin/realms/${REALM_A}/users`).expect(200);
    });

    it('answers 403 for an unknown realm to everyone but a super-admin', async () => {
      await get('realmAdmin', `/admin/realms/${PREFIX}nope/clients`).expect(
        403,
      );
      await get('viewer', `/admin/realms/${PREFIX}nope/clients`).expect(403);
      await get('super', `/admin/realms/${PREFIX}nope/clients`).expect(404);
    });

    it('resolves auth-flows by realm id as the handler does', async () => {
      await get('realmAdmin', `/admin/realms/${realmAId}/auth-flows`).expect(
        200,
      );
      await get('realmAdmin', `/admin/realms/${realmBId}/auth-flows`).expect(
        403,
      );
      await get('realmAdmin', `/admin/realms/${REALM_B}/auth-flows`).expect(
        403,
      );
    });
  });

  describe('realm-scoped changes', () => {
    const groups = (realm: string) => `/admin/realms/${realm}/groups`;
    const groupCount = (realmId: string) =>
      ctx.prisma.group.count({ where: { realmId } });

    it.each([
      ['super', REALM_A, 201],
      ['apiKey', REALM_A, 201],
      ['realmAdmin', REALM_A, 201],
      ['super', REALM_B, 201],
      ['realmAdmin', REALM_B, 403],
      ['unscoped', REALM_A, 403],
      ['viewer', REALM_A, 403],
    ] as const)(
      '%s creating a group in %s answers %i',
      async (who, realm, status) => {
        await post(who, groups(realm), {
          name: `g-${who}-${realm}-${Date.now()}`,
        }).expect(status);
      },
    );

    it('a view-only write leaves the database unchanged', async () => {
      const before = await groupCount(realmAId);
      const clientsBefore = await ctx.prisma.client.findMany({
        where: { realmId: realmAId },
        select: { id: true, clientSecret: true, name: true },
        orderBy: { id: 'asc' },
      });
      await post('viewer', groups(REALM_A), { name: 'viewer-sample' }).expect(
        403,
      );
      await put('viewer', `/admin/realms/${REALM_A}/clients/test-client`, {
        name: 'renamed-by-viewer',
      }).expect(403);
      await post(
        'viewer',
        `/admin/realms/${REALM_A}/clients/test-client/regenerate-secret`,
      ).expect(403);
      await del(
        'viewer',
        `/admin/realms/${REALM_A}/clients/test-client`,
      ).expect(403);
      expect(await groupCount(realmAId)).toBe(before);
      expect(
        await ctx.prisma.client.findMany({
          where: { realmId: realmAId },
          select: { id: true, clientSecret: true, name: true },
          orderBy: { id: 'asc' },
        }),
      ).toEqual(clientsBefore);
    });

    it('a realm-admin can update and delete in its realm only', async () => {
      const created = await post('super', groups(REALM_B), {
        name: `b-only-${Date.now()}`,
      }).expect(201);
      await del(
        'realmAdmin',
        `${groups(REALM_B)}/${created.body.id as string}`,
      ).expect(403);
      const mine = await post('realmAdmin', groups(REALM_A), {
        name: `a-mine-${Date.now()}`,
      }).expect(201);
      await del(
        'realmAdmin',
        `${groups(REALM_A)}/${mine.body.id as string}`,
      ).expect(204);
    });

    it('keeps explicit super-admin requirements', async () => {
      // Deleting a user and clearing login events stay super-admin only.
      const user = await ctx.prisma.user.findFirstOrThrow({
        where: { realmId: realmAId, username: 'testuser' },
      });
      await del(
        'realmAdmin',
        `/admin/realms/${REALM_A}/users/${user.id}`,
      ).expect(403);
      await del('realmAdmin', `/admin/realms/${REALM_A}/events`).expect(403);
      await del('super', `/admin/realms/${REALM_A}/events`).expect(204);
    });

    it('never lets a realm-admin change the master realm', async () => {
      await post(
        'realmAdmin',
        `/admin/realms/master/users/${ids.realmAdmin}/role-mappings/realm`,
        [{ name: 'super-admin' }],
      ).expect(403);
    });

    it('guards the registration admin routes off /admin', async () => {
      const someone = '00000000-0000-4000-8000-000000000000';
      await post(
        'viewer',
        `/realms/${REALM_A}/registration/approve/${someone}`,
      ).expect(403);
      await post(
        'realmAdmin',
        `/realms/${REALM_B}/registration/approve/${someone}`,
      ).expect(403);
      await get('realmAdmin', `/realms/${REALM_A}/registration/pending`).expect(
        200,
      );
      await get('realmAdmin', `/realms/${REALM_B}/registration/pending`).expect(
        403,
      );
    });
  });

  describe('server-wide routes', () => {
    it.each([
      ['super', 200],
      ['apiKey', 200],
      ['realmAdmin', 403],
      ['viewer', 403],
    ] as const)(
      '%s on GET /admin/plugins and /admin/system/version answers %i',
      async (who, status) => {
        await get(who, '/admin/plugins').expect(status);
        await get(who, '/admin/system/version').expect(status);
      },
    );

    it('lets only a super-admin create a realm', async () => {
      const before = await ctx.prisma.realm.count();
      await post('realmAdmin', '/admin/realms', { name: NEW_REALM }).expect(
        403,
      );
      await post('viewer', '/admin/realms', { name: NEW_REALM }).expect(403);
      expect(await ctx.prisma.realm.count()).toBe(before);
      await post('super', '/admin/realms', { name: NEW_REALM }).expect(201);
      await del('super', `/admin/realms/${NEW_REALM}`).expect(204);
    });

    it('lets only a super-admin delete a realm, even its realm-admin', async () => {
      await del('realmAdmin', `/admin/realms/${REALM_A}`).expect(403);
      expect(await ctx.prisma.realm.count({ where: { name: REALM_A } })).toBe(
        1,
      );
    });

    it('manages realm assignments as a super-admin only', async () => {
      await get('realmAdmin', '/admin/admin-accounts').expect(403);
      await put(
        'realmAdmin',
        `/admin/admin-accounts/${ids.realmAdmin}/realms`,
        {
          realms: [REALM_A, REALM_B],
        },
      ).expect(403);
      await put('viewer', `/admin/admin-accounts/${ids.realmAdmin}/realms`, {
        realms: [REALM_B],
      }).expect(403);
      await put('super', `/admin/admin-accounts/${ids.realmAdmin}/realms`, {
        realms: ['master'],
      }).expect(400);
      await put('super', `/admin/admin-accounts/${ids.viewer}/realms`, {
        realms: [REALM_A],
      }).expect(409);
      const list = (await get('apiKey', '/admin/admin-accounts').expect(200))
        .body as { username: string; realms: string[] }[];
      expect(list.find((a) => a.username === USERS.realmAdmin)?.realms).toEqual(
        [REALM_A],
      );
    });

    it('refuses a master assignment written past the API', async () => {
      const master = await masterRealm();
      await expect(
        ctx.prisma.adminRealmAssignment.create({
          data: { userId: ids.realmAdmin, realmId: master.id },
        }),
      ).rejects.toThrow();
    });
  });

  describe('secret-revealing reads', () => {
    it.each([
      ['super', 200],
      ['apiKey', 200],
      ['realmAdmin', 403],
      ['viewer', 403],
    ] as const)(
      '%s exporting realm A with secrets answers %i',
      async (who, status) => {
        await get(
          who,
          `/admin/realms/${REALM_A}/export?includeSecrets=true`,
        ).expect(status);
        await get(who, `/admin/realms/${REALM_A}/export`).expect(status);
      },
    );

    it('returns a new client secret only to those who may change the realm', async () => {
      const path = `/admin/realms/${REALM_A}/clients/test-client/regenerate-secret`;
      await post('viewer', path).expect(403);
      await post('unscoped', path).expect(403);
      const res = await post('realmAdmin', path).expect(200);
      expect(typeof res.body.clientSecret).toBe('string');
    });
  });

  describe('own account', () => {
    it('lets every admin sign out', async () => {
      const throwaway = await login(USERS.viewer);
      await http()
        .post('/admin/auth/logout')
        .set('authorization', `Bearer ${throwaway}`)
        .expect(200);
      await http()
        .get('/admin/auth/me')
        .set('authorization', `Bearer ${throwaway}`)
        .expect(401);
    });
  });

  describe('changes apply on the next request', () => {
    it('removing an assignment or disabling an admin takes effect at once', async () => {
      await get('realmAdmin', `/admin/realms/${REALM_A}/clients`).expect(200);
      await put('super', `/admin/admin-accounts/${ids.realmAdmin}/realms`, {
        realms: [],
      }).expect(200, { realms: [] });
      await get('realmAdmin', `/admin/realms/${REALM_A}/clients`).expect(403);

      await put('super', `/admin/admin-accounts/${ids.realmAdmin}/realms`, {
        realms: [REALM_A],
      }).expect(200);
      await get('realmAdmin', `/admin/realms/${REALM_A}/clients`).expect(200);

      await ctx.prisma.user.update({
        where: { id: ids.unscoped },
        data: { enabled: false },
      });
      await get('unscoped', '/admin/auth/me').expect(403);
    });
  });
});
