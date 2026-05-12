import { Test } from '@nestjs/testing';
import { KeycloakImporterService } from './keycloak-importer.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import type { KeycloakRealmExport } from './keycloak-types.js';

describe('KeycloakImporterService', () => {
  let service: KeycloakImporterService;
  let prisma: any;

  const mockKeycloakExport: KeycloakRealmExport = {
    realm: 'test-kc-realm',
    displayName: 'Test KC Realm',
    enabled: true,
    registrationAllowed: true,
    accessTokenLifespan: 600,
    ssoSessionMaxLifespan: 3600,
    smtpServer: {
      host: 'smtp.example.com',
      port: '587',
      from: 'noreply@example.com',
    },
    bruteForceProtected: true,
    failureFactor: 10,
    users: [
      {
        username: 'john',
        email: 'john@example.com',
        firstName: 'John',
        lastName: 'Doe',
        enabled: true,
        emailVerified: true,
        credentials: [
          {
            type: 'password',
            hashedSaltedValue: 'abc123',
            salt: 'c2FsdA==',
            hashIterations: 27500,
          },
        ],
        realmRoles: ['user'],
      },
      {
        username: 'jane',
        email: 'jane@example.com',
        enabled: true,
        credentials: [],
      },
    ],
    clients: [
      {
        clientId: 'my-app',
        name: 'My App',
        enabled: true,
        publicClient: true,
        redirectUris: ['http://localhost:3000/callback'],
        standardFlowEnabled: true,
      },
      { clientId: 'account', enabled: true }, // Built-in, should be skipped
    ],
    roles: {
      realm: [
        { name: 'admin', description: 'Admin role' },
        { name: 'user', description: 'User role' },
        { name: 'offline_access' }, // Built-in, should be skipped
      ],
    },
    groups: [
      {
        name: 'Engineering',
        subGroups: [{ name: 'Frontend' }, { name: 'Backend' }],
      },
    ],
    clientScopes: [
      {
        name: 'custom-scope',
        description: 'A custom scope',
        protocol: 'openid-connect',
      },
    ],
    identityProviders: [
      {
        alias: 'google',
        providerId: 'google',
        enabled: true,
        config: { clientId: 'goog-123', clientSecret: 'secret' },
      },
    ],
  };

  beforeEach(async () => {
    prisma = {
      realm: { findUnique: jest.fn(), create: jest.fn() },
      role: { findFirst: jest.fn(), create: jest.fn() },
      group: { findFirst: jest.fn(), create: jest.fn() },
      clientScope: { findFirst: jest.fn(), create: jest.fn() },
      client: { findFirst: jest.fn(), create: jest.fn() },
      user: { findFirst: jest.fn(), create: jest.fn() },
      userRole: { create: jest.fn() },
      identityProvider: { findFirst: jest.fn(), create: jest.fn() },
      // $transaction executes the callback synchronously with `prisma` itself
      // as the transaction client so that all mocks remain reachable.
      $transaction: jest
        .fn()
        .mockImplementation((cb: (tx: any) => Promise<any>) => cb(prisma)),
    };

    const module = await Test.createTestingModule({
      providers: [
        KeycloakImporterService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: CryptoService,
          useValue: {
            hashPassword: jest.fn().mockResolvedValue('hashed'),
            generateSecret: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(KeycloakImporterService);
  });

  describe('dry run', () => {
    it('should count entities without creating them', async () => {
      prisma.realm.findUnique.mockResolvedValue(null);
      prisma.role.findFirst.mockResolvedValue(null);
      prisma.group.findFirst.mockResolvedValue(null);
      prisma.clientScope.findFirst.mockResolvedValue(null);
      prisma.client.findFirst.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.identityProvider.findFirst.mockResolvedValue(null);

      const report = await service.importRealm(mockKeycloakExport, {
        dryRun: true,
      });

      expect(report.dryRun).toBe(true);
      expect(report.summary.realms.created).toBe(1);
      expect(report.summary.users.created).toBe(2);
      expect(report.summary.clients.created).toBe(1); // 'account' skipped
      expect(report.summary.roles.created).toBe(2); // 'offline_access' skipped
      expect(report.summary.groups.created).toBe(3); // Engineering + Frontend + Backend
      expect(report.summary.scopes.created).toBe(1);
      expect(report.summary.identityProviders.created).toBe(1);
      expect(prisma.realm.create).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('actual import', () => {
    beforeEach(() => {
      prisma.realm.findUnique.mockResolvedValue(null);
      prisma.realm.create.mockResolvedValue({ id: 'realm-1' });
      prisma.role.findFirst.mockResolvedValue(null);
      prisma.role.create.mockResolvedValue({ id: 'role-1' });
      prisma.group.findFirst.mockResolvedValue(null);
      prisma.group.create.mockResolvedValue({ id: 'group-1' });
      prisma.clientScope.findFirst.mockResolvedValue(null);
      prisma.clientScope.create.mockResolvedValue({ id: 'scope-1' });
      prisma.client.findFirst.mockResolvedValue(null);
      prisma.client.create.mockResolvedValue({ id: 'client-1' });
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'user-1' });
      prisma.userRole.create.mockResolvedValue({});
      prisma.identityProvider.findFirst.mockResolvedValue(null);
      prisma.identityProvider.create.mockResolvedValue({ id: 'idp-1' });
    });

    it('should create realm with mapped settings', async () => {
      const report = await service.importRealm(mockKeycloakExport, {
        dryRun: false,
      });
      expect(prisma.realm.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'test-kc-realm',
            displayName: 'Test KC Realm',
            accessTokenLifespan: 600,
            smtpHost: 'smtp.example.com',
            bruteForceEnabled: true,
            maxLoginFailures: 10,
          }),
        }),
      );
      expect(report.summary.realms.created).toBe(1);
    });

    it('should use targetRealm if provided', async () => {
      await service.importRealm(mockKeycloakExport, {
        dryRun: false,
        targetRealm: 'custom-name',
      });
      expect(prisma.realm.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'custom-name' }),
        }),
      );
    });

    it('should skip existing realm and use its ID', async () => {
      prisma.realm.findUnique.mockResolvedValue({ id: 'existing-realm' });
      const report = await service.importRealm(mockKeycloakExport, {
        dryRun: false,
      });
      expect(report.summary.realms.skipped).toBe(1);
      expect(prisma.realm.create).not.toHaveBeenCalled();
    });

    it('should skip Keycloak built-in clients', async () => {
      const report = await service.importRealm(mockKeycloakExport, {
        dryRun: false,
      });
      expect(report.summary.clients.created).toBe(1);
    });

    it('should skip Keycloak built-in roles', async () => {
      const report = await service.importRealm(mockKeycloakExport, {
        dryRun: false,
      });
      expect(report.summary.roles.created).toBe(2);
    });

    it('should import users with PBKDF2 password hash', async () => {
      await service.importRealm(mockKeycloakExport, { dryRun: false });
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            username: 'john',
            passwordAlgorithm: 'pbkdf2-sha256',
          }),
        }),
      );
    });

    it('should import groups with hierarchy', async () => {
      const report = await service.importRealm(mockKeycloakExport, {
        dryRun: false,
      });
      expect(report.summary.groups.created).toBe(3);
      expect(prisma.group.create).toHaveBeenCalledTimes(3);
    });

    it('should handle errors gracefully per entity', async () => {
      prisma.user.create.mockRejectedValueOnce(new Error('DB constraint'));
      const report = await service.importRealm(mockKeycloakExport, {
        dryRun: false,
      });
      expect(report.summary.users.failed).toBe(1);
      expect(report.summary.users.created).toBe(1);
      expect(report.errors).toHaveLength(1);
    });

    it('should skip duplicate entities', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'existing' });
      const report = await service.importRealm(mockKeycloakExport, {
        dryRun: false,
      });
      expect(report.summary.users.skipped).toBe(2);
      expect(report.summary.users.created).toBe(0);
    });
  });
});
