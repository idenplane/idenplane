import request from 'supertest';
import { createTestApp, TEST_ADMIN_API_KEY, type TestContext } from './setup';
import { CryptoService } from '../src/crypto/crypto.service';
import { SECRET_PLACEHOLDER } from '../src/realms/secret-placeholder';

/**
 * GHSA-2463-97f9-hw7j: the setup wizard must be super-admin only, on every
 * endpoint, and closed for writes once setup is completed or skipped.
 */
describe('Setup wizard access control (e2e)', () => {
  let ctx: TestContext;
  let superToken: string;
  let viewerToken: string;
  let realmAdminToken: string;

  const REALM_PREFIX = 'wizard-e2e-';
  const USER_PASSWORD = 'Wizard-E2E-Pa55word!';
  const TEST_USERS = [
    'wizard-e2e-super',
    'wizard-e2e-viewer',
    'wizard-e2e-realm-admin',
  ];

  const ADMIN = {
    username: 'wizard-owner',
    email: 'owner@example.com',
    password: 'Owner-Passw0rd',
  };
  const SMTP = {
    host: 'smtp.example.com',
    port: 587,
    user: 'mailer',
    password: 'smtp-password-sentinel',
    from: 'noreply@example.com',
  };
  const CLIENT = {
    clientId: 'wizard-e2e-app',
    redirectUris: ['https://app.example.com/callback'],
  };

  type Method = 'get' | 'post';
  type Endpoint = {
    method: Method;
    path: string;
    body?: object;
    write: boolean;
  };

  const endpoints = (realmName = `${REALM_PREFIX}x`): Endpoint[] => [
    { method: 'get', path: '/setup-wizard/status', write: false },
    { method: 'get', path: '/setup-wizard/state', write: false },
    {
      method: 'post',
      path: '/setup-wizard/admin-account',
      body: ADMIN,
      write: true,
    },
    {
      method: 'post',
      path: '/setup-wizard/realm-settings',
      body: { name: realmName },
      write: true,
    },
    {
      method: 'post',
      path: '/setup-wizard/smtp-config',
      body: SMTP,
      write: true,
    },
    {
      method: 'post',
      path: '/setup-wizard/smtp/test',
      body: { to: 'test@example.com' },
      write: true,
    },
    { method: 'post', path: '/setup-wizard/client', body: CLIENT, write: true },
    { method: 'post', path: '/setup-wizard/sdk-generated', write: true },
    { method: 'post', path: '/setup-wizard/complete', write: true },
    { method: 'post', path: '/setup-wizard/skip', write: true },
    { method: 'post', path: '/setup-wizard/reset', write: true },
  ];

  const http = () => request(ctx.app.getHttpServer());

  const call = (
    { method, path, body }: Endpoint,
    auth: Record<string, string> = {},
  ) => {
    let req = http()[method](path);
    for (const [name, value] of Object.entries(auth))
      req = req.set(name, value);
    return body ? req.send(body) : req;
  };

  const apiKey = { 'x-admin-api-key': TEST_ADMIN_API_KEY };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  const freshWizard = async () => {
    await ctx.prisma.wizardState.deleteMany({});
  };

  /** Answers steps 1-3 so that `complete` can run. */
  const answerSteps = async (
    auth: Record<string, string>,
    realmName: string,
  ) => {
    const post = (path: string, body: object) =>
      http().post(path).set(auth).send(body);
    await post('/setup-wizard/admin-account', ADMIN).expect(200);
    await post('/setup-wizard/realm-settings', { name: realmName }).expect(200);
    await post('/setup-wizard/smtp-config', SMTP).expect(200);
  };

  const login = async (username: string) => {
    const res = await http()
      .post('/admin/auth/login')
      .send({ username, password: USER_PASSWORD })
      .expect(200);
    return res.body.access_token as string;
  };

  const cleanup = async () => {
    await ctx.prisma.wizardState.deleteMany({});
    await ctx.prisma.realm.deleteMany({
      where: { name: { startsWith: REALM_PREFIX } },
    });
    const master = await ctx.prisma.realm.findUnique({
      where: { name: 'master' },
    });
    if (master) {
      await ctx.prisma.user.deleteMany({
        where: { realmId: master.id, username: { in: TEST_USERS } },
      });
    }
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await cleanup();

    const master = await ctx.prisma.realm.findUniqueOrThrow({
      where: { name: 'master' },
      include: { roles: true },
    });
    const roleId = (name: string) => {
      const role = master.roles.find((r) => r.name === name);
      if (!role) throw new Error(`master realm has no ${name} role`);
      return role.id;
    };
    const passwordHash = await ctx.app
      .get(CryptoService)
      .hashPassword(USER_PASSWORD);
    const roleOf: Record<string, string> = {
      'wizard-e2e-super': 'super-admin',
      'wizard-e2e-viewer': 'view-only',
      'wizard-e2e-realm-admin': 'realm-admin',
    };
    for (const username of TEST_USERS) {
      await ctx.prisma.user.create({
        data: {
          realmId: master.id,
          username,
          enabled: true,
          passwordHash,
          userRoles: { create: { roleId: roleId(roleOf[username]) } },
        },
      });
    }

    superToken = await login('wizard-e2e-super');
    viewerToken = await login('wizard-e2e-viewer');
    realmAdminToken = await login('wizard-e2e-realm-admin');
  }, 60_000);

  afterAll(async () => {
    await cleanup();
    await ctx.cleanup();
  });

  beforeEach(freshWizard);

  describe('without credentials', () => {
    it.each(
      endpoints().map(
        (e) => [`${e.method.toUpperCase()} ${e.path}`, e] as const,
      ),
    )('%s answers 401', async (_label, endpoint) => {
      await call(endpoint).expect(401);
    });

    it.each(
      endpoints().map(
        (e) => [`${e.method.toUpperCase()} ${e.path}`, e] as const,
      ),
    )('%s answers 401 with a wrong API key', async (_label, endpoint) => {
      await call(endpoint, { 'x-admin-api-key': 'not-the-key' }).expect(401);
    });

    it('answers 401 with an invalid bearer token', async () => {
      await http()
        .get('/setup-wizard/state')
        .set('authorization', 'Bearer not-a-jwt')
        .expect(401);
    });

    it('cannot be reached through a differently cased path', async () => {
      const res = await http().get('/SETUP-WIZARD/state');
      expect(res.status).toBe(401);
      const complete = await http().post('/Setup-Wizard/complete');
      expect(complete.status).toBe(401);
    });

    it('creates no realm, user or wizard answers', async () => {
      const realms = await ctx.prisma.realm.count();
      const users = await ctx.prisma.user.count();
      for (const endpoint of endpoints()) await call(endpoint);
      expect(await ctx.prisma.realm.count()).toBe(realms);
      expect(await ctx.prisma.user.count()).toBe(users);
      const state = await ctx.prisma.wizardState.findFirst();
      expect(state?.adminUsername ?? null).toBeNull();
      expect(state?.completed ?? false).toBe(false);
    });
  });

  describe('as an admin without super-admin', () => {
    it.each(
      endpoints().map(
        (e) => [`${e.method.toUpperCase()} ${e.path}`, e] as const,
      ),
    )('view-only: %s answers 403', async (_label, endpoint) => {
      await call(endpoint, bearer(viewerToken)).expect(403);
    });

    it.each(
      endpoints().map(
        (e) => [`${e.method.toUpperCase()} ${e.path}`, e] as const,
      ),
    )('realm-admin: %s answers 403', async (_label, endpoint) => {
      await call(endpoint, bearer(realmAdminToken)).expect(403);
    });
  });

  describe.each([
    ['the admin API key', () => apiKey],
    ['a super-admin JWT', () => bearer(superToken)],
  ])('with %s on a fresh wizard', (label, auth) => {
    it('reads the status and state', async () => {
      const status = await http()
        .get('/setup-wizard/status')
        .set(auth())
        .expect(200);
      expect(status.body).toMatchObject({
        wizardCompleted: false,
        wizardSkipped: false,
      });
      const state = await http()
        .get('/setup-wizard/state')
        .set(auth())
        .expect(200);
      expect(state.body).toMatchObject({ completed: false, skipped: false });
    });

    it('runs the wizard to completion and creates the realm and its admin', async () => {
      const realmName = `${REALM_PREFIX}${label.includes('JWT') ? 'jwt' : 'key'}`;
      await answerSteps(auth(), realmName);
      await http()
        .post('/setup-wizard/smtp/test')
        .set(auth())
        .send({ to: 'test@example.com' })
        .expect(200);
      // The client step needs the realm, which only `complete` creates:
      // a known ordering limitation, but it is authorized (not 401/403).
      const client = await http()
        .post('/setup-wizard/client')
        .set(auth())
        .send(CLIENT);
      expect(client.status).toBe(400);
      await http().post('/setup-wizard/sdk-generated').set(auth()).expect(200);

      const done = await http()
        .post('/setup-wizard/complete')
        .set(auth())
        .expect(200);
      expect(done.body).toMatchObject({ success: true });

      const realm = await ctx.prisma.realm.findUnique({
        where: { name: realmName },
        include: { users: true },
      });
      expect(realm).not.toBeNull();
      expect(realm!.users.map((u) => u.username)).toEqual([ADMIN.username]);
      const status = await http()
        .get('/setup-wizard/status')
        .set(auth())
        .expect(200);
      expect(status.body.wizardCompleted).toBe(true);
    });

    it('resets an in-progress wizard without touching realms or users', async () => {
      await answerSteps(auth(), `${REALM_PREFIX}reset`);
      const realms = await ctx.prisma.realm.count();
      const users = await ctx.prisma.user.count();

      const reset = await http()
        .post('/setup-wizard/reset')
        .set(auth())
        .expect(200);
      expect(reset.body).toMatchObject({
        completed: false,
        currentStep: 0,
        adminUsername: null,
        realmName: null,
      });
      expect(await ctx.prisma.realm.count()).toBe(realms);
      expect(await ctx.prisma.user.count()).toBe(users);
    });

    it('skips the wizard', async () => {
      const res = await http()
        .post('/setup-wizard/skip')
        .set(auth())
        .expect(200);
      expect(res.body).toMatchObject({ skipped: true });
    });
  });

  describe.each([
    ['completed', 'complete'],
    ['skipped', 'skip'],
  ])('once setup is %s', (_label, finish) => {
    beforeEach(async () => {
      await answerSteps(apiKey, `${REALM_PREFIX}closed`);
      await http().post(`/setup-wizard/${finish}`).set(apiKey).expect(200);
    });

    afterEach(async () => {
      await ctx.prisma.realm.deleteMany({
        where: { name: `${REALM_PREFIX}closed` },
      });
    });

    it('answers 409 to every write and creates no realm or user', async () => {
      const realms = await ctx.prisma.realm.count();
      const users = await ctx.prisma.user.count();
      const clients = await ctx.prisma.client.count();
      const before = await ctx.prisma.wizardState.findFirstOrThrow();

      for (const endpoint of endpoints(`${REALM_PREFIX}again`).filter(
        (e) => e.write,
      )) {
        for (const auth of [apiKey, bearer(superToken)]) {
          const res = await call(endpoint, auth);
          expect({ path: endpoint.path, status: res.status }).toEqual({
            path: endpoint.path,
            status: 409,
          });
          expect(res.body.message).toBe('Setup is already complete');
        }
      }

      expect(await ctx.prisma.realm.count()).toBe(realms);
      expect(await ctx.prisma.user.count()).toBe(users);
      expect(await ctx.prisma.client.count()).toBe(clients);
      expect(
        await ctx.prisma.realm.findUnique({
          where: { name: `${REALM_PREFIX}again` },
        }),
      ).toBeNull();
      const after = await ctx.prisma.wizardState.findFirstOrThrow();
      expect(after).toEqual(before);
    });

    it('still lets a super-admin read the status and state', async () => {
      await http().get('/setup-wizard/status').set(apiKey).expect(200);
      const state = await http()
        .get('/setup-wizard/state')
        .set(apiKey)
        .expect(200);
      expect(state.body[_label]).toBe(true);
    });

    it('still answers 401 and 403 before 409', async () => {
      await http().post('/setup-wizard/complete').expect(401);
      await http()
        .post('/setup-wizard/complete')
        .set(bearer(viewerToken))
        .expect(403);
    });
  });

  it('creates exactly one realm when complete is called concurrently', async () => {
    const realmName = `${REALM_PREFIX}race`;
    await answerSteps(apiKey, realmName);
    const usersBefore = await ctx.prisma.user.count();

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        http()
          .post('/setup-wizard/complete')
          .set(i % 2 ? bearer(superToken) : apiKey),
      ),
    );

    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409, 409, 409]);
    expect(await ctx.prisma.realm.count({ where: { name: realmName } })).toBe(
      1,
    );
    expect(await ctx.prisma.user.count()).toBe(usersBefore + 1);
    const realm = await ctx.prisma.realm.findUniqueOrThrow({
      where: { name: realmName },
      include: { users: true, roles: true },
    });
    expect(realm.users).toHaveLength(1);
    expect(realm.roles).toHaveLength(3);
  }, 60_000);

  describe('state never contains secrets', () => {
    const SENTINELS = {
      hash: '$argon2id$v=19$m=65536,t=3,p=4$SENTINELHASH',
      clientSecret: 'SENTINEL-legacy-client-secret',
      smtpPassword: 'SENTINEL-smtp-password',
    };

    it('redacts the SMTP password and drops the hash and client secret', async () => {
      await http().get('/setup-wizard/state').set(apiKey).expect(200);
      const row = await ctx.prisma.wizardState.findFirstOrThrow();
      await ctx.prisma.wizardState.update({
        where: { id: row.id },
        data: {
          adminUsername: 'someone',
          adminPasswordHash: SENTINELS.hash,
          clientSecret: SENTINELS.clientSecret,
          smtpConfig: { host: 'h', port: 25, password: SENTINELS.smtpPassword },
        },
      });

      for (const auth of [apiKey, bearer(superToken)]) {
        const res = await http()
          .get('/setup-wizard/state')
          .set(auth)
          .expect(200);
        const json = JSON.stringify(res.body);
        for (const secret of Object.values(SENTINELS)) {
          expect(json).not.toContain(secret);
        }
        expect(res.body).not.toHaveProperty('adminPasswordHash');
        expect(res.body).not.toHaveProperty('clientSecret');
        expect(res.body.smtpConfig.password).toBe(SECRET_PLACEHOLDER);
      }
    });

    it('write responses carry no password hash or SMTP password', async () => {
      const responses = [
        await http()
          .post('/setup-wizard/admin-account')
          .set(apiKey)
          .send(ADMIN)
          .expect(200),
        await http()
          .post('/setup-wizard/smtp-config')
          .set(apiKey)
          .send(SMTP)
          .expect(200),
        await http()
          .post('/setup-wizard/sdk-generated')
          .set(apiKey)
          .expect(200),
      ];
      for (const res of responses) {
        const json = JSON.stringify(res.body);
        expect(json).not.toContain('argon2');
        expect(json).not.toContain(SMTP.password);
        expect(json).not.toContain(ADMIN.password);
        expect(res.body).not.toHaveProperty('adminPasswordHash');
        expect(res.body).not.toHaveProperty('clientSecret');
      }
    });
  });
});

describe('Admin API path casing (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 30_000);

  afterAll(async () => {
    await ctx.cleanup();
  });

  // Express routes case-insensitively, so these paths reach admin handlers.
  // The client handlers carry no role decorator: the guard's prefix check
  // is their only protection.
  it.each([
    '/ADMIN/realms',
    '/Admin/realms/master',
    '/ADMIN/realms/master/clients',
    '/admin/REALMS/master/clients',
    '/aDmIn/realms/master/users',
  ])('answers 401 to %s without credentials', async (path) => {
    const res = await request(ctx.app.getHttpServer()).get(path);
    expect(res.status).toBe(401);
  });

  it('answers 401 to a differently cased admin write without credentials', async () => {
    const before = await ctx.prisma.realm.count();
    const res = await request(ctx.app.getHttpServer())
      .post('/ADMIN/realms')
      .send({ name: 'wizard-e2e-casing', enabled: true });
    expect(res.status).toBe(401);
    expect(await ctx.prisma.realm.count()).toBe(before);
  });

  it('does not serve the admin API under the versioned prefix without credentials', async () => {
    const res = await request(ctx.app.getHttpServer()).get(
      '/api/v1/admin/realms',
    );
    expect([401, 404]).toContain(res.status);
  });
});
