import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createTestApp, TEST_ADMIN_API_KEY, type TestContext } from './setup';
import { CryptoService } from '../src/crypto/crypto.service';
import { RealmImportService } from '../src/realms/realm-import.service';
import { SetupWizardService } from '../src/setup-wizard/setup-wizard.service';
import { InstanceBootstrapService } from '../src/bootstrap/instance-bootstrap.service';

/**
 * Unattended setup from BOOTSTRAP_FILE: a fresh instance gets its realms and
 * a closed setup wizard from configuration, exactly once, even with several
 * instances starting together; a failure leaves nothing behind.
 */
describe('Instance bootstrap (e2e)', () => {
  let ctx: TestContext;

  const REALM = 'bootstrap-e2e';
  const SECOND_REALM = 'bootstrap-e2e-two';
  const EXISTING_REALM = 'bootstrap-e2e-existing';
  const CLIENT_ID = 'bootstrap-e2e-app';
  const ENV = {
    BOOTSTRAP_E2E_CLIENT_SECRET: 'dummy-bootstrap-client-secret-0123456789',
    BOOTSTRAP_E2E_SMTP_PASSWORD: 'dummy-bootstrap-smtp-password',
    BOOTSTRAP_E2E_OWNER_PASSWORD: 'dummy-bootstrap-owner-password',
  };

  const realmDoc = (name: string) => ({
    version: 2,
    realm: {
      name,
      displayName: 'Bootstrap E2E',
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpFrom: 'noreply@example.com',
      smtpUser: 'mailer',
      smtpPassword: '${env:BOOTSTRAP_E2E_SMTP_PASSWORD}',
    },
    roles: [{ name: 'app-admin' }],
    clients: [
      {
        clientId: CLIENT_ID,
        name: 'Bootstrap E2E app',
        clientSecret: '${env:BOOTSTRAP_E2E_CLIENT_SECRET}',
        redirectUris: ['https://app.example.com/callback'],
        grantTypes: ['authorization_code', 'client_credentials'],
      },
    ],
    users: [
      {
        username: 'owner',
        email: 'owner@example.com',
        initialPassword: '${env:BOOTSTRAP_E2E_OWNER_PASSWORD}',
        roles: [{ name: 'app-admin' }],
      },
    ],
  });

  const writeFile = (doc: unknown): string => {
    const dir = mkdtempSync(join(tmpdir(), 'bootstrap-e2e-'));
    const file = join(dir, 'bootstrap.json');
    writeFileSync(file, JSON.stringify(doc));
    return file;
  };

  /** One instance's bootstrap, as it runs at startup. */
  const instance = (
    file: string,
    realmImport: RealmImportService = ctx.app.get(RealmImportService, {
      strict: false,
    }),
  ) =>
    new InstanceBootstrapService(
      {
        get: (key: string) => (key === 'BOOTSTRAP_FILE' ? file : undefined),
      } as never,
      ctx.app.get(CryptoService),
      realmImport,
      ctx.app.get(SetupWizardService, { strict: false }),
    );

  /** A fresh instance: no realm but master, and setup never completed. */
  const freshInstance = async () => {
    await ctx.prisma.wizardState.deleteMany({});
    await ctx.prisma.realm.deleteMany({ where: { name: { not: 'master' } } });
  };

  const wizardState = () => ctx.prisma.wizardState.findFirst();

  beforeAll(async () => {
    Object.assign(process.env, ENV);
    ctx = await createTestApp();
  }, 30_000);

  afterAll(async () => {
    for (const key of Object.keys(ENV)) delete process.env[key];
    await ctx.prisma.wizardState.deleteMany({});
    await ctx.prisma.realm.deleteMany({
      where: { name: { startsWith: 'bootstrap-e2e' } },
    });
    await ctx.cleanup();
  });

  it('is inert without BOOTSTRAP_FILE', async () => {
    await freshInstance();
    await expect(instance('').run()).resolves.toEqual({
      status: 'not-configured',
    });
    expect(await ctx.prisma.realm.count({ where: { name: REALM } })).toBe(0);
    expect((await wizardState())?.completed ?? false).toBe(false);
  });

  describe('on a fresh instance with four instances starting at once', () => {
    let file: string;

    beforeAll(async () => {
      await freshInstance();
      file = writeFile({ version: 1, realms: [realmDoc(REALM)] });
      const outcomes = await Promise.all(
        Array.from({ length: 4 }, () => instance(file).run()),
      );
      expect(outcomes.map((o) => o.status).sort()).toEqual([
        'already-set-up',
        'already-set-up',
        'already-set-up',
        'applied',
      ]);
    }, 120_000);

    it('creates the realm once, with its client, user, roles and scopes', async () => {
      const realms = await ctx.prisma.realm.findMany({
        where: { name: REALM },
        include: {
          clients: true,
          users: { include: { userRoles: { include: { role: true } } } },
          roles: true,
          signingKeys: true,
          clientScopes: true,
        },
      });
      expect(realms).toHaveLength(1);
      const [realm] = realms;
      expect(realm.displayName).toBe('Bootstrap E2E');
      expect(realm.clients.map((c) => c.clientId)).toEqual([CLIENT_ID]);
      expect(realm.users.map((u) => u.username)).toEqual(['owner']);
      expect(realm.users[0].userRoles.map((ur) => ur.role.name)).toEqual([
        'app-admin',
      ]);
      expect(realm.signingKeys.length).toBeGreaterThan(0);
      // The import seeds the default scopes when the document has none.
      expect(realm.clientScopes.map((s) => s.name)).toEqual(
        expect.arrayContaining(['openid', 'profile', 'email']),
      );
    });

    it('stores secrets only hashed or encrypted, and they work', async () => {
      const crypto = ctx.app.get(CryptoService);
      const realm = await ctx.prisma.realm.findUniqueOrThrow({
        where: { name: REALM },
        include: { clients: true, users: true },
      });

      expect(realm.smtpPassword).not.toBe(ENV.BOOTSTRAP_E2E_SMTP_PASSWORD);
      expect(crypto.decryptSecret(realm.smtpPassword)).toBe(
        ENV.BOOTSTRAP_E2E_SMTP_PASSWORD,
      );

      const client = realm.clients[0];
      expect(client.clientSecret).not.toBe(ENV.BOOTSTRAP_E2E_CLIENT_SECRET);
      expect(
        (
          await crypto.verifySecret(
            client.clientSecret!,
            ENV.BOOTSTRAP_E2E_CLIENT_SECRET,
          )
        ).valid,
      ).toBe(true);

      const owner = realm.users[0];
      expect(owner.passwordHash).toBeTruthy();
      expect(
        await crypto.verifyPassword(
          owner.passwordHash!,
          ENV.BOOTSTRAP_E2E_OWNER_PASSWORD,
        ),
      ).toBe(true);
    });

    it('serves tokens to the declared client', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post(`/realms/${REALM}/protocol/openid-connect/token`)
        .type('form')
        .send({
          grant_type: 'client_credentials',
          client_id: CLIENT_ID,
          client_secret: ENV.BOOTSTRAP_E2E_CLIENT_SECRET,
        })
        .expect(200);
      expect(res.body.access_token).toEqual(expect.any(String));
    });

    it('closes the setup wizard for good', async () => {
      const http = () => request(ctx.app.getHttpServer());
      const status = await http()
        .get('/setup-wizard/status')
        .set('x-admin-api-key', TEST_ADMIN_API_KEY)
        .expect(200);
      expect(status.body).toMatchObject({
        wizardCompleted: true,
        isFirstRun: false,
      });

      for (const path of [
        '/setup-wizard/admin-account',
        '/setup-wizard/realm-settings',
        '/setup-wizard/complete',
        '/setup-wizard/skip',
        '/setup-wizard/reset',
      ]) {
        const res = await http()
          .post(path)
          .set('x-admin-api-key', TEST_ADMIN_API_KEY)
          .send({
            username: 'intruder',
            email: 'intruder@example.com',
            password: 'Dummy-Passw0rd-example',
            name: 'bootstrap-e2e-intruder',
          });
        expect({ path, status: res.status }).toEqual({ path, status: 409 });
      }
    });

    it('changes nothing on a restart, even with a different file', async () => {
      const before = await ctx.prisma.realm.findUniqueOrThrow({
        where: { name: REALM },
      });
      const realmCount = await ctx.prisma.realm.count();
      const changed = writeFile({
        version: 1,
        realms: [realmDoc(SECOND_REALM)],
      });

      await expect(instance(file).run()).resolves.toEqual({
        status: 'already-set-up',
      });
      await expect(instance(changed).run()).resolves.toEqual({
        status: 'already-set-up',
      });

      expect(await ctx.prisma.realm.count()).toBe(realmCount);
      const after = await ctx.prisma.realm.findUniqueOrThrow({
        where: { name: REALM },
      });
      expect(after.updatedAt).toEqual(before.updatedAt);
    });
  });

  it('leaves nothing behind and the wizard open when a realm fails', async () => {
    await freshInstance();
    const realImport = ctx.app.get(RealmImportService, { strict: false });
    // The second realm fails inside the transaction, after the first was
    // written: both must be rolled back.
    const failing = {
      prepareV2Import: async (doc: { realm: { name: string } }) => {
        const prepared = await realImport.prepareV2Import(doc);
        if (doc.realm.name !== SECOND_REALM) return prepared;
        return {
          ...prepared,
          write: async () => {
            throw new Error('simulated failure');
          },
        };
      },
      refreshAfterImport: () => realImport.refreshAfterImport(),
    } as unknown as RealmImportService;
    const file = writeFile({
      version: 1,
      realms: [realmDoc(REALM), realmDoc(SECOND_REALM)],
    });

    await expect(
      instance(file, failing).onApplicationBootstrap(),
    ).rejects.toThrow(
      /nothing was applied.*realm 'bootstrap-e2e-two': simulated failure/,
    );
    expect(
      await ctx.prisma.realm.count({
        where: { name: { in: [REALM, SECOND_REALM] } },
      }),
    ).toBe(0);
    expect((await wizardState())?.completed).toBe(false);

    // The next start, with the problem gone, applies everything.
    await expect(instance(file).run()).resolves.toEqual({
      status: 'applied',
      realms: [REALM, SECOND_REALM],
    });
    expect((await wizardState())?.completed).toBe(true);
  }, 60_000);

  it('refuses an invalid file before touching anything', async () => {
    await freshInstance();
    const file = writeFile({
      version: 1,
      realms: [{ ...realmDoc(REALM), clients: [{ clientId: CLIENT_ID }] }],
    });

    await expect(instance(file).onApplicationBootstrap()).rejects.toThrow(
      /clients\[0\]\.clientSecret/,
    );
    expect(await ctx.prisma.realm.count({ where: { name: REALM } })).toBe(0);
    expect((await wizardState())?.completed ?? false).toBe(false);
  });

  it('does not touch an instance that already has realms', async () => {
    await freshInstance();
    await ctx.prisma.realm.create({
      data: { name: EXISTING_REALM, displayName: 'Existing' },
    });
    const file = writeFile({ version: 1, realms: [realmDoc(REALM)] });

    await expect(instance(file).run()).resolves.toEqual({
      status: 'not-fresh',
      existingRealms: [EXISTING_REALM],
    });
    expect(await ctx.prisma.realm.count({ where: { name: REALM } })).toBe(0);
    expect((await wizardState())?.completed).toBe(false);
  });
});
