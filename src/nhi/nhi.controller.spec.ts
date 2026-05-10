// Import reflect-metadata first for decorators
import 'reflect-metadata';

import { NotFoundException } from '@nestjs/common';
import { NhiController } from './nhi.controller.js';
import { NhiAuditService } from './nhi-audit.service.js';
import type { Realm } from '@prisma/client';

describe('NhiController', () => {
  let controller: NhiController;
  let nhiService: {
    create: jest.Mock;
    findAll: jest.Mock;
    findById: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    suspend: jest.Mock;
    reactivate: jest.Mock;
    decommission: jest.Mock;
    createCredential: jest.Mock;
    listCredentials: jest.Mock;
    revokeCredential: jest.Mock;
    rotateCredential: jest.Mock;
    bulkRegistration: jest.Mock;
    generateDeviceCertificate: jest.Mock;
    setCertificate: jest.Mock;
    getUsageStats: jest.Mock;
    createPolicy: jest.Mock;
    listPolicies: jest.Mock;
    findPolicyById: jest.Mock;
    updatePolicy: jest.Mock;
    removePolicy: jest.Mock;
    getPolicyRotationStatus: jest.Mock;
    getRotationStatusSummary: jest.Mock;
  };
  let nhiAuditService: {
    queryAuditLogs: jest.Mock;
    clearAuditLogs: jest.Mock;
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
    permissionScopes: ['read:users'],
    metadata: {},
    tags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    nhiService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      suspend: jest.fn(),
      reactivate: jest.fn(),
      decommission: jest.fn(),
      createCredential: jest.fn(),
      listCredentials: jest.fn(),
      revokeCredential: jest.fn(),
      rotateCredential: jest.fn(),
      bulkRegistration: jest.fn(),
      generateDeviceCertificate: jest.fn(),
      setCertificate: jest.fn(),
      getUsageStats: jest.fn(),
      createPolicy: jest.fn(),
      listPolicies: jest.fn(),
      findPolicyById: jest.fn(),
      updatePolicy: jest.fn(),
      removePolicy: jest.fn(),
      getPolicyRotationStatus: jest.fn(),
      getRotationStatusSummary: jest.fn(),
    };
    nhiAuditService = {
      queryAuditLogs: jest.fn(),
      clearAuditLogs: jest.fn(),
    };
    controller = new NhiController(
      nhiService as any,
      nhiAuditService as any,
    );
  });

  // ── Identity endpoints ───────────────────────────────────────────────────

  describe('create', () => {
    it('should delegate to nhiService.create with realm and dto', async () => {
      nhiService.create.mockResolvedValue(mockIdentity);

      const dto = { name: 'test-identity', description: 'Test' };
      const result = await controller.create(mockRealm, dto);

      expect(result).toEqual(mockIdentity);
      expect(nhiService.create).toHaveBeenCalledWith(mockRealm, dto);
    });
  });

  describe('findAll', () => {
    it('should delegate to nhiService.findAll with realm', async () => {
      nhiService.findAll.mockResolvedValue([mockIdentity]);

      const result = await controller.findAll(mockRealm);

      expect(result).toEqual([mockIdentity]);
      expect(nhiService.findAll).toHaveBeenCalledWith(mockRealm);
    });
  });

  describe('findOne', () => {
    it('should delegate to nhiService.findById with realm and id', async () => {
      nhiService.findById.mockResolvedValue(mockIdentity);

      const result = await controller.findOne(mockRealm, 'nhi-uuid-1');

      expect(result).toEqual(mockIdentity);
      expect(nhiService.findById).toHaveBeenCalledWith(mockRealm, 'nhi-uuid-1');
    });
  });

  describe('update', () => {
    it('should delegate to nhiService.update with realm, id, and dto', async () => {
      const updated = { ...mockIdentity, description: 'Updated' };
      nhiService.update.mockResolvedValue(updated);

      const dto = { description: 'Updated' };
      const result = await controller.update(mockRealm, 'nhi-uuid-1', dto);

      expect(result).toEqual(updated);
      expect(nhiService.update).toHaveBeenCalledWith(mockRealm, 'nhi-uuid-1', dto);
    });
  });

  describe('remove', () => {
    it('should delegate to nhiService.remove with realm and id', async () => {
      nhiService.remove.mockResolvedValue(undefined);

      await controller.remove(mockRealm, 'nhi-uuid-1');

      expect(nhiService.remove).toHaveBeenCalledWith(mockRealm, 'nhi-uuid-1');
    });
  });

  // ── Lifecycle endpoints ───────────────────────────────────────────────────

  describe('suspend', () => {
    it('should delegate to nhiService.suspend with realm and id', async () => {
      const suspended = { ...mockIdentity, lifecycleStatus: 'SUSPENDED' };
      nhiService.suspend.mockResolvedValue(suspended);

      const result = await controller.suspend(mockRealm, 'nhi-uuid-1');

      expect(result).toEqual(suspended);
      expect(nhiService.suspend).toHaveBeenCalledWith(mockRealm, 'nhi-uuid-1');
    });
  });

  describe('reactivate', () => {
    it('should delegate to nhiService.reactivate with realm and id', async () => {
      const reactivated = { ...mockIdentity, lifecycleStatus: 'ACTIVE' };
      nhiService.reactivate.mockResolvedValue(reactivated);

      const result = await controller.reactivate(mockRealm, 'nhi-uuid-1');

      expect(result).toEqual(reactivated);
      expect(nhiService.reactivate).toHaveBeenCalledWith(mockRealm, 'nhi-uuid-1');
    });
  });

  describe('decommission', () => {
    it('should delegate to nhiService.decommission with realm and id', async () => {
      const decommissioned = { ...mockIdentity, lifecycleStatus: 'DECOMMISSIONED' };
      nhiService.decommission.mockResolvedValue(decommissioned);

      const result = await controller.decommission(mockRealm, 'nhi-uuid-1');

      expect(result).toEqual(decommissioned);
      expect(nhiService.decommission).toHaveBeenCalledWith(mockRealm, 'nhi-uuid-1');
    });
  });

  // ── Credential endpoints ──────────────────────────────────────────────────

  describe('createCredential', () => {
    it('should delegate to nhiService.createCredential with realm, id, and dto', async () => {
      const credential = { id: 'cred-uuid-1', name: 'test-cred', credentialType: 'API_KEY' };
      nhiService.createCredential.mockResolvedValue(credential);

      const dto = { credentialType: 'API_KEY', name: 'test-cred' };
      const result = await controller.createCredential(mockRealm, 'nhi-uuid-1', dto);

      expect(result).toEqual(credential);
      expect(nhiService.createCredential).toHaveBeenCalledWith(mockRealm, 'nhi-uuid-1', dto);
    });
  });

  describe('listCredentials', () => {
    it('should delegate to nhiService.listCredentials with realm and id', async () => {
      const credentials = [
        { id: 'cred-uuid-1', name: 'cred-1', credentialType: 'API_KEY' },
        { id: 'cred-uuid-2', name: 'cred-2', credentialType: 'CERTIFICATE' },
      ];
      nhiService.listCredentials.mockResolvedValue(credentials);

      const result = await controller.listCredentials(mockRealm, 'nhi-uuid-1');

      expect(result).toEqual(credentials);
      expect(nhiService.listCredentials).toHaveBeenCalledWith(mockRealm, 'nhi-uuid-1');
    });
  });

  describe('revokeCredential', () => {
    it('should delegate to nhiService.revokeCredential with realm, id, and credentialId', async () => {
      nhiService.revokeCredential.mockResolvedValue({ message: 'Credential revoked successfully' });

      const result = await controller.revokeCredential(mockRealm, 'nhi-uuid-1', 'cred-uuid-1');

      expect(result).toEqual({ message: 'Credential revoked successfully' });
      expect(nhiService.revokeCredential).toHaveBeenCalledWith(mockRealm, 'nhi-uuid-1', 'cred-uuid-1');
    });
  });

  describe('rotateCredential', () => {
    it('should delegate to nhiService.rotateCredential with realm, id, and credentialId', async () => {
      const rotated = {
        newCredential: { id: 'cred-uuid-2', name: 'rotated-cred' },
        oldCredentialId: 'cred-uuid-1',
      };
      nhiService.rotateCredential.mockResolvedValue(rotated);

      const result = await controller.rotateCredential(mockRealm, 'nhi-uuid-1', 'cred-uuid-1');

      expect(result).toEqual(rotated);
      expect(nhiService.rotateCredential).toHaveBeenCalledWith(mockRealm, 'nhi-uuid-1', 'cred-uuid-1');
    });
  });

  // ── Bulk registration ─────────────────────────────────────────────────────

  describe('bulkRegistration', () => {
    it('should delegate to nhiService.bulkRegistration with realm and dto', async () => {
      const response = {
        total: 2,
        successful: 2,
        failed: 0,
        results: [
          { name: 'device-1', id: 'id-1', success: true },
          { name: 'device-2', id: 'id-2', success: true },
        ],
      };
      nhiService.bulkRegistration.mockResolvedValue(response);

      const dto = {
        devices: [
          { name: 'device-1' },
          { name: 'device-2' },
        ],
      };
      const result = await controller.bulkRegistration(mockRealm, dto);

      expect(result).toEqual(response);
      expect(nhiService.bulkRegistration).toHaveBeenCalledWith(mockRealm, dto);
    });
  });

  // ── Certificate endpoints ─────────────────────────────────────────────────

  describe('generateDeviceCertificate', () => {
    it('should delegate to nhiService.generateDeviceCertificate with realm and dto', async () => {
      const cert = {
        certificatePem: '-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----',
        privateKeyPem: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----',
        info: {
          subject: 'CN=device-1',
          issuer: 'CN=authme',
          notBefore: '2026-01-01T00:00:00.000Z',
          notAfter: '2027-01-01T00:00:00.000Z',
          fingerprint: 'SHA256:AB:CD:EF',
        },
      };
      nhiService.generateDeviceCertificate.mockResolvedValue(cert);

      const dto = { subjectCommonName: 'device-1' };
      const result = await controller.generateDeviceCertificate(mockRealm, dto);

      expect(result).toEqual(cert);
      expect(nhiService.generateDeviceCertificate).toHaveBeenCalledWith(mockRealm, dto);
    });
  });

  describe('setCertificate', () => {
    it('should delegate to nhiService.setCertificate with realm, id, and dto', async () => {
      const withCert = {
        ...mockIdentity,
        certificateSubject: 'CN=device-1',
        certificateFingerprint: 'SHA256:AB:CD',
      };
      nhiService.setCertificate.mockResolvedValue(withCert);

      const dto = { certificatePem: '-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----' };
      const result = await controller.setCertificate(mockRealm, 'nhi-uuid-1', dto);

      expect(result).toEqual(withCert);
      expect(nhiService.setCertificate).toHaveBeenCalledWith(mockRealm, 'nhi-uuid-1', dto);
    });
  });

  // ── Usage statistics ───────────────────────────────────────────────────────

  describe('getUsageStats', () => {
    it('should delegate to nhiService.getUsageStats with realm and id', async () => {
      const stats = {
        nhiIdentityId: 'nhi-uuid-1',
        totalRequests: 100,
        lastActiveAt: new Date(),
        credentials: [],
      };
      nhiService.getUsageStats.mockResolvedValue(stats);

      const result = await controller.getUsageStats(mockRealm, 'nhi-uuid-1');

      expect(result).toEqual(stats);
      expect(nhiService.getUsageStats).toHaveBeenCalledWith(mockRealm, 'nhi-uuid-1');
    });
  });

  // ── Credential Policy endpoints ──────────────────────────────────────────

  describe('createPolicy', () => {
    it('should delegate to nhiService.createPolicy with realm and dto', async () => {
      const policy = {
        id: 'policy-uuid-1',
        name: 'strict-rotation',
        rotationIntervalDays: 90,
      };
      nhiService.createPolicy.mockResolvedValue(policy);

      const dto = { name: 'strict-rotation', rotationIntervalDays: 90 };
      const result = await controller.createPolicy(mockRealm, dto);

      expect(result).toEqual(policy);
      expect(nhiService.createPolicy).toHaveBeenCalledWith(mockRealm, dto);
    });
  });

  describe('listPolicies', () => {
    it('should delegate to nhiService.listPolicies with realm', async () => {
      const policies = [
        { id: 'policy-1', name: 'policy-1' },
        { id: 'policy-2', name: 'policy-2' },
      ];
      nhiService.listPolicies.mockResolvedValue(policies);

      const result = await controller.listPolicies(mockRealm);

      expect(result).toEqual(policies);
      expect(nhiService.listPolicies).toHaveBeenCalledWith(mockRealm);
    });
  });

  describe('getPolicy', () => {
    it('should delegate to nhiService.findPolicyById with realm and policyId', async () => {
      const policy = { id: 'policy-uuid-1', name: 'strict-rotation' };
      nhiService.findPolicyById.mockResolvedValue(policy);

      const result = await controller.getPolicy(mockRealm, 'policy-uuid-1');

      expect(result).toEqual(policy);
      expect(nhiService.findPolicyById).toHaveBeenCalledWith(mockRealm, 'policy-uuid-1');
    });
  });

  describe('updatePolicy', () => {
    it('should delegate to nhiService.updatePolicy with realm, policyId, and dto', async () => {
      const updated = { id: 'policy-uuid-1', name: 'updated-policy' };
      nhiService.updatePolicy.mockResolvedValue(updated);

      const dto = { name: 'updated-policy' };
      const result = await controller.updatePolicy(mockRealm, 'policy-uuid-1', dto);

      expect(result).toEqual(updated);
      expect(nhiService.updatePolicy).toHaveBeenCalledWith(mockRealm, 'policy-uuid-1', dto);
    });
  });

  describe('deletePolicy', () => {
    it('should delegate to nhiService.removePolicy with realm and policyId', async () => {
      nhiService.removePolicy.mockResolvedValue(undefined);

      await controller.deletePolicy(mockRealm, 'policy-uuid-1');

      expect(nhiService.removePolicy).toHaveBeenCalledWith(mockRealm, 'policy-uuid-1');
    });
  });

  describe('getPolicyRotationStatus', () => {
    it('should delegate to nhiService.getPolicyRotationStatus with realm and policyId', async () => {
      const status = {
        policyId: 'policy-uuid-1',
        totalCredentials: 5,
        credentialsRequiringRotation: 2,
        statuses: [],
      };
      nhiService.getPolicyRotationStatus.mockResolvedValue(status);

      const result = await controller.getPolicyRotationStatus(mockRealm, 'policy-uuid-1');

      expect(result).toEqual(status);
      expect(nhiService.getPolicyRotationStatus).toHaveBeenCalledWith(mockRealm, 'policy-uuid-1');
    });
  });

  describe('getRotationStatusSummary', () => {
    it('should delegate to nhiService.getRotationStatusSummary with realm', async () => {
      const summary = {
        totalRequiringRotation: 10,
        dueForRotation: 5,
        mustRotate: 2,
        policies: [],
      };
      nhiService.getRotationStatusSummary.mockResolvedValue(summary);

      const result = await controller.getRotationStatusSummary(mockRealm);

      expect(result).toEqual(summary);
      expect(nhiService.getRotationStatusSummary).toHaveBeenCalledWith(mockRealm);
    });
  });

  // ── Audit log endpoints ────────────────────────────────────────────────────

  describe('queryAuditLogs', () => {
    it('should delegate to nhiAuditService.queryAuditLogs with converted params', async () => {
      const logs = [
        { id: 'log-1', action: 'CREDENTIAL_ISSUED', success: true },
        { id: 'log-2', action: 'ACCESS_GRANTED', success: true },
      ];
      nhiAuditService.queryAuditLogs.mockResolvedValue(logs);

      const result = await controller.queryAuditLogs(
        mockRealm,
        'nhi-uuid-1',
        'CREDENTIAL_ISSUED',
        'true',
        '2026-01-01',
        '2026-01-31',
        '0',
        '50',
      );

      expect(result).toEqual(logs);
      expect(nhiAuditService.queryAuditLogs).toHaveBeenCalledWith({
        realmId: 'realm-1',
        nhiIdentityId: 'nhi-uuid-1',
        action: 'CREDENTIAL_ISSUED',
        success: true,
        dateFrom: new Date('2026-01-01'),
        dateTo: new Date('2026-01-31'),
        first: 0,
        max: 50,
      });
    });

    it('should handle undefined optional params', async () => {
      nhiAuditService.queryAuditLogs.mockResolvedValue([]);

      await controller.queryAuditLogs(mockRealm);

      expect(nhiAuditService.queryAuditLogs).toHaveBeenCalledWith({
        realmId: 'realm-1',
        nhiIdentityId: undefined,
        action: undefined,
        success: undefined,
        dateFrom: undefined,
        dateTo: undefined,
        first: undefined,
        max: undefined,
      });
    });
  });

  describe('clearAuditLogs', () => {
    it('should delegate to nhiAuditService.clearAuditLogs with realmId and optional nhiIdentityId', async () => {
      nhiAuditService.clearAuditLogs.mockResolvedValue(undefined);

      await controller.clearAuditLogs(mockRealm, 'nhi-uuid-1');

      expect(nhiAuditService.clearAuditLogs).toHaveBeenCalledWith('realm-1', 'nhi-uuid-1');
    });

    it('should pass undefined when nhiIdentityId is not provided', async () => {
      nhiAuditService.clearAuditLogs.mockResolvedValue(undefined);

      await controller.clearAuditLogs(mockRealm);

      expect(nhiAuditService.clearAuditLogs).toHaveBeenCalledWith('realm-1', undefined);
    });
  });
});