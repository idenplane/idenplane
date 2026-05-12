import { ConflictException, NotFoundException } from '@nestjs/common';

// Mock JwkService module to avoid importing jose (ESM-only)
jest.mock('../crypto/jwk.service.js', () => ({
  JwkService: jest.fn(),
}));

import { RealmsService } from './realms.service.js';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../prisma/prisma.mock.js';

function createMockCacheService() {
  return {
    getCachedClientConfig: jest.fn().mockResolvedValue(null),
    cacheClientConfig: jest.fn().mockResolvedValue(undefined),
    invalidateClientCache: jest.fn().mockResolvedValue(undefined),
    getCachedRealmConfig: jest.fn().mockResolvedValue(null),
    cacheRealmConfig: jest.fn().mockResolvedValue(undefined),
    invalidateRealmCache: jest.fn().mockResolvedValue(undefined),
    getCachedRealmByName: jest.fn().mockResolvedValue(null),
    cacheRealmByName: jest.fn().mockResolvedValue(undefined),
    getCachedJWKS: jest.fn().mockResolvedValue(null),
    cacheJWKS: jest.fn().mockResolvedValue(undefined),
  };
}

function createMockThemeService() {
  return {
    getAvailableThemes: jest.fn().mockReturnValue([]),
    getTheme: jest.fn().mockReturnValue(null),
  };
}

describe('RealmsService', () => {
  let service: RealmsService;
  let prisma: MockPrismaService;
  let jwkService: { generateRsaKeyPair: jest.Mock };
  let cacheService: ReturnType<typeof createMockCacheService>;
  let themeService: ReturnType<typeof createMockThemeService>;

  const mockRealm = {
    id: 'realm-1',
    name: 'test-realm',
    displayName: 'Test Realm',
    enabled: true,
    accessTokenLifespan: 300,
    refreshTokenLifespan: 1800,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockKeyPair = {
    kid: 'kid-1',
    publicKeyPem: '-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----',
    privateKeyPem:
      '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----',
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    jwkService = {
      generateRsaKeyPair: jest.fn(),
    };
    cacheService = createMockCacheService();
    themeService = createMockThemeService();
    const scopeSeedService = {
      seedDefaultScopes: jest.fn().mockResolvedValue(undefined),
      getDefaultScopeNames: jest
        .fn()
        .mockReturnValue(['openid', 'profile', 'email', 'roles']),
      getOptionalScopeNames: jest
        .fn()
        .mockReturnValue(['web-origins', 'offline_access']),
    };
    service = new RealmsService(
      prisma as any,
      jwkService as any,
      scopeSeedService as any,
      themeService as any,
      cacheService as any,
    );
  });

  describe('create', () => {
    it('should create a realm with a signing key', async () => {
      prisma.realm.findUnique.mockResolvedValue(null);
      jwkService.generateRsaKeyPair.mockResolvedValue(mockKeyPair);
      prisma.realm.create.mockResolvedValue(mockRealm);

      const result = await service.create({
        name: 'test-realm',
        displayName: 'Test Realm',
      });

      expect(result).toEqual(mockRealm);
      expect(jwkService.generateRsaKeyPair).toHaveBeenCalled();
      expect(prisma.realm.create).toHaveBeenCalledWith({
        data: {
          name: 'test-realm',
          displayName: 'Test Realm',
          enabled: undefined,
          accessTokenLifespan: undefined,
          refreshTokenLifespan: undefined,
          signingKeys: {
            create: {
              kid: 'kid-1',
              algorithm: 'RS256',
              publicKey: mockKeyPair.publicKeyPem,
              privateKey: mockKeyPair.privateKeyPem,
            },
          },
        },
      });
    });

    it('should throw ConflictException when realm name already exists', async () => {
      prisma.realm.findUnique.mockResolvedValue(mockRealm);

      await expect(service.create({ name: 'test-realm' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('findAll', () => {
    it('should return all realms ordered by createdAt', async () => {
      const realms = [
        mockRealm,
        { ...mockRealm, id: 'realm-2', name: 'other' },
      ];
      prisma.realm.findMany.mockResolvedValue(realms);

      const result = await service.findAll();

      expect(result).toEqual(realms);
      expect(prisma.realm.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'asc' },
      });
    });

    it('should return an empty array when no realms exist', async () => {
      prisma.realm.findMany.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual([]);
    });
  });

  describe('findByName', () => {
    it('should return the realm when found', async () => {
      prisma.realm.findUnique.mockResolvedValue(mockRealm);

      const result = await service.findByName('test-realm');

      expect(result).toEqual(mockRealm);
      expect(prisma.realm.findUnique).toHaveBeenCalledWith({
        where: { name: 'test-realm' },
      });
    });

    it('should throw NotFoundException when realm does not exist', async () => {
      prisma.realm.findUnique.mockResolvedValue(null);

      await expect(service.findByName('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update and return the realm', async () => {
      prisma.realm.findUnique.mockResolvedValue(mockRealm);
      const updatedRealm = { ...mockRealm, displayName: 'Updated Realm' };
      prisma.realm.update.mockResolvedValue(updatedRealm);

      const result = await service.update('test-realm', {
        displayName: 'Updated Realm',
      });

      expect(result).toEqual(updatedRealm);
      expect(prisma.realm.update).toHaveBeenCalledWith({
        where: { name: 'test-realm' },
        data: {
          displayName: 'Updated Realm',
          enabled: undefined,
          accessTokenLifespan: undefined,
          refreshTokenLifespan: undefined,
        },
      });
    });

    it('should throw NotFoundException when realm does not exist', async () => {
      prisma.realm.findUnique.mockResolvedValue(null);

      await expect(
        service.update('nonexistent', { displayName: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should delete the realm', async () => {
      prisma.realm.findUnique.mockResolvedValue(mockRealm);
      prisma.realm.delete.mockResolvedValue(mockRealm);

      const result = await service.remove('test-realm');

      expect(result).toEqual(mockRealm);
      expect(prisma.realm.delete).toHaveBeenCalledWith({
        where: { name: 'test-realm' },
      });
    });

    it('should throw NotFoundException when realm does not exist', async () => {
      prisma.realm.findUnique.mockResolvedValue(null);

      await expect(service.remove('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
