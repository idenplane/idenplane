import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { NhiService } from './nhi.service.js';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../prisma/prisma.mock.js';
import type { Realm } from '@prisma/client';

describe('NhiService', () => {
  let service: NhiService;
  let prisma: MockPrismaService;
  let cryptoService: {
    generateSecret: jest.Mock;
    hashPassword: jest.Mock;
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

  const mockIdentity = {
    id: 'nhi-uuid-1',
    realmId: 'realm-1',
    identityType: 'MACHINE_TO_MACHINE',
    name: 'test-identity',
    description: 'Test NHI identity',
    enabled: true,
    lifecycleStatus: 'PROVISIONING',
    suspendedAt: null,
    decommissionedAt: null,
    certificateSubject: null,
    certificateFingerprint: null,
    certificateNotBefore: null,
    certificateNotAfter: null,
    agentPurpose: 'ci-cd',
    permissionScopes: ['read:users', 'write:users'],
    metadata: { env: 'test' },
    tags: ['test', 'ci'],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockCredential = {
    id: 'cred-uuid-1',
    nhiIdentityId: 'nhi-uuid-1',
    credentialType: 'API_KEY',
    name: 'test-credential',
    keyPrefix: 'abcd1234',
    certificatePem: null,
    certificateChain: null,
    privateKeyPem: null,
    jwtSigningAlgorithm: null,
    jwtIssuer: null,
    jwtAudience: null,
    expiresAt: null,
    rotatedAt: null,
    rotationRequired: false,
    enabled: true,
    revoked: false,
    revokedAt: null,
    lastUsedAt: null,
    requestCount: 0,
    allowedIpRanges: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPolicy = {
    id: 'policy-uuid-1',
    realmId: 'realm-1',
    name: 'strict-rotation',
    description: 'Strict rotation policy',
    enabled: true,
    priority: 1,
    credentialType: 'API_KEY',
    rotationIntervalDays: 90,
    rotationBeforeDays: 7,
    autoRotate: false,
    maxCredentialAgeDays: 365,
    maxRequestsPerDay: 10000,
    maxRequestsPerMonth: null,
    rateLimitPerMinute: 1000,
    requireCertificate: false,
    requireIpRestriction: false,
    requireAuditLogging: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    cryptoService = {
      generateSecret: jest.fn(),
      hashPassword: jest.fn(),
    };
    service = new NhiService(prisma as any, cryptoService as any);
  });

  // ── Identity CRUD ─────────────────────────────────────────────────────────

  describe('create', () => {
    it('should create an NHI identity', async () => {
      prisma.nhiIdentity.findUnique.mockResolvedValue(null);
      prisma.nhiIdentity.create.mockResolvedValue(mockIdentity);

      const result = await service.create(mockRealm, {
        name: 'test-identity',
        description: 'Test NHI identity',
        agentPurpose: 'ci-cd',
        permissionScopes: ['read:users', 'write:users'],
      });

      expect(result).toEqual(mockIdentity);
      expect(prisma.nhiIdentity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            realmId: 'realm-1',
            name: 'test-identity',
            description: 'Test NHI identity',
            enabled: true,
            lifecycleStatus: 'PROVISIONING',
            agentPurpose: 'ci-cd',
            permissionScopes: ['read:users', 'write:users'],
          }),
        }),
      );
    });

    it('should default enabled to true when not specified', async () => {
      prisma.nhiIdentity.findUnique.mockResolvedValue(null);
      prisma.nhiIdentity.create.mockResolvedValue(mockIdentity);

      await service.create(mockRealm, { name: 'test-identity' });

      expect(prisma.nhiIdentity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ enabled: true }),
        }),
      );
    });

    it('should throw ConflictException when name already exists in realm', async () => {
      prisma.nhiIdentity.findUnique.mockResolvedValue(mockIdentity);

      await expect(
        service.create(mockRealm, { name: 'test-identity' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('should return all NHI identities for a realm', async () => {
      prisma.nhiIdentity.findMany.mockResolvedValue([mockIdentity]);

      const result = await service.findAll(mockRealm);

      expect(result).toEqual([mockIdentity]);
      expect(prisma.nhiIdentity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { realmId: 'realm-1' } }),
      );
    });
  });

  describe('findById', () => {
    it('should return NHI identity when found', async () => {
      prisma.nhiIdentity.findFirst.mockResolvedValue(mockIdentity);

      const result = await service.findById(mockRealm, 'nhi-uuid-1');

      expect(result).toEqual(mockIdentity);
    });

    it('should throw NotFoundException when not found', async () => {
      prisma.nhiIdentity.findFirst.mockResolvedValue(null);

      await expect(service.findById(mockRealm, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update an NHI identity', async () => {
      prisma.nhiIdentity.findFirst.mockResolvedValue(mockIdentity);
      prisma.nhiIdentity.findUnique.mockResolvedValue(null);
      const updated = { ...mockIdentity, description: 'Updated description' };
      prisma.nhiIdentity.update.mockResolvedValue(updated);

      const result = await service.update(mockRealm, 'nhi-uuid-1', {
        description: 'Updated description',
      });

      expect(result).toEqual(updated);
    });

    it('should throw ConflictException when new name is already taken by another identity', async () => {
      prisma.nhiIdentity.findFirst.mockResolvedValue(mockIdentity);
      prisma.nhiIdentity.findUnique.mockResolvedValue({
        ...mockIdentity,
        id: 'nhi-uuid-other',
      });

      await expect(
        service.update(mockRealm, 'nhi-uuid-1', { name: 'taken-name' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException when identity does not exist', async () => {
      prisma.nhiIdentity.findFirst.mockResolvedValue(null);

      await expect(
        service.update(mockRealm, 'nonexistent', { name: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should delete an NHI identity', async () => {
      prisma.nhiIdentity.findFirst.mockResolvedValue(mockIdentity);
      prisma.nhiIdentity.delete.mockResolvedValue(mockIdentity);

      await service.remove(mockRealm, 'nhi-uuid-1');

      expect(prisma.nhiIdentity.delete).toHaveBeenCalledWith({
        where: { id: 'nhi-uuid-1' },
      });
    });

    it('should throw NotFoundException when identity does not exist', async () => {
      prisma.nhiIdentity.findFirst.mockResolvedValue(null);

      await expect(service.remove(mockRealm, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── Lifecycle operations ─────────────────────────────────────────────────

  describe('suspend', () => {
    it('should suspend an NHI identity', async () => {
      prisma.nhiIdentity.findFirst.mockResolvedValue(mockIdentity);
      const suspended = {
        ...mockIdentity,
        lifecycleStatus: 'SUSPENDED',
        suspendedAt: new Date(),
      };
      prisma.nhiIdentity.update.mockResolvedValue(suspended);

      const result = await service.suspend(mockRealm, 'nhi-uuid-1');

      expect(result.lifecycleStatus).toBe('SUSPENDED');
      expect(prisma.nhiIdentity.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'nhi-uuid-1' },
          data: expect.objectContaining({
            lifecycleStatus: 'SUSPENDED',
            suspendedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('should throw NotFoundException when identity does not exist', async () => {
      prisma.nhiIdentity.findFirst.mockResolvedValue(null);

      await expect(service.suspend(mockRealm, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reactivate', () => {
    it('should reactivate a suspended NHI identity', async () => {
      const suspendedIdentity = {
        ...mockIdentity,
        lifecycleStatus: 'SUSPENDED',
        suspendedAt: new Date(),
      };
      prisma.nhiIdentity.findFirst.mockResolvedValue(suspendedIdentity);
      const reactivated = {
        ...mockIdentity,
        lifecycleStatus: 'ACTIVE',
        suspendedAt: null,
      };
      prisma.nhiIdentity.update.mockResolvedValue(reactivated);

      const result = await service.reactivate(mockRealm, 'nhi-uuid-1');

      expect(result.lifecycleStatus).toBe('ACTIVE');
    });

    it('should throw ConflictException when identity is not suspended', async () => {
      prisma.nhiIdentity.findFirst.mockResolvedValue(mockIdentity);

      await expect(service.reactivate(mockRealm, 'nhi-uuid-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw NotFoundException when identity does not exist', async () => {
      prisma.nhiIdentity.findFirst.mockResolvedValue(null);

      await expect(
        service.reactivate(mockRealm, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('decommission', () => {
    it('should decommission an NHI identity and revoke all credentials', async () => {
      prisma.nhiIdentity.findFirst.mockResolvedValue(mockIdentity);
      prisma.nhiCredential.updateMany.mockResolvedValue({ count: 2 });
      const decommissioned = {
        ...mockIdentity,
        lifecycleStatus: 'DECOMMISSIONED',
        decommissionedAt: new Date(),
        enabled: false,
      };
      prisma.nhiIdentity.update.mockResolvedValue(decommissioned);

      const result = await service.decommission(mockRealm, 'nhi-uuid-1');

      expect(result.lifecycleStatus).toBe('DECOMMISSIONED');
      expect(result.enabled).toBe(false);
      expect(prisma.nhiCredential.updateMany).toHaveBeenCalledWith({
        where: { nhiIdentityId: 'nhi-uuid-1' },
        data: { revoked: true, revokedAt: expect.any(Date) },
      });
    });

    it('should throw NotFoundException when identity does not exist', async () => {
      prisma.nhiIdentity.findFirst.mockResolvedValue(null);

      await expect(
        service.decommission(mockRealm, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── Credential management ─────────────────────────────────────────────────

  describe('createCredential', () => {
    it('should create an API_KEY credential and return the plain key once', async () => {
      prisma.nhiIdentity.findFirst.mockResolvedValue(mockIdentity);
      cryptoService.generateSecret.mockReturnValue(
        'abcd1234ef567890abcd1234ef567890abcd1234ef567890abcd1234ef567890',
      );
      cryptoService.hashPassword.mockResolvedValue('$argon2id$v=19$...');
      prisma.nhiCredential.create.mockResolvedValue({
        ...mockCredential,
        keyPrefix: 'abcd1234',
        keyHash: '$argon2id$v=19$...',
      });

      const result = await service.createCredential(mockRealm, 'nhi-uuid-1', {
        credentialType: 'API_KEY',
        name: 'test-credential',
      });

      expect(result.plainKey).toBe(
        'abcd1234ef567890abcd1234ef567890abcd1234ef567890abcd1234ef567890',
      );
      expect(result.keyWarning).toBeDefined();
      expect(cryptoService.generateSecret).toHaveBeenCalledWith(32);
      expect(cryptoService.hashPassword).toHaveBeenCalled();
      expect(prisma.nhiCredential.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            nhiIdentityId: 'nhi-uuid-1',
            credentialType: 'API_KEY',
            keyPrefix: 'abcd1234',
          }),
        }),
      );
    });

    it('should create a certificate credential without generating a key', async () => {
      prisma.nhiIdentity.findFirst.mockResolvedValue(mockIdentity);
      const certCredential = {
        ...mockCredential,
        credentialType: 'CERTIFICATE',
        certificatePem:
          '-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----',
      };
      prisma.nhiCredential.create.mockResolvedValue(certCredential);

      const result = await service.createCredential(mockRealm, 'nhi-uuid-1', {
        credentialType: 'CERTIFICATE',
        name: 'cert-credential',
        certificatePem:
          '-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----',
      });

      expect(result.credentialType).toBe('CERTIFICATE');
      expect(result.plainKey).toBeUndefined();
      expect(cryptoService.generateSecret).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when identity does not exist', async () => {
      prisma.nhiIdentity.findFirst.mockResolvedValue(null);

      await expect(
        service.createCredential(mockRealm, 'nonexistent', {}),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listCredentials', () => {
    it('should return all credentials for an NHI identity', async () => {
      prisma.nhiIdentity.findFirst.mockResolvedValue(mockIdentity);
      prisma.nhiCredential.findMany.mockResolvedValue([mockCredential]);

      const result = await service.listCredentials(mockRealm, 'nhi-uuid-1');

      expect(result).toEqual([mockCredential]);
      expect(prisma.nhiCredential.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { nhiIdentityId: 'nhi-uuid-1' } }),
      );
    });

    it('should throw NotFoundException when identity does not exist', async () => {
      prisma.nhiIdentity.findFirst.mockResolvedValue(null);

      await expect(
        service.listCredentials(mockRealm, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('revokeCredential', () => {
    it('should revoke an active credential', async () => {
      prisma.nhiIdentity.findFirst.mockResolvedValue(mockIdentity);
      // findCredentialById uses findFirst with select
      prisma.nhiCredential.findFirst.mockResolvedValueOnce({
        ...mockCredential,
      });
      // revokeCredential does a second findFirst without select to check status
      prisma.nhiCredential.findFirst.mockResolvedValueOnce({
        ...mockCredential,
        revoked: false,
      });
      prisma.nhiCredential.update.mockResolvedValue({
        ...mockCredential,
        revoked: true,
      });

      const result = await service.revokeCredential(
        mockRealm,
        'nhi-uuid-1',
        'cred-uuid-1',
      );

      expect(result.message).toMatch(/revoked successfully/i);
      expect(prisma.nhiCredential.update).toHaveBeenCalledWith({
        where: { id: 'cred-uuid-1' },
        data: { revoked: true, revokedAt: expect.any(Date) },
      });
    });

    it('should return a message when credential is already revoked', async () => {
      prisma.nhiIdentity.findFirst.mockResolvedValue(mockIdentity);
      prisma.nhiCredential.findFirst.mockResolvedValue({
        ...mockCredential,
        revoked: true,
      });

      const result = await service.revokeCredential(
        mockRealm,
        'nhi-uuid-1',
        'cred-uuid-1',
      );

      expect(result.message).toMatch(/already revoked/i);
      expect(prisma.nhiCredential.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when identity does not exist', async () => {
      prisma.nhiIdentity.findFirst.mockResolvedValue(null);

      await expect(
        service.revokeCredential(mockRealm, 'nonexistent', 'cred-uuid-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('rotateCredential', () => {
    it('should rotate an API_KEY credential', async () => {
      prisma.nhiIdentity.findFirst.mockResolvedValue(mockIdentity);
      prisma.nhiCredential.findFirst.mockResolvedValue(mockCredential);
      cryptoService.generateSecret.mockReturnValue(
        'newkey1234567890newkey1234567890newkey1234567890newkey1234567890',
      );
      cryptoService.hashPassword.mockResolvedValue('$argon2id$newhash');
      const newCredential = {
        ...mockCredential,
        id: 'cred-uuid-2',
        keyPrefix: 'newkey12',
        keyHash: '$argon2id$newhash',
      };
      prisma.nhiCredential.create.mockResolvedValue(newCredential);
      prisma.nhiCredential.update.mockResolvedValue({});

      const result = await service.rotateCredential(
        mockRealm,
        'nhi-uuid-1',
        'cred-uuid-1',
      );

      expect(result.newCredential.plainKey).toBe(
        'newkey1234567890newkey1234567890newkey1234567890newkey1234567890',
      );
      expect(result.oldCredentialId).toBe('cred-uuid-1');
      expect(prisma.nhiCredential.update).toHaveBeenCalledTimes(2);
    });

    it('should throw ConflictException when credential is not an API_KEY', async () => {
      prisma.nhiIdentity.findFirst.mockResolvedValue(mockIdentity);
      const certCredential = {
        ...mockCredential,
        credentialType: 'CERTIFICATE',
      };
      prisma.nhiCredential.findFirst.mockResolvedValue(certCredential);

      await expect(
        service.rotateCredential(mockRealm, 'nhi-uuid-1', 'cred-uuid-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException when identity does not exist', async () => {
      prisma.nhiIdentity.findFirst.mockResolvedValue(null);

      await expect(
        service.rotateCredential(mockRealm, 'nonexistent', 'cred-uuid-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── Credential Policy CRUD ─────────────────────────────────────────────────

  describe('createPolicy', () => {
    it('should create a credential policy', async () => {
      prisma.nhiCredentialPolicy.findUnique.mockResolvedValue(null);
      prisma.nhiCredentialPolicy.create.mockResolvedValue(mockPolicy);

      const result = await service.createPolicy(mockRealm, {
        name: 'strict-rotation',
        description: 'Strict rotation policy',
        rotationIntervalDays: 90,
      });

      expect(result).toEqual(mockPolicy);
      expect(prisma.nhiCredentialPolicy.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            realmId: 'realm-1',
            name: 'strict-rotation',
            rotationIntervalDays: 90,
          }),
        }),
      );
    });

    it('should throw ConflictException when policy name already exists', async () => {
      prisma.nhiCredentialPolicy.findUnique.mockResolvedValue(mockPolicy);

      await expect(
        service.createPolicy(mockRealm, { name: 'strict-rotation' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('listPolicies', () => {
    it('should return all credential policies for a realm', async () => {
      prisma.nhiCredentialPolicy.findMany.mockResolvedValue([mockPolicy]);

      const result = await service.listPolicies(mockRealm);

      expect(result).toEqual([mockPolicy]);
      expect(prisma.nhiCredentialPolicy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { realmId: 'realm-1' } }),
      );
    });
  });

  describe('findPolicyById', () => {
    it('should return policy when found', async () => {
      prisma.nhiCredentialPolicy.findFirst.mockResolvedValue(mockPolicy);

      const result = await service.findPolicyById(mockRealm, 'policy-uuid-1');

      expect(result).toEqual(mockPolicy);
    });

    it('should throw NotFoundException when not found', async () => {
      prisma.nhiCredentialPolicy.findFirst.mockResolvedValue(null);

      await expect(
        service.findPolicyById(mockRealm, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updatePolicy', () => {
    it('should update a credential policy', async () => {
      prisma.nhiCredentialPolicy.findFirst.mockResolvedValue(mockPolicy);
      prisma.nhiCredentialPolicy.findUnique.mockResolvedValue(null);
      const updated = { ...mockPolicy, rotationIntervalDays: 60 };
      prisma.nhiCredentialPolicy.update.mockResolvedValue(updated);

      const result = await service.updatePolicy(mockRealm, 'policy-uuid-1', {
        rotationIntervalDays: 60,
      });

      expect(result).toEqual(updated);
    });

    it('should throw ConflictException when new name is already taken', async () => {
      prisma.nhiCredentialPolicy.findFirst.mockResolvedValue(mockPolicy);
      prisma.nhiCredentialPolicy.findUnique.mockResolvedValue({
        ...mockPolicy,
        id: 'policy-uuid-other',
      });

      await expect(
        service.updatePolicy(mockRealm, 'policy-uuid-1', {
          name: 'taken-name',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException when policy does not exist', async () => {
      prisma.nhiCredentialPolicy.findFirst.mockResolvedValue(null);

      await expect(
        service.updatePolicy(mockRealm, 'nonexistent', { name: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removePolicy', () => {
    it('should delete a credential policy', async () => {
      prisma.nhiCredentialPolicy.findFirst.mockResolvedValue(mockPolicy);
      prisma.nhiCredentialPolicy.delete.mockResolvedValue(mockPolicy);

      await service.removePolicy(mockRealm, 'policy-uuid-1');

      expect(prisma.nhiCredentialPolicy.delete).toHaveBeenCalledWith({
        where: { id: 'policy-uuid-1' },
      });
    });

    it('should throw NotFoundException when policy does not exist', async () => {
      prisma.nhiCredentialPolicy.findFirst.mockResolvedValue(null);

      await expect(
        service.removePolicy(mockRealm, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── Usage statistics ──────────────────────────────────────────────────────

  describe('getUsageStats', () => {
    it('should return usage statistics for an NHI identity', async () => {
      prisma.nhiIdentity.findFirst.mockResolvedValue(mockIdentity);
      prisma.nhiUsageStats.findUnique.mockResolvedValue({
        nhiIdentityId: 'nhi-uuid-1',
        totalRequests: 100,
        successfulRequests: 95,
        failedRequests: 5,
        lastActiveAt: new Date('2026-01-01'),
        lastSuccessfulAt: new Date('2026-01-01'),
        lastFailedAt: new Date('2026-01-01'),
        oldestCredentialAgeDays: 30,
        newestCredentialAgeDays: 5,
        credentialsExpiringSoon: 1,
        id: 'stats-1',
        updatedAt: new Date(),
      });
      prisma.nhiCredential.findMany.mockResolvedValue([
        { ...mockCredential, requestCount: 50 },
        { ...mockCredential, id: 'cred-uuid-2', requestCount: 50 },
      ]);

      const result = await service.getUsageStats(mockRealm, 'nhi-uuid-1');

      expect(result.nhiIdentityId).toBe('nhi-uuid-1');
      expect(result.totalRequests).toBe(100);
      expect(result.credentials).toHaveLength(2);
    });

    it('should create stats record if it does not exist', async () => {
      prisma.nhiIdentity.findFirst.mockResolvedValue(mockIdentity);
      prisma.nhiUsageStats.findUnique.mockResolvedValue(null);
      prisma.nhiUsageStats.create.mockResolvedValue({
        nhiIdentityId: 'nhi-uuid-1',
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        lastActiveAt: null,
        lastSuccessfulAt: null,
        lastFailedAt: null,
        oldestCredentialAgeDays: null,
        newestCredentialAgeDays: null,
        credentialsExpiringSoon: 0,
        id: 'stats-1',
        updatedAt: new Date(),
      });
      prisma.nhiCredential.findMany.mockResolvedValue([mockCredential]);

      const result = await service.getUsageStats(mockRealm, 'nhi-uuid-1');

      expect(prisma.nhiUsageStats.create).toHaveBeenCalledWith({
        data: { nhiIdentityId: 'nhi-uuid-1' },
      });
      expect(result.totalRequests).toBe(0);
    });

    it('should throw NotFoundException when identity does not exist', async () => {
      prisma.nhiIdentity.findFirst.mockResolvedValue(null);

      await expect(
        service.getUsageStats(mockRealm, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── Certificate validation ────────────────────────────────────────────────

  describe('validateCertificate', () => {
    it('should return valid for a certificate with valid dates', () => {
      const validCert = [
        '-----BEGIN CERTIFICATE-----',
        'MIIBhTCCASugAwIBAgIQiT5GLJYD8t0KhKk5dNwbMAoGCCqGSM49AgE',
        '-----END CERTIFICATE-----',
      ].join('\n');

      const result = service.validateCertificate(validCert);

      expect(result.valid).toBe(true);
      expect(result.info).toBeDefined();
    });

    it('should return invalid for a certificate missing PEM header', () => {
      const invalidCert = 'not a certificate';

      const result = service.validateCertificate(invalidCert);

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/PEM header/i);
    });
  });

  describe('getCertificateInfo', () => {
    it('should parse certificate info from PEM', () => {
      const cert = [
        '-----BEGIN CERTIFICATE-----',
        'MIIBhTCCASugAwIBAgIQiT5GLJYD8t0KhKk5dNwbMAoGCCqGSM49AgE',
        '-----END CERTIFICATE-----',
      ].join('\n');

      const result = service.getCertificateInfo(cert);

      expect(result).toBeDefined();
      expect(result.subject).toBeDefined();
      expect(result.fingerprint).toBeDefined();
    });
  });
});
