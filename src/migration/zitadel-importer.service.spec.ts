import { Test } from '@nestjs/testing';
import { ZitadelImporterService } from './zitadel-importer.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ZitadelExport } from './zitadel-types.js';

describe('ZitadelImporterService', () => {
  let service: ZitadelImporterService;
  let prisma: any;

  const mockZitadelExport: ZitadelExport = {
    users: [
      {
        userId: 'user-1',
        username: 'alice',
        state: 'USER_STATE_ACTIVE',
        human: {
          profile: { givenName: 'Alice', familyName: 'Smith' },
          email: { email: 'alice@example.com', isVerified: true },
          hashedPassword: { hash: '$2b$10$abcdefg', algorithm: 'bcrypt' },
        },
      },
      {
        userId: 'user-2',
        username: 'bob',
        state: 'USER_STATE_INACTIVE',
        human: {
          email: { email: 'bob@example.com' },
        },
      },
      {
        userId: 'user-3',
        machine: { name: 'ci-bot' },
      },
    ],
    projects: [
      {
        projectId: 'proj-1',
        name: 'My Project',
        roles: [
          { key: 'admin', displayName: 'Admin' },
          { key: 'viewer', displayName: 'Viewer' },
        ],
        apps: [
          {
            appId: 'app-1',
            name: 'SPA App',
            oidcConfig: {
              clientId: 'spa-app',
              redirectUris: ['http://localhost:3000/callback'],
              authMethodType: 'OIDC_AUTH_METHOD_TYPE_NONE',
              grantTypes: [
                'OIDC_GRANT_TYPE_AUTHORIZATION_CODE',
                'OIDC_GRANT_TYPE_REFRESH_TOKEN',
              ],
            },
          },
          {
            appId: 'app-2',
            name: 'SAML App',
            samlConfig: {},
          },
        ],
      },
    ],
    idps: [
      {
        idpId: 'idp-1',
        name: 'corp-oidc',
        type: 'IDP_TYPE_OIDC',
        oidcConfig: {
          issuer: 'https://idp.example.com',
          clientId: 'idp-client',
          clientSecret: 'idp-secret',
          authorizationEndpoint: 'https://idp.example.com/authorize',
          tokenEndpoint: 'https://idp.example.com/token',
        },
      },
      {
        idpId: 'idp-2',
        name: 'corp-google',
        type: 'IDP_TYPE_GOOGLE',
      },
    ],
  };

  beforeEach(async () => {
    prisma = {
      realm: {
        findUnique: jest.fn().mockResolvedValue({ id: 'realm-1', name: 'test' }),
      },
      role: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'r-1' }),
      },
      client: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'c-1' }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'u-1' }),
      },
      identityProvider: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'idp-1' }),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        ZitadelImporterService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(ZitadelImporterService);
  });

  it('should fail if realm does not exist', async () => {
    prisma.realm.findUnique.mockResolvedValue(null);
    const report = await service.importData(mockZitadelExport, {
      dryRun: false,
      targetRealm: 'nonexistent',
    });
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].error).toContain('does not exist');
  });

  it('should import human users and skip machine users with a warning', async () => {
    const report = await service.importData(mockZitadelExport, {
      dryRun: false,
      targetRealm: 'test',
    });
    expect(report.summary.users.created).toBe(2);
    expect(
      report.warnings.some((w) => w.message.includes("Machine user 'ci-bot'")),
    ).toBe(true);
  });

  it('should import bcrypt password hashes and default others to argon2 with no hash', async () => {
    await service.importData(mockZitadelExport, {
      dryRun: false,
      targetRealm: 'test',
    });
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          username: 'alice',
          passwordHash: '$2b$10$abcdefg',
          passwordAlgorithm: 'bcrypt',
        }),
      }),
    );
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

  it('should import project roles', async () => {
    const report = await service.importData(mockZitadelExport, {
      dryRun: false,
      targetRealm: 'test',
    });
    expect(report.summary.roles.created).toBe(2);
    expect(prisma.role.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'admin', description: 'Admin' }),
      }),
    );
  });

  it('should import OIDC apps and skip SAML apps with a warning', async () => {
    const report = await service.importData(mockZitadelExport, {
      dryRun: false,
      targetRealm: 'test',
    });
    expect(report.summary.clients.created).toBe(1);
    expect(prisma.client.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'spa-app',
          clientType: 'PUBLIC',
          grantTypes: ['authorization_code', 'refresh_token'],
        }),
      }),
    );
    expect(
      report.warnings.some((w) => w.message.includes("App 'SAML App'")),
    ).toBe(true);
  });

  it('should import generic OIDC IdPs and skip non-OIDC IdPs with a warning', async () => {
    const report = await service.importData(mockZitadelExport, {
      dryRun: false,
      targetRealm: 'test',
    });
    expect(report.summary.identityProviders.created).toBe(1);
    expect(prisma.identityProvider.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          alias: 'corp-oidc',
          providerType: 'OIDC',
          clientId: 'idp-client',
        }),
      }),
    );
    expect(
      report.warnings.some((w) => w.message.includes("IdP 'corp-google'")),
    ).toBe(true);
  });

  it('should work in dry-run mode without writing anything', async () => {
    const report = await service.importData(mockZitadelExport, {
      dryRun: true,
      targetRealm: 'test',
    });
    expect(report.dryRun).toBe(true);
    expect(report.summary.users.created).toBe(2);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.client.create).not.toHaveBeenCalled();
    expect(prisma.role.create).not.toHaveBeenCalled();
    expect(prisma.identityProvider.create).not.toHaveBeenCalled();
  });

  it('should skip duplicate users, clients, roles, and IdPs', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'existing' });
    prisma.client.findFirst.mockResolvedValue({ id: 'existing' });
    prisma.role.findFirst.mockResolvedValue({ id: 'existing' });
    prisma.identityProvider.findFirst.mockResolvedValue({ id: 'existing' });

    const report = await service.importData(mockZitadelExport, {
      dryRun: false,
      targetRealm: 'test',
    });

    expect(report.summary.users.skipped).toBe(2);
    expect(report.summary.clients.skipped).toBe(1);
    expect(report.summary.roles.skipped).toBe(2);
    expect(report.summary.identityProviders.skipped).toBe(1);
  });
});
