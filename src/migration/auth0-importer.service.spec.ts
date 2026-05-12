import { Test } from '@nestjs/testing';
import { Auth0ImporterService } from './auth0-importer.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import type { Auth0Export } from './auth0-types.js';

describe('Auth0ImporterService', () => {
  let service: Auth0ImporterService;
  let prisma: any;

  const mockAuth0Export: Auth0Export = {
    users: [
      {
        user_id: 'auth0|123',
        email: 'alice@example.com',
        email_verified: true,
        given_name: 'Alice',
        family_name: 'Smith',
        password_hash:
          '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01',
      },
      {
        user_id: 'auth0|456',
        email: 'bob@example.com',
        blocked: true,
      },
    ],
    clients: [
      {
        client_id: 'spa-app',
        name: 'SPA App',
        callbacks: ['http://localhost:3000/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_method: 'none',
      },
      {
        client_id: 'api-service',
        name: 'API Service',
        client_secret: 'super-secret',
        grant_types: ['client_credentials'],
      },
      {
        client_id: 'device-app',
        name: 'Device App',
        grant_types: ['urn:ietf:params:oauth:grant-type:device_code'],
        token_endpoint_auth_method: 'none',
      },
    ],
    roles: [
      { name: 'admin', description: 'Admin role' },
      { name: 'viewer', description: 'Viewer role' },
    ],
    connections: [
      { name: 'Username-Password-Authentication', strategy: 'auth0' },
      {
        name: 'google-social',
        strategy: 'google-oauth2',
        options: { client_id: 'goog-id', client_secret: 'goog-secret' },
      },
    ],
    organizations: [{ name: 'acme-corp', display_name: 'ACME Corp' }],
  };

  beforeEach(async () => {
    prisma = {
      realm: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'realm-1', name: 'test' }),
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
        Auth0ImporterService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: CryptoService,
          useValue: { hashPassword: jest.fn().mockResolvedValue('hashed') },
        },
      ],
    }).compile();

    service = module.get(Auth0ImporterService);
  });

  it('should fail if realm does not exist', async () => {
    prisma.realm.findUnique.mockResolvedValue(null);
    const report = await service.importData(mockAuth0Export, {
      dryRun: false,
      targetRealm: 'nonexistent',
    });
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].error).toContain('does not exist');
  });

  it('should import users with bcrypt password hash', async () => {
    const report = await service.importData(mockAuth0Export, {
      dryRun: false,
      targetRealm: 'test',
    });
    expect(report.summary.users.created).toBe(2);
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          username: 'alice@example.com',
          passwordAlgorithm: 'bcrypt',
          enabled: true,
        }),
      }),
    );
    // Bob is blocked
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          username: 'bob@example.com',
          enabled: false,
        }),
      }),
    );
  });

  it('should import clients with correct types', async () => {
    const report = await service.importData(mockAuth0Export, {
      dryRun: false,
      targetRealm: 'test',
    });
    expect(report.summary.clients.created).toBe(3);
    // SPA is public
    expect(prisma.client.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'spa-app',
          clientType: 'PUBLIC',
        }),
      }),
    );
    // API service is confidential
    expect(prisma.client.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'api-service',
          clientType: 'CONFIDENTIAL',
        }),
      }),
    );
    // Device app has the full URN grant type so auth service validation passes
    expect(prisma.client.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'device-app',
          grantTypes: ['urn:ietf:params:oauth:grant-type:device_code'],
        }),
      }),
    );
  });

  it('should map device_code grant type to the full URN used internally', async () => {
    await service.importData(mockAuth0Export, {
      dryRun: false,
      targetRealm: 'test',
    });
    const deviceAppCall = prisma.client.create.mock.calls.find(
      (call: any[]) => call[0].data.clientId === 'device-app',
    );
    expect(deviceAppCall).toBeDefined();
    expect(deviceAppCall[0].data.grantTypes).toContain(
      'urn:ietf:params:oauth:grant-type:device_code',
    );
    expect(deviceAppCall[0].data.grantTypes).not.toContain('device_code');
  });

  it('should import roles', async () => {
    const report = await service.importData(mockAuth0Export, {
      dryRun: false,
      targetRealm: 'test',
    });
    expect(report.summary.roles.created).toBe(2);
  });

  it('should skip auth0 database connections and import social', async () => {
    const report = await service.importData(mockAuth0Export, {
      dryRun: false,
      targetRealm: 'test',
    });
    expect(report.summary.identityProviders.created).toBe(1);
    expect(
      report.warnings.some((w) => w.message.includes('Database connection')),
    ).toBe(true);
  });

  it('should warn about organizations', async () => {
    const report = await service.importData(mockAuth0Export, {
      dryRun: false,
      targetRealm: 'test',
    });
    expect(report.warnings.some((w) => w.entity === 'organizations')).toBe(
      true,
    );
  });

  it('should work in dry-run mode', async () => {
    const report = await service.importData(mockAuth0Export, {
      dryRun: true,
      targetRealm: 'test',
    });
    expect(report.dryRun).toBe(true);
    expect(report.summary.users.created).toBe(2);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('should skip duplicate users', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'existing' });
    const report = await service.importData(mockAuth0Export, {
      dryRun: false,
      targetRealm: 'test',
    });
    expect(report.summary.users.skipped).toBe(2);
  });
});
