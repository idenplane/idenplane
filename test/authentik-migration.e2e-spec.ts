import { pbkdf2Sync } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import * as bcryptjs from 'bcryptjs';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  createTestApp,
  TEST_ADMIN_API_KEY,
  type SeededRealm,
  type TestContext,
} from './setup';

/**
 * An Authentik import made from the REST API's own responses, pages and
 * all: the import file is `/core/users/`, `/core/groups/`,
 * `/providers/oauth2/` and `/sources/oauth/` side by side, with password
 * hashes from Authentik's database merged into the users.
 *
 * Covers what the importer used to get wrong with that input: a paginated
 * response was a 500, empty e-mail addresses collided, service accounts
 * were imported, `redirect_uris` objects broke the client, a source's
 * display name became its alias, bcrypt hashes were dropped, and users
 * that already existed never got their memberships.
 */
describe('Authentik migration (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;

  const REALM = 'e2e-authentik-import';
  // Test passwords only; never real credentials.
  const PBKDF2_PASSWORD = 'ak-pbkdf2-example-1';
  const BCRYPT_PASSWORD = 'ak-bcrypt-example-2';

  const djangoPbkdf2 = (password: string) => {
    const salt = 'exampleSalt123';
    const hash = pbkdf2Sync(password, salt, 1000, 32, 'sha256');
    return `pbkdf2_sha256$1000$${salt}$${hash.toString('base64')}`;
  };

  const page = <T>(results: T[]) => ({
    pagination: {
      next: 0,
      previous: 0,
      count: results.length,
      current: 1,
      total_pages: 1,
      start_index: 1,
      end_index: results.length,
    },
    results,
  });

  const importAuthentik = (
    data: unknown,
    dryRun = false,
    extra: Record<string, unknown> = {},
  ) =>
    request(app.getHttpServer())
      .post('/admin/migration/authentik')
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .send({ targetRealm: REALM, dryRun, data, ...extra });

  let exportData: Record<string, unknown>;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app as INestApplication<App>;
    seeded = await ctx.seedTestRealm(REALM);

    exportData = {
      groups: page([
        { pk: 'grp-eng', name: 'ak-engineering', parent: null },
        { pk: 'grp-be', name: 'ak-backend', parent: 'grp-eng' },
      ]),
      users: page([
        {
          pk: 1,
          username: 'ak-pbkdf2',
          name: 'Mary Ann Smith',
          email: 'ak-pbkdf2@example.com',
          is_active: true,
          type: 'internal',
          groups: ['grp-be'],
          password: djangoPbkdf2(PBKDF2_PASSWORD),
        },
        {
          pk: 2,
          username: 'ak-bcrypt',
          email: '',
          is_active: true,
          type: 'internal',
          groups: [],
          password: `bcrypt$${bcryptjs.hashSync(BCRYPT_PASSWORD, 4)}`,
        },
        {
          pk: 3,
          username: 'ak-no-email',
          email: '',
          is_active: true,
          type: 'external',
          groups: [],
        },
        {
          pk: 4,
          username: 'ak-duplicate',
          email: 'ak-pbkdf2@example.com',
          type: 'internal',
          groups: [],
        },
        {
          pk: 5,
          username: 'ak-outpost-e2e',
          email: '',
          type: 'internal_service_account',
          groups: [],
        },
      ]),
      providers: page([
        {
          pk: 1,
          name: 'AK Web',
          client_id: 'ak-web',
          client_secret: 'ak-web-example-secret',
          client_type: 'confidential',
          redirect_uris: [
            { matching_mode: 'strict', url: 'https://web.example/cb' },
            { matching_mode: 'regex', url: 'https://.*[.]web[.]example/cb' },
          ],
        },
        {
          pk: 2,
          name: 'AK Legacy',
          client_id: 'ak-legacy',
          client_type: 'confidential',
          redirect_uris: 'https://legacy.example/cb\n',
        },
      ]),
      sources: page([
        {
          pk: 'src-1',
          name: 'AK Corporate SSO',
          slug: 'ak-corp-sso',
          provider_type: 'openidconnect',
          authorization_url: 'https://sso.example/authorize',
          access_token_url: 'https://sso.example/token',
          profile_url: 'https://sso.example/userinfo',
          oidc_jwks_url: 'https://sso.example/jwks',
          oidc_well_known_url:
            'https://sso.example/.well-known/openid-configuration',
          consumer_key: 'ak-sso-client',
        },
      ]),
    };
  });

  afterAll(async () => {
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
  });

  const userRow = (username: string) =>
    ctx.prisma.user.findUnique({
      where: { realmId_username: { realmId: seeded.realm.id, username } },
      include: { userGroups: { include: { group: true } } },
    });

  it('refuses a section that is not a list with 400, not 500', async () => {
    const res = await importAuthentik({ users: { username: 'x' } }, true);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain(
      'data.users must be an array, or an Authentik paginated response',
    );
  });

  it('a dry run predicts the duplicate e-mail and writes nothing', async () => {
    const res = await importAuthentik(exportData, true);
    expect(res.status).toBe(200);
    expect(res.body.summary.users).toEqual({
      created: 4,
      skipped: 1,
      failed: 0,
    });
    expect(JSON.stringify(res.body.warnings)).toContain(
      "User 'ak-duplicate': e-mail address ak-pbkdf2@example.com already belongs to user 'ak-pbkdf2'",
    );
    expect(await userRow('ak-pbkdf2')).toBeNull();
  });

  it('imports the raw API responses', async () => {
    const res = await importAuthentik(exportData);
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(res.body.summary).toMatchObject({
      users: { created: 4, skipped: 1, failed: 0 },
      groups: { created: 2, skipped: 0, failed: 0 },
      clients: { created: 2, skipped: 0, failed: 0 },
      identityProviders: { created: 1, skipped: 0, failed: 0 },
    });

    // Empty e-mails are null, so two users without one both import.
    expect((await userRow('ak-bcrypt'))?.email).toBeNull();
    expect((await userRow('ak-no-email'))?.email).toBeNull();
    expect((await userRow('ak-duplicate'))?.email).toBeNull();
    expect(await userRow('ak-outpost-e2e')).toBeNull();

    // Group pks resolve; the sub-group keeps its parent.
    const pbkdf2User = await userRow('ak-pbkdf2');
    expect(pbkdf2User).toMatchObject({
      firstName: 'Mary',
      lastName: 'Ann Smith',
    });
    expect(pbkdf2User?.userGroups.map((g) => g.group.name)).toEqual([
      'ak-backend',
    ]);
    const backend = await ctx.prisma.group.findFirstOrThrow({
      where: { realmId: seeded.realm.id, name: 'ak-backend' },
      include: { parent: true },
    });
    expect(backend.parent?.name).toBe('ak-engineering');

    // Strict redirect URIs kept, regex left out; no secret means disabled.
    const web = await ctx.prisma.client.findFirstOrThrow({
      where: { realmId: seeded.realm.id, clientId: 'ak-web' },
    });
    expect(web).toMatchObject({
      enabled: true,
      redirectUris: ['https://web.example/cb'],
    });
    const legacy = await ctx.prisma.client.findFirstOrThrow({
      where: { realmId: seeded.realm.id, clientId: 'ak-legacy' },
    });
    expect(legacy).toMatchObject({
      enabled: false,
      clientSecret: null,
      redirectUris: ['https://legacy.example/cb'],
    });

    // Alias from the slug; profile, JWKS and issuer carried over.
    const idp = await ctx.prisma.identityProvider.findFirstOrThrow({
      where: { realmId: seeded.realm.id, alias: 'ak-corp-sso' },
    });
    expect(idp).toMatchObject({
      displayName: 'AK Corporate SSO',
      userinfoUrl: 'https://sso.example/userinfo',
      jwksUrl: 'https://sso.example/jwks',
      issuer: 'https://sso.example',
      enabled: false,
    });

    const messages = JSON.stringify(res.body.warnings);
    expect(messages).toContain("User 'ak-outpost-e2e' was not imported");
    expect(messages).toContain(
      "Client 'AK Web': redirect URI 'https://.*[.]web[.]example/cb' was not imported",
    );
    expect(messages).toContain(
      "Client 'AK Legacy' is confidential but has no client secret",
    );
  });

  it.each([
    ['ak-pbkdf2', () => PBKDF2_PASSWORD, 'pbkdf2-sha256'],
    ['ak-bcrypt', () => BCRYPT_PASSWORD, 'bcrypt'],
  ])(
    '%s signs in with the Authentik password, and the hash moves to Argon2id',
    async (username, password, algorithm) => {
      expect((await userRow(username))?.passwordAlgorithm).toBe(algorithm);
      const res = await request(app.getHttpServer())
        .post(`/realms/${REALM}/protocol/openid-connect/token`)
        .type('form')
        .send({
          grant_type: 'password',
          client_id: 'test-client',
          client_secret: 'test-client-secret',
          username,
          password: password(),
        });
      expect(res.status).toBe(200);
      expect((await userRow(username))?.passwordHash).toMatch(/^\$argon2id\$/);
    },
  );

  describe('a second import', () => {
    const withExtraGroup = () => {
      const users = (exportData.users as { results: Record<string, unknown>[] })
        .results;
      return {
        ...exportData,
        users: page(
          users.map((u) =>
            u.username === 'ak-pbkdf2'
              ? { ...u, groups: ['grp-be', 'grp-eng'], name: 'Changed Name' }
              : u,
          ),
        ),
      };
    };
    const groupsOf = async (username: string) =>
      (await userRow(username))?.userGroups.map((g) => g.group.name).sort();

    it('leaves existing users alone by default and says how many it withheld', async () => {
      const res = await importAuthentik(withExtraGroup());
      expect(res.status).toBe(200);
      expect(res.body.summary.users).toEqual({
        created: 0,
        skipped: 5,
        failed: 0,
      });
      expect(await groupsOf('ak-pbkdf2')).toEqual(['ak-backend']);
      expect(JSON.stringify(res.body.warnings)).toContain(
        '1 existing user(s) were not given memberships (enable addMembershipsToExistingUsers to add them).',
      );
    });

    it('adds missing memberships with addMembershipsToExistingUsers, and changes nothing else', async () => {
      const res = await importAuthentik(withExtraGroup(), false, {
        addMembershipsToExistingUsers: true,
      });
      expect(res.status).toBe(200);
      expect(await groupsOf('ak-pbkdf2')).toEqual([
        'ak-backend',
        'ak-engineering',
      ]);
      expect((await userRow('ak-pbkdf2'))?.firstName).toBe('Mary');
      expect(JSON.stringify(res.body.warnings)).toContain(
        "User 'ak-pbkdf2' already existed and was not changed, except: added 1 group membership(s)",
      );
    });

    it('refuses a non-boolean addMembershipsToExistingUsers', async () => {
      const res = await importAuthentik({}, true, {
        addMembershipsToExistingUsers: 'yes',
      });
      expect(res.status).toBe(400);
    });
  });
});
