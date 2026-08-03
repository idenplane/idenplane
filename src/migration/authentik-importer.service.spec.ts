import { Test } from '@nestjs/testing';
import { pbkdf2Sync } from 'crypto';
import * as argon2 from 'argon2';
import { AuthentikImporterService } from './authentik-importer.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
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
    groups: [{ pk: 1, name: 'admins' }],
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
        password: 'bcrypt$2b$10$something-not-supported',
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
        findUnique: jest.fn().mockResolvedValue({ id: 'realm-1', name: 'test' }),
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
        create: jest.fn().mockResolvedValue({ id: 'ug-1' }),
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
    await service.importData(mockExport, { dryRun: false, targetRealm: 'test' });

    const aliceCall = prisma.user.create.mock.calls.find(
      (c: any) => c[0].data.username === 'alice',
    );
    expect(aliceCall[0].data.passwordAlgorithm).toBe('pbkdf2-sha256');

    // The transformed hash must actually verify against the real password —
    // not just "some string", since a wrong transform fails silently at login.
    const [iterations, saltB64, hashB64] = aliceCall[0].data.passwordHash.split('$');
    const salt = Buffer.from(saltB64, 'base64');
    const derived = pbkdf2Sync(
      'CorrectHorseBatteryStaple1',
      salt,
      parseInt(iterations, 10),
      32,
      'sha256',
    );
    expect(derived.toString('base64')).toBe(hashB64);
  });

  it('should drop unsupported password hashers with a null hash', async () => {
    await service.importData(mockExport, { dryRun: false, targetRealm: 'test' });

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
  });

  it('should translate a Django argon2 hash into standard PHC format', async () => {
    const realPhc = await argon2.hash('MyRealPassword1', { type: argon2.argon2id });
    const exportWithArgon2: AuthentikExport = {
      users: [
        {
          pk: 9,
          username: 'dave',
          password: `argon2${realPhc}`,
        },
      ],
    };

    await service.importData(exportWithArgon2, { dryRun: false, targetRealm: 'test' });

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

    expect(prisma.userGroup.create).toHaveBeenCalledWith({
      data: { userId: 'u-1', groupId: 'g-1' },
    });
    expect(
      report.warnings.some((w) =>
        w.message.includes("references group 'nonexistent-group'"),
      ),
    ).toBe(true);
  });

  it('should import public OAuth2 providers as public clients', async () => {
    await service.importData(mockExport, { dryRun: false, targetRealm: 'test' });

    expect(prisma.client.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clientId: 'spa-app',
        clientType: 'PUBLIC',
        redirectUris: ['http://localhost:3000/callback'],
      }),
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
      report.warnings.some((w) => w.message.includes("Source 'corp-saml'")),
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
    expect(prisma.userGroup.create).not.toHaveBeenCalled();
    expect(report.summary.users.created).toBe(3);
  });
});
