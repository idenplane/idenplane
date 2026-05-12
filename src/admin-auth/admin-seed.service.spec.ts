jest.mock('../crypto/jwk.service.js', () => ({
  JwkService: jest.fn(),
}));

import { AdminSeedService } from './admin-seed.service.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';

describe('AdminSeedService', () => {
  let service: AdminSeedService;
  let prisma: MockPrismaService;
  let crypto: { hashPassword: jest.Mock };
  let jwkService: { generateRsaKeyPair: jest.Mock };
  let config: { get: jest.Mock };
  let scopeSeedService: { seedDefaultScopes: jest.Mock };

  const keyPair = {
    kid: 'kid-1',
    publicKeyPem: '-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----',
    privateKeyPem:
      '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----',
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    crypto = { hashPassword: jest.fn().mockResolvedValue('hashed-password') };
    jwkService = { generateRsaKeyPair: jest.fn().mockResolvedValue(keyPair) };
    config = {
      get: jest.fn((key: string, defaultValue?: string) => {
        if (key === 'ADMIN_USER') return 'admin';
        if (key === 'ADMIN_PASSWORD') return 'admin';
        return defaultValue;
      }),
    };
    scopeSeedService = {
      seedDefaultScopes: jest.fn().mockResolvedValue(undefined),
    };

    service = new AdminSeedService(
      prisma as any,
      crypto as any,
      jwkService as any,
      config as any,
      scopeSeedService as any,
    );
  });

  describe('onApplicationBootstrap', () => {
    it('should skip if master realm already exists', async () => {
      prisma.realm.findUnique.mockResolvedValue({
        id: 'existing',
        name: 'master',
      });

      await service.onApplicationBootstrap();

      expect(prisma.realm.create).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('should create master realm, roles, and admin user when not existing', async () => {
      prisma.realm.findUnique.mockResolvedValue(null);
      prisma.realm.create.mockResolvedValue({
        id: 'new-realm',
        name: 'master',
      });
      prisma.role.create
        .mockResolvedValueOnce({ id: 'role-super', name: 'super-admin' })
        .mockResolvedValueOnce({ id: 'role-realm', name: 'realm-admin' })
        .mockResolvedValueOnce({ id: 'role-view', name: 'view-only' });
      prisma.user.create.mockResolvedValue({ id: 'admin-user' });
      prisma.userRole.create.mockResolvedValue({});

      await service.onApplicationBootstrap();

      expect(prisma.realm.create).toHaveBeenCalledTimes(1);
      expect(prisma.role.create).toHaveBeenCalledTimes(3);
      expect(prisma.user.create).toHaveBeenCalledTimes(1);
      expect(prisma.userRole.create).toHaveBeenCalledWith({
        data: { userId: 'admin-user', roleId: 'role-super' },
      });
      expect(scopeSeedService.seedDefaultScopes).toHaveBeenCalledWith(
        'new-realm',
      );
      expect(crypto.hashPassword).toHaveBeenCalledWith('admin');
    });

    it('should use configured admin credentials', async () => {
      config.get.mockImplementation((key: string) => {
        if (key === 'ADMIN_USER') return 'myadmin';
        if (key === 'ADMIN_PASSWORD') return 'secret123';
        return undefined;
      });

      prisma.realm.findUnique.mockResolvedValue(null);
      prisma.realm.create.mockResolvedValue({
        id: 'new-realm',
        name: 'master',
      });
      prisma.role.create
        .mockResolvedValueOnce({ id: 'role-1', name: 'super-admin' })
        .mockResolvedValueOnce({ id: 'role-2', name: 'realm-admin' })
        .mockResolvedValueOnce({ id: 'role-3', name: 'view-only' });
      prisma.user.create.mockResolvedValue({ id: 'admin-user' });
      prisma.userRole.create.mockResolvedValue({});

      await service.onApplicationBootstrap();

      expect(crypto.hashPassword).toHaveBeenCalledWith('secret123');
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ username: 'myadmin' }),
        }),
      );
    });

    it('should generate RSA key pair for the realm', async () => {
      prisma.realm.findUnique.mockResolvedValue(null);
      prisma.realm.create.mockResolvedValue({
        id: 'new-realm',
        name: 'master',
      });
      prisma.role.create.mockResolvedValue({ id: 'role-1' });
      prisma.user.create.mockResolvedValue({ id: 'admin-user' });
      prisma.userRole.create.mockResolvedValue({});

      await service.onApplicationBootstrap();

      expect(jwkService.generateRsaKeyPair).toHaveBeenCalled();
      expect(prisma.realm.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            signingKeys: {
              create: expect.objectContaining({
                kid: 'kid-1',
                algorithm: 'RS256',
              }),
            },
          }),
        }),
      );
    });
  });
});
