import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ServiceAccountsService } from './service-accounts.service.js';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../prisma/prisma.mock.js';
import type { Realm } from '@prisma/client';

describe('ServiceAccountsService', () => {
  let service: ServiceAccountsService;
  let prisma: MockPrismaService;
  let cryptoService: {
    generateSecret: jest.Mock;
    hashPassword: jest.Mock;
    verifyPassword: jest.Mock;
    sha256: jest.Mock;
  };

  const mockRealm: Realm = {
    id: 'realm-1',
    name: 'test-realm',
    displayName: 'Test Realm',
    enabled: true,
    accessTokenLifespan: 300,
    refreshTokenLifespan: 1800,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Realm;

  const mockServiceAccount = {
    id: 'sa-uuid-1',
    realmId: 'realm-1',
    name: 'my-service',
    description: 'Test service account',
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockApiKey = {
    id: 'key-uuid-1',
    serviceAccountId: 'sa-uuid-1',
    keyPrefix: 'abcd1234',
    keyHash: '$argon2id$hash',
    name: 'test-key',
    scopes: ['read:users'],
    expiresAt: null,
    lastUsedAt: null,
    requestCount: 0,
    revoked: false,
    revokedAt: null,
    createdAt: new Date(),
    serviceAccount: { ...mockServiceAccount },
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    cryptoService = {
      generateSecret: jest.fn(),
      hashPassword: jest.fn(),
      verifyPassword: jest.fn(),
      sha256: jest.fn(),
    };
    service = new ServiceAccountsService(prisma as any, cryptoService as any);
  });

  // ── Service Account CRUD ─────────────────────────────────────────────────

  describe('create', () => {
    it('should create a service account', async () => {
      prisma.serviceAccount.findUnique.mockResolvedValue(null);
      prisma.serviceAccount.create.mockResolvedValue(mockServiceAccount);

      const result = await service.create(mockRealm, {
        name: 'my-service',
        description: 'Test service account',
      });

      expect(result).toEqual(mockServiceAccount);
      expect(prisma.serviceAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            realmId: 'realm-1',
            name: 'my-service',
            description: 'Test service account',
            enabled: true,
          }),
        }),
      );
    });

    it('should default enabled to true when not specified', async () => {
      prisma.serviceAccount.findUnique.mockResolvedValue(null);
      prisma.serviceAccount.create.mockResolvedValue(mockServiceAccount);

      await service.create(mockRealm, { name: 'my-service' });

      expect(prisma.serviceAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ enabled: true }),
        }),
      );
    });

    it('should throw ConflictException when name already exists in realm', async () => {
      prisma.serviceAccount.findUnique.mockResolvedValue(mockServiceAccount);

      await expect(
        service.create(mockRealm, { name: 'my-service' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('should return all service accounts for a realm', async () => {
      prisma.serviceAccount.findMany.mockResolvedValue([mockServiceAccount]);

      const result = await service.findAll(mockRealm);

      expect(result).toEqual([mockServiceAccount]);
      expect(prisma.serviceAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { realmId: 'realm-1' } }),
      );
    });
  });

  describe('findById', () => {
    it('should return service account when found', async () => {
      prisma.serviceAccount.findFirst.mockResolvedValue(mockServiceAccount);

      const result = await service.findById(mockRealm, 'sa-uuid-1');

      expect(result).toEqual(mockServiceAccount);
    });

    it('should throw NotFoundException when not found', async () => {
      prisma.serviceAccount.findFirst.mockResolvedValue(null);

      await expect(service.findById(mockRealm, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update a service account', async () => {
      prisma.serviceAccount.findFirst.mockResolvedValue(mockServiceAccount);
      prisma.serviceAccount.findUnique.mockResolvedValue(null);
      const updated = { ...mockServiceAccount, description: 'Updated' };
      prisma.serviceAccount.update.mockResolvedValue(updated);

      const result = await service.update(mockRealm, 'sa-uuid-1', {
        description: 'Updated',
      });

      expect(result).toEqual(updated);
    });

    it('should throw ConflictException when new name is already taken by another account', async () => {
      prisma.serviceAccount.findFirst.mockResolvedValue(mockServiceAccount);
      // Another account with the same name
      prisma.serviceAccount.findUnique.mockResolvedValue({
        ...mockServiceAccount,
        id: 'sa-uuid-other',
      });

      await expect(
        service.update(mockRealm, 'sa-uuid-1', { name: 'taken-name' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException when service account does not exist', async () => {
      prisma.serviceAccount.findFirst.mockResolvedValue(null);

      await expect(
        service.update(mockRealm, 'nonexistent', { name: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should delete a service account', async () => {
      prisma.serviceAccount.findFirst.mockResolvedValue(mockServiceAccount);
      prisma.serviceAccount.delete.mockResolvedValue(mockServiceAccount);

      await service.remove(mockRealm, 'sa-uuid-1');

      expect(prisma.serviceAccount.delete).toHaveBeenCalledWith({
        where: { id: 'sa-uuid-1' },
      });
    });

    it('should throw NotFoundException when service account does not exist', async () => {
      prisma.serviceAccount.findFirst.mockResolvedValue(null);

      await expect(service.remove(mockRealm, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── API Key management ───────────────────────────────────────────────────

  describe('createApiKey', () => {
    it('should generate a key, store only its hash, and return the plain key once', async () => {
      prisma.serviceAccount.findFirst.mockResolvedValue(mockServiceAccount);
      cryptoService.generateSecret.mockReturnValue(
        'abcd1234ef567890abcd1234ef567890abcd1234ef567890abcd1234ef567890',
      );
      cryptoService.hashPassword.mockResolvedValue('$argon2id$v=19$...');
      prisma.apiKey.create.mockResolvedValue({
        ...mockApiKey,
        keyPrefix: 'abcd1234',
      });

      const result = await service.createApiKey(mockRealm, 'sa-uuid-1', {
        name: 'test-key',
        scopes: ['read:users'],
      });

      expect(result.plainKey).toBe(
        'abcd1234ef567890abcd1234ef567890abcd1234ef567890abcd1234ef567890',
      );
      expect(result.keyWarning).toBeDefined();
      expect(cryptoService.generateSecret).toHaveBeenCalledWith(32);
      expect(cryptoService.hashPassword).toHaveBeenCalledWith(
        'abcd1234ef567890abcd1234ef567890abcd1234ef567890abcd1234ef567890',
      );
      expect(prisma.apiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            serviceAccountId: 'sa-uuid-1',
            keyPrefix: 'abcd1234',
            keyHash: '$argon2id$v=19$...',
          }),
        }),
      );
    });

    it('should throw NotFoundException when service account does not exist', async () => {
      prisma.serviceAccount.findFirst.mockResolvedValue(null);

      await expect(
        service.createApiKey(mockRealm, 'nonexistent', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('should set expiresAt when provided', async () => {
      prisma.serviceAccount.findFirst.mockResolvedValue(mockServiceAccount);
      cryptoService.generateSecret.mockReturnValue(
        'abcd1234ef567890abcd1234ef567890abcd1234ef567890abcd1234ef567890',
      );
      cryptoService.hashPassword.mockResolvedValue('hash');
      prisma.apiKey.create.mockResolvedValue({
        ...mockApiKey,
        expiresAt: new Date('2027-01-01'),
      });

      const result = await service.createApiKey(mockRealm, 'sa-uuid-1', {
        expiresAt: '2027-01-01T00:00:00.000Z',
      });

      expect(prisma.apiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            expiresAt: new Date('2027-01-01T00:00:00.000Z'),
          }),
        }),
      );
      expect(result).toBeDefined();
    });
  });

  describe('validateApiKey', () => {
    it('should return the api key record when credentials are valid', async () => {
      prisma.apiKey.findMany.mockResolvedValue([mockApiKey]);
      cryptoService.verifyPassword.mockResolvedValue(true);
      prisma.apiKey.update.mockResolvedValue({});

      const result = await service.validateApiKey(
        'abcd1234',
        'abcd1234ef567890...',
      );

      expect(result).toEqual(mockApiKey);
      expect(cryptoService.verifyPassword).toHaveBeenCalledWith(
        '$argon2id$hash',
        'abcd1234ef567890...',
      );
    });

    it('should throw UnauthorizedException when no candidates match the prefix', async () => {
      prisma.apiKey.findMany.mockResolvedValue([]);

      await expect(
        service.validateApiKey('badpref', 'badprefxxxxxxxx'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when hash verification fails', async () => {
      prisma.apiKey.findMany.mockResolvedValue([mockApiKey]);
      cryptoService.verifyPassword.mockResolvedValue(false);

      await expect(
        service.validateApiKey('abcd1234', 'wrong-plain-key'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should skip expired keys', async () => {
      const expiredKey = {
        ...mockApiKey,
        expiresAt: new Date(Date.now() - 1000),
      };
      prisma.apiKey.findMany.mockResolvedValue([expiredKey]);

      await expect(
        service.validateApiKey('abcd1234', 'abcd1234plainkey'),
      ).rejects.toThrow(UnauthorizedException);

      expect(cryptoService.verifyPassword).not.toHaveBeenCalled();
    });

    it('should skip keys whose service account is disabled', async () => {
      const disabledSaKey = {
        ...mockApiKey,
        serviceAccount: { ...mockServiceAccount, enabled: false },
      };
      prisma.apiKey.findMany.mockResolvedValue([disabledSaKey]);

      await expect(
        service.validateApiKey('abcd1234', 'abcd1234plainkey'),
      ).rejects.toThrow(UnauthorizedException);

      expect(cryptoService.verifyPassword).not.toHaveBeenCalled();
    });
  });

  describe('revokeApiKey', () => {
    it('should revoke an active key', async () => {
      prisma.serviceAccount.findFirst.mockResolvedValue(mockServiceAccount);
      prisma.apiKey.findFirst.mockResolvedValue(mockApiKey);
      prisma.apiKey.update.mockResolvedValue({ ...mockApiKey, revoked: true });

      const result = await service.revokeApiKey(
        mockRealm,
        'sa-uuid-1',
        'key-uuid-1',
      );

      expect(result.message).toMatch(/revoked successfully/i);
      expect(prisma.apiKey.update).toHaveBeenCalledWith({
        where: { id: 'key-uuid-1' },
        data: expect.objectContaining({
          revoked: true,
          revokedAt: expect.any(Date),
        }),
      });
    });

    it('should return a message when key is already revoked', async () => {
      prisma.serviceAccount.findFirst.mockResolvedValue(mockServiceAccount);
      prisma.apiKey.findFirst.mockResolvedValue({
        ...mockApiKey,
        revoked: true,
      });

      const result = await service.revokeApiKey(
        mockRealm,
        'sa-uuid-1',
        'key-uuid-1',
      );

      expect(result.message).toMatch(/already revoked/i);
      expect(prisma.apiKey.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when key does not exist', async () => {
      prisma.serviceAccount.findFirst.mockResolvedValue(mockServiceAccount);
      prisma.apiKey.findFirst.mockResolvedValue(null);

      await expect(
        service.revokeApiKey(mockRealm, 'sa-uuid-1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('rotateApiKey', () => {
    it('should create a new key and schedule the old key for expiry', async () => {
      prisma.serviceAccount.findFirst.mockResolvedValue(mockServiceAccount);
      prisma.apiKey.findFirst.mockResolvedValue(mockApiKey);
      cryptoService.generateSecret.mockReturnValue(
        'newkey1234567890newkey1234567890newkey1234567890newkey1234567890',
      );
      cryptoService.hashPassword.mockResolvedValue('$argon2id$newhash');
      const newKeyRecord = {
        ...mockApiKey,
        id: 'key-uuid-2',
        keyPrefix: 'newkey12',
        keyHash: '$argon2id$newhash',
      };
      prisma.apiKey.create.mockResolvedValue(newKeyRecord);
      prisma.apiKey.update.mockResolvedValue({});

      const result = await service.rotateApiKey(
        mockRealm,
        'sa-uuid-1',
        'key-uuid-1',
      );

      expect(result.newKey.plainKey).toBe(
        'newkey1234567890newkey1234567890newkey1234567890newkey1234567890',
      );
      expect(result.newKey.keyWarning).toBeDefined();
      expect(result.oldKeyId).toBe('key-uuid-1');
      expect(result.gracePeriodEndsAt).toBeInstanceOf(Date);

      // Old key should have been updated with a grace-period expiry
      expect(prisma.apiKey.update).toHaveBeenCalledWith({
        where: { id: 'key-uuid-1' },
        data: expect.objectContaining({ expiresAt: expect.any(Date) }),
      });
    });

    it('should throw NotFoundException when key does not exist', async () => {
      prisma.serviceAccount.findFirst.mockResolvedValue(mockServiceAccount);
      prisma.apiKey.findFirst.mockResolvedValue(null);

      await expect(
        service.rotateApiKey(mockRealm, 'sa-uuid-1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getUsageMetrics', () => {
    it('should return aggregated usage metrics', async () => {
      prisma.serviceAccount.findFirst.mockResolvedValue(mockServiceAccount);
      const usedDate = new Date('2026-01-01');
      const keys = [
        { ...mockApiKey, requestCount: 10, lastUsedAt: usedDate },
        { ...mockApiKey, id: 'key-uuid-2', requestCount: 5, lastUsedAt: null },
      ];
      prisma.apiKey.findMany.mockResolvedValue(keys);

      const result = await service.getUsageMetrics(mockRealm, 'sa-uuid-1');

      expect(result.serviceAccountId).toBe('sa-uuid-1');
      expect(result.totalRequests).toBe(15);
      expect(result.lastUsedAt).toEqual(usedDate);
      expect(result.keys).toHaveLength(2);
    });

    it('should return null lastUsedAt when no keys have been used', async () => {
      prisma.serviceAccount.findFirst.mockResolvedValue(mockServiceAccount);
      prisma.apiKey.findMany.mockResolvedValue([
        { ...mockApiKey, requestCount: 0, lastUsedAt: null },
      ]);

      const result = await service.getUsageMetrics(mockRealm, 'sa-uuid-1');

      expect(result.lastUsedAt).toBeNull();
      expect(result.totalRequests).toBe(0);
    });
  });
});
