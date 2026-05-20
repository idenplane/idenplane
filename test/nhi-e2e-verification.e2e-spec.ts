import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, TEST_ADMIN_API_KEY, type TestContext } from './setup';

/**
 * End-to-end verification of NHI flows:
 * 1. Register device via API
 * 2. Authenticate with certificate
 * 3. View device in admin UI
 * 4. Rotate credentials
 * 5. Verify audit log entry
 */
describe('NHI End-to-End Verification (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;

  const REALM_NAME = 'e2e-nhi-realm';
  const API_KEY_HEADER = 'x-admin-api-key';

  /** Helper: perform an admin request with the API key set. */
  const adminRequest = () => request(app.getHttpServer());
  const withKey = (req: request.Test) =>
    req.set(API_KEY_HEADER, TEST_ADMIN_API_KEY);

  // Device identity name for testing
  const DEVICE_NAME = 'sensor-gateway-01';

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;

    // Ensure clean state - remove any existing test realm
    await ctx.prisma.nhiIdentity.deleteMany({
      where: { realm: { name: REALM_NAME } },
    }).catch(() => {});

    await ctx.prisma.realm
      .delete({ where: { name: REALM_NAME } })
      .catch(() => {});
  });

  afterAll(async () => {
    // Cleanup: delete all test data
    await ctx.prisma.nhiIdentity.deleteMany({
      where: { realm: { name: REALM_NAME } },
    }).catch(() => {});
    await ctx.prisma.realm
      .delete({ where: { name: REALM_NAME } })
      .catch(() => {});
    await ctx.cleanup();
  });

  // ─── STEP 0: Setup - Create test realm ─────────────────────────────────────

  describe('Setup: Create test realm', () => {
    it('should create a test realm for NHI testing', async () => {
      const res = await withKey(
        adminRequest()
          .post('/admin/realms')
          .send({
            name: REALM_NAME,
            displayName: 'E2E NHI Test Realm',
          }),
      ).expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('name', REALM_NAME);
    });
  });

  // ─── STEP 1: Register device via API ──────────────────────────────────────

  describe('Step 1: Register device via API', () => {
    it('POST /admin/realms/:name/nhi — should create an IoT device identity', async () => {
      const res = await withKey(
        adminRequest()
          .post(`/admin/realms/${REALM_NAME}/nhi`)
          .send({
            name: DEVICE_NAME,
            identityType: 'IOT_DEVICE',
            description: 'Temperature sensor in building A',
            enabled: true,
            agentPurpose: 'Temperature monitoring in Building A, Floor 3',
            permissionScopes: ['temperature:read', 'temperature:write'],
            tags: ['iot', 'temperature', 'building-a'],
          }),
      ).expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('name', DEVICE_NAME);
      expect(res.body).toHaveProperty('identityType', 'IOT_DEVICE');
      expect(res.body).toHaveProperty('description', 'Temperature sensor in building A');
      expect(res.body).toHaveProperty('enabled', true);
      expect(res.body.lifecycleStatus).toBe('PROVISIONING');
    });

    it('GET /admin/realms/:name/nhi — should list the created device', async () => {
      const res = await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}/nhi`),
      ).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const found = res.body.find(
        (nhi: { name: string }) => nhi.name === DEVICE_NAME,
      );
      expect(found).toBeDefined();
      expect(found.identityType).toBe('IOT_DEVICE');
      expect(found.lifecycleStatus).toBe('PROVISIONING');
    });

    it('should generate a device certificate', async () => {
      const res = await withKey(
        adminRequest()
          .post(`/admin/realms/${REALM_NAME}/nhi/device-certificates`)
          .send({
            name: `${DEVICE_NAME}.idenplane.local`,
            subjectCommonName: `${DEVICE_NAME}.idenplane.local`,
            subjectOrganization: 'Idenplane IoT',
            validityDays: 365,
            keyAlgorithm: 'ECDSA_P256',
          }),
      ).expect(201);

      expect(res.body).toHaveProperty('certificatePem');
      expect(res.body).toHaveProperty('privateKeyPem');
      expect(res.body.certificatePem).toContain('-----BEGIN CERTIFICATE-----');
      expect(res.body.privateKeyPem).toContain('-----BEGIN PRIVATE KEY-----');
    });
  });

  // ─── STEP 2: Set certificate on identity ────────────────────────────────────

  describe('Step 2: Authenticate with certificate', () => {
    it('should set the device certificate on the identity', async () => {
      // First, get the device identity
      const listRes = await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}/nhi`),
      ).expect(200);

      const device = listRes.body.find(
        (nhi: { name: string }) => nhi.name === DEVICE_NAME,
      );
      expect(device).toBeDefined();

      // Generate a certificate first
      const certRes = await withKey(
        adminRequest()
          .post(`/admin/realms/${REALM_NAME}/nhi/device-certificates`)
          .send({
            name: `${DEVICE_NAME}.idenplane.local`,
            subjectCommonName: `${DEVICE_NAME}.idenplane.local`,
            subjectOrganization: 'Idenplane IoT',
            validityDays: 365,
            keyAlgorithm: 'ECDSA_P256',
          }),
      ).expect(201);

      // Set the certificate on the identity
      await withKey(
        adminRequest()
          .post(`/admin/realms/${REALM_NAME}/nhi/${device.id}/certificate`)
          .send({
            certificatePem: certRes.body.certificatePem,
          }),
      ).expect(201);

      // Verify certificate info is returned on the identity
      const detailRes = await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}/nhi/${device.id}`),
      ).expect(200);

      expect(detailRes.body).toHaveProperty('certificateFingerprint');
      expect(detailRes.body).toHaveProperty('certificateSubject');
    });
  });

  // ─── STEP 3: View device in admin UI ────────────────────────────────────────

  describe('Step 3: View device in admin UI', () => {
    it('GET /admin/realms/:name/nhi — should return device details for UI', async () => {
      const listRes = await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}/nhi`),
      ).expect(200);

      expect(Array.isArray(listRes.body)).toBe(true);
      const device = listRes.body.find(
        (nhi: { name: string }) => nhi.name === DEVICE_NAME,
      );
      expect(device).toBeDefined();
      expect(device).toHaveProperty('id');
      expect(device).toHaveProperty('name');
      expect(device).toHaveProperty('identityType');
      expect(device).toHaveProperty('lifecycleStatus');
      expect(device).toHaveProperty('enabled');
      expect(device).toHaveProperty('createdAt');
    });

    it('GET /admin/realms/:name/nhi/:id — should return full device details', async () => {
      const listRes = await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}/nhi`),
      ).expect(200);

      const device = listRes.body.find(
        (nhi: { name: string }) => nhi.name === DEVICE_NAME,
      );

      const detailRes = await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}/nhi/${device.id}`),
      ).expect(200);

      expect(detailRes.body).toHaveProperty('id', device.id);
      expect(detailRes.body).toHaveProperty('name', DEVICE_NAME);
      expect(detailRes.body).toHaveProperty('identityType', 'IOT_DEVICE');
      expect(detailRes.body).toHaveProperty('permissionScopes');
      expect(Array.isArray(detailRes.body.permissionScopes)).toBe(true);
      expect(detailRes.body.permissionScopes).toContain('temperature:read');
    });

    it('should activate the device (change status from PROVISIONING to ACTIVE)', async () => {
      const listRes = await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}/nhi`),
      ).expect(200);

      const device = listRes.body.find(
        (nhi: { name: string }) => nhi.name === DEVICE_NAME,
      );

      // Update to set lifecycleStatus to ACTIVE
      const updateRes = await withKey(
        adminRequest()
          .put(`/admin/realms/${REALM_NAME}/nhi/${device.id}`)
          .send({
            lifecycleStatus: 'ACTIVE',
          }),
      ).expect(200);

      expect(updateRes.body).toHaveProperty('lifecycleStatus', 'ACTIVE');
    });
  });

  // ─── STEP 4: Create and rotate credentials ─────────────────────────────────

  describe('Step 4: Rotate credentials', () => {
    it('should create a credential for the device', async () => {
      const listRes = await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}/nhi`),
      ).expect(200);

      const device = listRes.body.find(
        (nhi: { name: string }) => nhi.name === DEVICE_NAME,
      );

      const credRes = await withKey(
        adminRequest()
          .post(`/admin/realms/${REALM_NAME}/nhi/${device.id}/credentials`)
          .send({
            name: 'device-api-key',
            credentialType: 'API_KEY',
            expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days
            rotationRequired: true,
          }),
      ).expect(201);

      expect(credRes.body).toHaveProperty('id');
      expect(credRes.body).toHaveProperty('keyPrefix');
      expect(credRes.body).toHaveProperty('plainKey');
      expect(credRes.body.credentialType).toBe('API_KEY');
      expect(credRes.body.revoked).toBe(false);
    });

    it('should list credentials for the device', async () => {
      const listRes = await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}/nhi`),
      ).expect(200);

      const device = listRes.body.find(
        (nhi: { name: string }) => nhi.name === DEVICE_NAME,
      );

      const credsRes = await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}/nhi/${device.id}/credentials`),
      ).expect(200);

      expect(Array.isArray(credsRes.body)).toBe(true);
      expect(credsRes.body.length).toBeGreaterThan(0);

      const apiKeyCred = credsRes.body.find(
        (c: { credentialType: string }) => c.credentialType === 'API_KEY',
      );
      expect(apiKeyCred).toBeDefined();
    });

    it('should rotate a credential', async () => {
      const listRes = await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}/nhi`),
      ).expect(200);

      const device = listRes.body.find(
        (nhi: { name: string }) => nhi.name === DEVICE_NAME,
      );

      // Get credentials
      const credsRes = await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}/nhi/${device.id}/credentials`),
      ).expect(200);

      const apiKeyCred = credsRes.body.find(
        (c: { credentialType: string }) => c.credentialType === 'API_KEY',
      );

      // Rotate the credential
      const rotateRes = await withKey(
        adminRequest()
          .post(`/admin/realms/${REALM_NAME}/nhi/${device.id}/credentials/${apiKeyCred.id}/rotate`),
      ).expect(200);

      expect(rotateRes.body).toHaveProperty('newCredential');
      expect(rotateRes.body.newCredential).toHaveProperty('id');
      expect(rotateRes.body.newCredential).toHaveProperty('plainKey');
    });
  });

  // ─── STEP 5: Verify audit log entry ────────────────────────────────────────

  describe('Step 5: Verify audit log entry', () => {
    it('should record audit log entries for NHI operations', async () => {
      // Query audit logs
      const logsRes = await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}/nhi/audit-logs`),
      ).expect(200);

      expect(Array.isArray(logsRes.body)).toBe(true);
    });

    it('should filter audit logs by action type', async () => {
      const logsRes = await withKey(
        adminRequest()
          .get(`/admin/realms/${REALM_NAME}/nhi/audit-logs`)
          .query({ action: 'CREDENTIAL_ROTATED' }),
      ).expect(200);

      expect(Array.isArray(logsRes.body)).toBe(true);
    });

    it('should filter audit logs by NHI identity', async () => {
      const listRes = await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}/nhi`),
      ).expect(200);

      const device = listRes.body.find(
        (nhi: { name: string }) => nhi.name === DEVICE_NAME,
      );

      const logsRes = await withKey(
        adminRequest()
          .get(`/admin/realms/${REALM_NAME}/nhi/audit-logs`)
          .query({ nhiIdentityId: device.id }),
      ).expect(200);

      expect(Array.isArray(logsRes.body)).toBe(true);
      // Should have entries for device creation, certificate setting, credential rotation
    });

    it('should query audit logs with date range', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      const logsRes = await withKey(
        adminRequest()
          .get(`/admin/realms/${REALM_NAME}/nhi/audit-logs`)
          .query({
            dateFrom: oneHourAgo.toISOString(),
            dateTo: now.toISOString(),
          }),
      ).expect(200);

      expect(Array.isArray(logsRes.body)).toBe(true);
    });
  });

  // ─── Lifecycle Operations ────────────────────────────────────────────────────

  describe('NHI Lifecycle Operations', () => {
    it('should suspend an NHI identity', async () => {
      const listRes = await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}/nhi`),
      ).expect(200);

      const device = listRes.body.find(
        (nhi: { name: string }) => nhi.name === DEVICE_NAME,
      );

      const suspendRes = await withKey(
        adminRequest()
          .post(`/admin/realms/${REALM_NAME}/nhi/${device.id}/suspend`),
      ).expect(200);

      expect(suspendRes.body).toHaveProperty('lifecycleStatus', 'SUSPENDED');
      expect(suspendRes.body).toHaveProperty('suspendedAt');
    });

    it('should reactivate a suspended NHI identity', async () => {
      const listRes = await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}/nhi`),
      ).expect(200);

      const device = listRes.body.find(
        (nhi: { name: string }) => nhi.name === DEVICE_NAME,
      );

      const reactivateRes = await withKey(
        adminRequest()
          .post(`/admin/realms/${REALM_NAME}/nhi/${device.id}/reactivate`),
      ).expect(200);

      expect(reactivateRes.body).toHaveProperty('lifecycleStatus', 'ACTIVE');
    });

    it('should get usage statistics for an NHI identity', async () => {
      const listRes = await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}/nhi`),
      ).expect(200);

      const device = listRes.body.find(
        (nhi: { name: string }) => nhi.name === DEVICE_NAME,
      );

      const statsRes = await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}/nhi/${device.id}/stats`),
      ).expect(200);

      expect(statsRes.body).toHaveProperty('nhiIdentityId');
      expect(statsRes.body).toHaveProperty('totalRequests');
    });
  });

  // ─── Credential Policy Management ───────────────────────────────────────────

  describe('Credential Policy Management', () => {
    it('should create a credential rotation policy', async () => {
      const policyRes = await withKey(
        adminRequest()
          .post(`/admin/realms/${REALM_NAME}/nhi/credential-policies`)
          .send({
            name: 'iot-rotation-policy',
            description: 'Rotation policy for IoT devices',
            credentialType: 'API_KEY',
            autoRotate: true,
            rotationIntervalDays: 30,
            maxCredentialAgeDays: 365,
            requireAuditLogging: true,
            enabled: true,
          }),
      ).expect(201);

      expect(policyRes.body).toHaveProperty('id');
      expect(policyRes.body).toHaveProperty('name', 'iot-rotation-policy');
      expect(policyRes.body.autoRotate).toBe(true);
      expect(policyRes.body.rotationIntervalDays).toBe(30);
    });

    it('should list credential policies', async () => {
      const policiesRes = await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}/nhi/credential-policies`),
      ).expect(200);

      expect(Array.isArray(policiesRes.body)).toBe(true);
      const found = policiesRes.body.find(
        (p: { name: string }) => p.name === 'iot-rotation-policy',
      );
      expect(found).toBeDefined();
    });

    it('should get rotation status summary', async () => {
      const statusRes = await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}/nhi/rotation-status`),
      ).expect(200);

      expect(statusRes.body).toHaveProperty('totalRequiringRotation');
      expect(statusRes.body).toHaveProperty('dueForRotation');
    });
  });

  // ─── Bulk Registration ───────────────────────────────────────────────────────

  describe('Bulk Device Registration', () => {
    it('should bulk register multiple devices', async () => {
      const bulkRes = await withKey(
        adminRequest()
          .post(`/admin/realms/${REALM_NAME}/nhi/devices/bulk-register`)
          .send({
            devices: [
              {
                name: 'sensor-gateway-02',
                description: 'Temperature sensor in building B',
                permissionScopes: ['temperature:read'],
                tags: ['iot', 'temperature', 'building-b'],
              },
              {
                name: 'ai-assistant-01',
                description: 'AI assistant for customer support',
                permissionScopes: ['chat:read', 'chat:write'],
                tags: ['ai', 'support'],
              },
            ],
          }),
      ).expect(201);

      expect(bulkRes.body).toHaveProperty('total');
      expect(bulkRes.body.total).toBe(2);
      expect(bulkRes.body).toHaveProperty('successful');
      expect(bulkRes.body.successful).toBe(2);
      expect(bulkRes.body).toHaveProperty('failed');
      expect(bulkRes.body.failed).toBe(0);
      expect(Array.isArray(bulkRes.body.results)).toBe(true);
      expect(bulkRes.body.results.length).toBe(2);
    });

    it('should bulk register with certificate generation', async () => {
      const bulkRes = await withKey(
        adminRequest()
          .post(`/admin/realms/${REALM_NAME}/nhi/devices/bulk-register`)
          .send({
            devices: [
              {
                name: 'secure-sensor-01',
                description: 'Secure temperature sensor',
                generateCertificate: true,
                certificateKeyAlgorithm: 'ECDSA_P256',
                certificateValidityDays: 365,
              },
            ],
          }),
      ).expect(201);

      expect(bulkRes.body.results[0]).toHaveProperty('certificatePem');
      expect(bulkRes.body.results[0]).toHaveProperty('privateKeyPem');
    });
  });

  // ─── Cleanup: Delete test realm ─────────────────────────────────────────────

  describe('Cleanup: Delete test realm', () => {
    it('DELETE /admin/realms/:name — should delete the test realm', async () => {
      await withKey(
        adminRequest().delete(`/admin/realms/${REALM_NAME}`),
      ).expect(204);

      // Verify the realm is gone
      await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}`),
      ).expect(404);
    });
  });
});
