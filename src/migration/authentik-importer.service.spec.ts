import { Test } from '@nestjs/testing';
import { pbkdf2Sync } from 'crypto';
import { parsePbkdf2, verifyPbkdf2 } from '../crypto/password-hash-formats.js';
import * as argon2 from 'argon2';
import { AuthentikImporterService } from './authentik-importer.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import type { AuthentikExport } from './authentik-types.js';

describe('AuthentikImporterService', () => {
  let service: AuthentikImporterService;
  let prisma: any;

  function djangoPbkdf2Hash(
    password: string,
    salt = 'testsalt123',
    iterations = 260000,
  ): string {
    const digest = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
    return `pbkdf2_sha256$${iterations}$${salt}$${digest.toString('base64')}`;
  }

  const mockExport: AuthentikExport = {
    groups: [{ pk: 'grp-admins', name: 'admins' }],
    users: [
      {
        pk: 1,
        username: 'alice',
        email: 'alice@example.com',
        name: 'Alice Smith',
        is_active: true,
        groups: ['admins'],
        password: djangoPbkdf2Hash('CorrectHorseBatteryStaple1'),
      },
      {
        pk: 2,
        username: 'bob',
        email: 'bob@example.com',
        is_active: false,
        password: 'scrypt$16384$8$1$salt$hash',
      },
      {
        pk: 3,
        username: 'carol',
        groups: ['nonexistent-group'],
      },
    ],
    providers: [
      {
        pk: 1,
        name: 'SPA App',
        client_id: 'spa-app',
        client_type: 'public',
        redirect_uris: ['http://localhost:3000/callback'],
      },
    ],
    sources: [
      {
        pk: 1,
        name: 'corp-oidc',
        provider_type: 'openidconnect',
        authorization_url: 'https://idp.example.com/authorize',
        access_token_url: 'https://idp.example.com/token',
        consumer_key: 'idp-client',
        consumer_secret: 'idp-secret',
      },
      {
        pk: 2,
        name: 'corp-saml',
        provider_type: 'saml',
      },
    ],
  };

  beforeEach(async () => {
    prisma = {
      realm: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'realm-1', name: 'test' }),
      },
      group: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'g-1' }),
      },
      client: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'c-1' }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'u-1' }),
      },
      userGroup: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      customAttribute: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      identityProvider: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'idp-1' }),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        AuthentikImporterService,
        { provide: PrismaService, useValue: prisma },
        CryptoService,
      ],
    }).compile();

    service = module.get(AuthentikImporterService);
  });

  it('should fail if realm does not exist', async () => {
    prisma.realm.findUnique.mockResolvedValue(null);
    const report = await service.importData(mockExport, {
      dryRun: false,
      targetRealm: 'nonexistent',
    });
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].error).toContain('does not exist');
  });

  it('should import groups before users, then create user records', async () => {
    const report = await service.importData(mockExport, {
      dryRun: false,
      targetRealm: 'test',
    });
    expect(report.summary.groups.created).toBe(1);
    expect(report.summary.users.created).toBe(3);
    expect(prisma.group.create).toHaveBeenCalledWith({
      data: { realmId: 'realm-1', name: 'admins' },
    });
  });

  it('should translate a Django pbkdf2_sha256 hash into a form the login fallback can verify', async () => {
    await service.importData(mockExport, {
      dryRun: false,
      targetRealm: 'test',
    });

    const aliceCall = prisma.user.create.mock.calls.find(
      (c: any) => c[0].data.username === 'alice',
    );
    expect(aliceCall[0].data.passwordAlgorithm).toBe('pbkdf2-sha256');

    // The transformed hash must actually verify against the real password —
    // not just "some string", since a wrong transform fails silently at login.
    const stored = parsePbkdf2(aliceCall[0].data.passwordHash);
    expect(stored).toMatchObject({ digest: 'sha256', iterations: 260000 });
    await expect(
      verifyPbkdf2('CorrectHorseBatteryStaple1', stored!),
    ).resolves.toBe(true);
    await expect(verifyPbkdf2('wrong-example', stored!)).resolves.toBe(false);
  });

  it('should drop unsupported password hashers with a null hash', async () => {
    const report = await service.importData(mockExport, {
      dryRun: false,
      targetRealm: 'test',
    });

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          username: 'bob',
          passwordHash: null,
          passwordAlgorithm: 'argon2',
          enabled: false,
        }),
      }),
    );
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity: 'user',
          message: expect.stringMatching(/^User 'bob': .*not supported/),
        }),
      ]),
    );
  });

  it('should translate a Django argon2 hash into standard PHC format', async () => {
    const realPhc = await argon2.hash('MyRealPassword1', {
      type: argon2.argon2id,
    });
    const exportWithArgon2: AuthentikExport = {
      users: [
        {
          pk: 9,
          username: 'dave',
          password: `argon2${realPhc}`,
        },
      ],
    };

    await service.importData(exportWithArgon2, {
      dryRun: false,
      targetRealm: 'test',
    });

    const daveCall = prisma.user.create.mock.calls.find(
      (c: any) => c[0].data.username === 'dave',
    );
    expect(daveCall[0].data.passwordAlgorithm).toBe('argon2');
    expect(daveCall[0].data.passwordHash).toBe(realPhc);
    await expect(
      argon2.verify(daveCall[0].data.passwordHash, 'MyRealPassword1'),
    ).resolves.toBe(true);
  });

  it('should assign known group memberships and warn about unknown ones', async () => {
    const report = await service.importData(mockExport, {
      dryRun: false,
      targetRealm: 'test',
    });

    expect(prisma.userGroup.createMany).toHaveBeenCalledWith({
      data: [{ userId: 'u-1', groupId: 'g-1' }],
      skipDuplicates: true,
    });
    expect(
      report.warnings.some((w) =>
        w.message.includes("references group 'nonexistent-group'"),
      ),
    ).toBe(true);
  });

  it('should import public OAuth2 providers as public clients', async () => {
    await service.importData(mockExport, {
      dryRun: false,
      targetRealm: 'test',
    });

    expect(prisma.client.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clientId: 'spa-app',
        clientType: 'PUBLIC',
        redirectUris: ['http://localhost:3000/callback'],
      }),
    });
  });

  it('stores a confidential provider secret hashed, never as plaintext', async () => {
    await service.importData(
      {
        ...mockExport,
        providers: [
          {
            pk: 2,
            name: 'Backend',
            client_id: 'backend',
            client_type: 'confidential',
            client_secret: 'authentik-secret',
            redirect_uris: [],
          },
        ],
      },
      { dryRun: false, targetRealm: 'test' },
    );

    const stored = (prisma.client.create as jest.Mock).mock.calls[0][0].data
      .clientSecret as string;
    expect(stored).not.toBe('authentik-secret');
    const crypto = new CryptoService();
    expect(await crypto.verifySecret(stored, 'authentik-secret')).toEqual({
      valid: true,
    });
  });

  it('should import OIDC sources and skip non-OIDC ones with a warning', async () => {
    const report = await service.importData(mockExport, {
      dryRun: false,
      targetRealm: 'test',
    });

    expect(report.summary.identityProviders.created).toBe(1);
    expect(prisma.identityProvider.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        alias: 'corp-oidc',
        clientId: 'idp-client',
      }),
    });
    expect(
      report.warnings.some((w) =>
        w.message.includes("Identity provider 'corp-saml' was not imported"),
      ),
    ).toBe(true);
  });

  it('should not write anything during a dry run', async () => {
    const report = await service.importData(mockExport, {
      dryRun: true,
      targetRealm: 'test',
    });

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.group.create).not.toHaveBeenCalled();
    expect(prisma.client.create).not.toHaveBeenCalled();
    expect(prisma.identityProvider.create).not.toHaveBeenCalled();
    expect(prisma.userGroup.createMany).not.toHaveBeenCalled();
    expect(report.summary.users.created).toBe(3);
  });

  describe('Authentik API shapes and report entries', () => {
    const run = (data: unknown, dryRun = false) =>
      service.importData(data as AuthentikExport, {
        dryRun,
        targetRealm: 'test',
      });
    const warnings = (report: { warnings: { message: string }[] }) =>
      report.warnings.map((w) => w.message);
    const createdUser = (username: string) =>
      prisma.user.create.mock.calls.find(
        (c: any) => c[0].data.username === username,
      )?.[0].data;

    it('accepts whole paginated API responses and unwraps their results', async () => {
      const report = await run({
        users: {
          pagination: { next: 0, count: 1 },
          results: [{ pk: 1, username: 'erin' }],
        },
        groups: { pagination: {}, results: [{ pk: 'g', name: 'staff' }] },
      });
      expect(report.summary.users.created).toBe(1);
      expect(report.summary.groups.created).toBe(1);
    });

    it('stores an empty e-mail address as null', async () => {
      await run({
        users: [
          { pk: 1, username: 'a', email: '' },
          { pk: 2, username: 'b', email: '  ' },
        ],
      });
      expect(createdUser('a').email).toBeNull();
      expect(createdUser('b').email).toBeNull();
    });

    it.each([false, true])(
      'imports a user whose e-mail is taken without it, with a warning (dryRun=%s)',
      async (dryRun) => {
        prisma.user.findFirst.mockImplementation(({ where }: any) =>
          Promise.resolve(
            where.email === 'taken@example.com' ? { username: 'old' } : null,
          ),
        );
        const report = await run(
          {
            users: [
              { pk: 1, username: 'first', email: 'dup@example.com' },
              { pk: 2, username: 'second', email: 'dup@example.com' },
              { pk: 3, username: 'third', email: 'taken@example.com' },
            ],
          },
          dryRun,
        );
        expect(report.summary.users).toEqual({
          created: 3,
          skipped: 0,
          failed: 0,
        });
        expect(warnings(report)).toEqual(
          expect.arrayContaining([
            expect.stringContaining(
              "User 'second': e-mail address dup@example.com already belongs to user 'first'",
            ),
            expect.stringContaining(
              "User 'third': e-mail address taken@example.com already belongs to user 'old'",
            ),
          ]),
        );
        if (!dryRun) {
          expect(createdUser('first').email).toBe('dup@example.com');
          expect(createdUser('second').email).toBeNull();
          expect(createdUser('third').email).toBeNull();
        }
      },
    );

    it('skips service accounts and outpost users with a report entry', async () => {
      const report = await run({
        users: [
          {
            pk: 1,
            username: 'ak-outpost-abc',
            type: 'internal_service_account',
          },
          { pk: 2, username: 'ci-bot', type: 'service_account' },
          {
            pk: 3,
            username: 'legacy-bot',
            attributes: { 'goauthentik.io/user/service-account': true },
          },
          { pk: 4, username: 'person', type: 'internal' },
        ],
      });
      expect(report.summary.users).toEqual({
        created: 1,
        skipped: 3,
        failed: 0,
      });
      expect(createdUser('person')).toBeDefined();
      expect(warnings(report)).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^User 'ak-outpost-abc' was not imported/),
          expect.stringMatching(/^User 'ci-bot' was not imported/),
          expect.stringMatching(/^User 'legacy-bot' was not imported/),
        ]),
      );
    });

    it('accepts every redirect_uris shape and skips regex entries with a warning', async () => {
      const report = await run({
        providers: [
          {
            pk: 1,
            name: 'New',
            client_id: 'new',
            client_type: 'public',
            redirect_uris: [
              { matching_mode: 'strict', url: 'https://a.example/cb' },
              { matching_mode: 'regex', url: 'https://.*[.]example/cb' },
            ],
          },
          {
            pk: 2,
            name: 'Old',
            client_id: 'old',
            client_type: 'public',
            redirect_uris: 'https://b.example/cb\nhttps://c.example/cb\n',
          },
          {
            pk: 3,
            name: 'Plain',
            client_id: 'plain',
            client_type: 'public',
            redirect_uris: ['https://d.example/cb'],
          },
        ],
      });
      const uris = (clientId: string) =>
        prisma.client.create.mock.calls.find(
          (c: any) => c[0].data.clientId === clientId,
        )[0].data.redirectUris;
      expect(uris('new')).toEqual(['https://a.example/cb']);
      expect(uris('old')).toEqual([
        'https://b.example/cb',
        'https://c.example/cb',
      ]);
      expect(uris('plain')).toEqual(['https://d.example/cb']);
      expect(warnings(report)).toEqual([
        "Client 'New': redirect URI 'https://.*[.]example/cb' was not imported: it uses regex matching, and Idenplane matches redirect URIs exactly. Add the exact callback URLs to the client.",
      ]);
    });

    it('imports a confidential client without a secret disabled, with a warning', async () => {
      const report = await run({
        providers: [
          {
            pk: 1,
            name: 'Backend',
            client_id: 'backend',
            client_type: 'confidential',
          },
        ],
      });
      expect(prisma.client.create.mock.calls[0][0].data).toMatchObject({
        enabled: false,
        clientSecret: null,
        clientType: 'CONFIDENTIAL',
      });
      expect(warnings(report)).toEqual([
        expect.stringContaining(
          "Client 'Backend' is confidential but has no client secret in the export; it was imported disabled.",
        ),
      ]);
    });

    it('derives the identity provider alias from the slug, else the name, and maps the source URLs', async () => {
      const oidc = {
        provider_type: 'openidconnect',
        authorization_url: 'https://idp.example/authorize',
        access_token_url: 'https://idp.example/token',
        consumer_key: 'k',
        consumer_secret: 's',
      };
      const report = await run({
        sources: [
          {
            ...oidc,
            pk: 'a',
            name: 'Corporate SSO',
            slug: 'corp-sso',
            profile_url: 'https://idp.example/userinfo',
            oidc_jwks_url: 'https://idp.example/jwks',
            oidc_well_known_url:
              'https://idp.example/realms/x/.well-known/openid-configuration',
          },
          { ...oidc, pk: 'b', name: 'Partner Login' },
          { ...oidc, pk: 'c', name: '!!!' },
        ],
      });
      const created = prisma.identityProvider.create.mock.calls.map(
        (c: any) => c[0].data,
      );
      expect(created).toHaveLength(2);
      expect(created[0]).toMatchObject({
        alias: 'corp-sso',
        displayName: 'Corporate SSO',
        userinfoUrl: 'https://idp.example/userinfo',
        jwksUrl: 'https://idp.example/jwks',
        issuer: 'https://idp.example/realms/x',
      });
      expect(created[1]).toMatchObject({
        alias: 'partner-login',
        userinfoUrl: null,
        jwksUrl: null,
        issuer: null,
      });
      expect(report.summary.identityProviders.skipped).toBe(1);
      expect(warnings(report)).toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            /^Identity provider '!!!' was not imported: neither its slug nor its name/,
          ),
        ]),
      );
    });

    it('carries over a Django bcrypt hash', async () => {
      const bcrypt = '$2b$10$' + 'a'.repeat(53);
      await run({
        users: [{ pk: 1, username: 'b', password: `bcrypt$${bcrypt}` }],
      });
      expect(createdUser('b')).toMatchObject({
        passwordHash: bcrypt,
        passwordAlgorithm: 'bcrypt',
      });
    });

    it('resolves memberships by group pk (as the API lists them) or by name', async () => {
      prisma.group.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: `id-${data.name}` }),
      );
      await run({
        groups: [
          { pk: 'uuid-1', name: 'staff' },
          { pk: 'uuid-2', name: 'ops' },
        ],
        users: [{ pk: 1, username: 'u', groups: ['uuid-1', 'ops'] }],
      });
      expect(prisma.userGroup.createMany).toHaveBeenCalledWith({
        data: [
          { userId: 'u-1', groupId: 'id-staff' },
          { userId: 'u-1', groupId: 'id-ops' },
        ],
        skipDuplicates: true,
      });
    });

    it('does not count a created user as failed when a membership fails', async () => {
      prisma.userGroup.createMany.mockRejectedValue(new Error('db down'));
      const report = await run({
        groups: [{ pk: 'g', name: 'staff' }],
        users: [{ pk: 1, username: 'u', groups: ['g'] }],
      });
      expect(report.summary.users).toEqual({
        created: 1,
        skipped: 0,
        failed: 0,
      });
      expect(report.errors).toEqual([
        {
          entity: 'group_membership',
          name: 'u',
          error: 'Group memberships not added: db down',
        },
      ]);
    });

    it('adds missing memberships to a user that already exists, and only adds', async () => {
      prisma.user.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(where.username === 'u' ? { id: 'existing-u' } : null),
      );
      prisma.group.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: `id-${data.name}` }),
      );
      prisma.userGroup.findMany.mockResolvedValue([{ groupId: 'id-staff' }]);
      const report = await run({
        groups: [
          { pk: 'g1', name: 'staff' },
          { pk: 'g2', name: 'ops' },
        ],
        users: [{ pk: 1, username: 'u', groups: ['g1', 'g2'] }],
      });
      expect(report.summary.users.skipped).toBe(1);
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.userGroup.createMany).toHaveBeenCalledWith({
        data: [{ userId: 'existing-u', groupId: 'id-ops' }],
        skipDuplicates: true,
      });
      expect(warnings(report)).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            "User 'u' already existed and was not changed, except: added 1 group membership(s)",
          ),
        ]),
      );
    });

    it('imports sub-groups under their parent, parents first', async () => {
      prisma.group.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: `id-${data.name}` }),
      );
      const report = await run({
        groups: [
          { pk: 'child', name: 'backend', parent: 'root' },
          { pk: 'root', name: 'engineering', parent: null },
          { pk: 'orphan', name: 'lost', parent: 'missing' },
        ],
      });
      const calls = prisma.group.create.mock.calls.map((c: any) => c[0].data);
      expect(calls).toEqual([
        { realmId: 'realm-1', name: 'engineering' },
        { realmId: 'realm-1', name: 'backend', parentId: 'id-engineering' },
        { realmId: 'realm-1', name: 'lost' },
      ]);
      expect(warnings(report)).toEqual([
        "Group 'lost': its parent group (pk missing) is not in the export, so it was imported as a top-level group.",
      ]);
    });

    it('reports what it cannot import: group roles, superuser flag, attributes, MFA devices, source links', async () => {
      prisma.customAttribute.findMany.mockResolvedValue([
        {
          id: 'attr-dept',
          name: 'department',
          displayName: 'Department',
          type: 'text',
          options: null,
        },
        {
          id: 'attr-age',
          name: 'age',
          displayName: 'Age',
          type: 'number',
          options: null,
        },
        {
          id: 'attr-settings',
          name: 'settings',
          displayName: 'Settings',
          type: 'text',
          options: null,
        },
      ]);
      const report = await run({
        groups: [
          {
            pk: 'g',
            name: 'admins',
            is_superuser: true,
            roles: ['r1'],
            attributes: { color: 'red' },
          },
        ],
        users: [
          {
            pk: 1,
            username: 'u',
            attributes: {
              department: 'Sales',
              age: 'not-a-number',
              settings: { theme: 'dark' },
              nickname: 'Bo',
            },
          },
        ],
        sources: [
          {
            pk: 's',
            name: 'sso',
            slug: 'sso',
            provider_type: 'openidconnect',
            authorization_url: 'https://idp.example/authorize',
            access_token_url: 'https://idp.example/token',
            consumer_key: 'k',
            consumer_secret: 's',
          },
        ],
      });
      expect(createdUser('u').attributes).toEqual({
        create: [{ attributeId: 'attr-dept', value: 'Sales' }],
      });
      expect(warnings(report)).toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            /^Group 'admins': not imported: is_superuser .*1 RBAC role\(s\).*attributes 'color'/,
          ),
          expect.stringMatching(
            /^User 'u': attributes not imported: 'age' \('Age' must be a number\), 'settings' \(not a single value\), 'nickname' \(no custom attribute/,
          ),
          expect.stringMatching(/^MFA devices .* were not imported/),
          expect.stringMatching(
            /^Links between users and their source accounts/,
          ),
        ]),
      );
    });
  });
});
