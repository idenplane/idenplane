import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, TEST_ADMIN_API_KEY, type TestContext } from './setup';

describe('Realm lifecycle management (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;

  const REALM_NAME = 'e2e-realm-lifecycle';
  const IMPORTED_REALM_NAME = 'e2e-imported-realm';
  const API_KEY_HEADER = 'x-admin-api-key';

  /** Helper: perform an admin request with the API key set. */
  const adminRequest = () => request(app.getHttpServer());
  const withKey = (req: request.Test) =>
    req.set(API_KEY_HEADER, TEST_ADMIN_API_KEY);

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;

    // Ensure the realms do not already exist from a previous failed run
    await ctx.prisma.realm
      .delete({ where: { name: REALM_NAME } })
      .catch(() => {});
    await ctx.prisma.realm
      .delete({ where: { name: IMPORTED_REALM_NAME } })
      .catch(() => {});
  });

  afterAll(async () => {
    // Final cleanup in case a test failed before the delete steps
    await ctx.prisma.realm
      .delete({ where: { name: REALM_NAME } })
      .catch(() => {});
    await ctx.prisma.realm
      .delete({ where: { name: IMPORTED_REALM_NAME } })
      .catch(() => {});
    await ctx.cleanup();
  });

  // ─── CREATE REALM ─────────────────────────────────────────

  describe('Create realm', () => {
    it('POST /admin/realms — should create a new realm', async () => {
      const res = await withKey(
        adminRequest()
          .post('/admin/realms')
          .send({
            name: REALM_NAME,
            displayName: 'Lifecycle Test',
          }),
      ).expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('name', REALM_NAME);
      expect(res.body).toHaveProperty('displayName', 'Lifecycle Test');
      expect(res.body).toHaveProperty('enabled', true);
    });
  });

  // ─── GET REALM ────────────────────────────────────────────

  describe('Get realm', () => {
    it('GET /admin/realms/:name — should return the realm by name', async () => {
      const res = await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}`),
      ).expect(200);

      expect(res.body).toHaveProperty('name', REALM_NAME);
      expect(res.body).toHaveProperty('displayName', 'Lifecycle Test');
    });
  });

  // ─── UPDATE REALM SETTINGS ────────────────────────────────

  describe('Update realm settings', () => {
    it('PUT /admin/realms/:name — should update display name and token lifespans', async () => {
      const res = await withKey(
        adminRequest()
          .put(`/admin/realms/${REALM_NAME}`)
          .send({
            displayName: 'Updated Lifecycle',
            accessTokenLifespan: 600,
            refreshTokenLifespan: 7200,
          }),
      ).expect(200);

      expect(res.body).toHaveProperty('displayName', 'Updated Lifecycle');
      expect(res.body).toHaveProperty('accessTokenLifespan', 600);
      expect(res.body).toHaveProperty('refreshTokenLifespan', 7200);
    });
  });

  // ─── VERIFY UPDATED SETTINGS ──────────────────────────────

  describe('Verify updated settings', () => {
    it('GET /admin/realms/:name — should reflect the updated values', async () => {
      const res = await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}`),
      ).expect(200);

      expect(res.body).toHaveProperty('displayName', 'Updated Lifecycle');
      expect(res.body).toHaveProperty('accessTokenLifespan', 600);
      expect(res.body).toHaveProperty('refreshTokenLifespan', 7200);
    });
  });

  // ─── UPDATE PASSWORD POLICY ───────────────────────────────

  describe('Update password policy', () => {
    it('PUT /admin/realms/:name — should update password policy fields', async () => {
      const res = await withKey(
        adminRequest()
          .put(`/admin/realms/${REALM_NAME}`)
          .send({
            passwordMinLength: 12,
            passwordRequireUppercase: true,
            passwordRequireDigits: true,
          }),
      ).expect(200);

      expect(res.body).toHaveProperty('passwordMinLength', 12);
      expect(res.body).toHaveProperty('passwordRequireUppercase', true);
      expect(res.body).toHaveProperty('passwordRequireDigits', true);
    });
  });

  // ─── LIST REALMS ──────────────────────────────────────────

  describe('List realms', () => {
    it('GET /admin/realms — should include the created realm', async () => {
      const res = await withKey(
        adminRequest().get('/admin/realms'),
      ).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const found = res.body.find(
        (r: { name: string }) => r.name === REALM_NAME,
      );
      expect(found).toBeDefined();
      expect(found.displayName).toBe('Updated Lifecycle');
    });
  });

  // ─── EXPORT REALM ─────────────────────────────────────────

  describe('Export realm', () => {
    it('GET /admin/realms/:name/export — should export realm properties', async () => {
      const res = await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}/export`),
      ).expect(200);

      expect(res.body).toHaveProperty('version');
      expect(res.body).toHaveProperty('realm');
      expect(res.body.realm).toHaveProperty('name', REALM_NAME);
      expect(res.body.realm).toHaveProperty('displayName', 'Updated Lifecycle');
    });

    it('GET /admin/realms/:name/export?includeUsers=true — should export realm with users section', async () => {
      const res = await withKey(
        adminRequest().get(
          `/admin/realms/${REALM_NAME}/export?includeUsers=true`,
        ),
      ).expect(200);

      expect(res.body).toHaveProperty('version');
      expect(res.body).toHaveProperty('realm');
      expect(res.body.realm).toHaveProperty('name', REALM_NAME);
      // The users key should be present (possibly empty array since no users were created)
      expect(res.body).toHaveProperty('users');
      expect(Array.isArray(res.body.users)).toBe(true);
    });
  });

  // ─── IMPORT REALM ─────────────────────────────────────────

  describe('Import realm', () => {
    it('POST /admin/realms/import — should create a realm via import', async () => {
      const importPayload = {
        version: '1.0',
        realm: {
          name: IMPORTED_REALM_NAME,
          displayName: 'Imported',
          enabled: true,
        },
      };

      const res = await withKey(
        adminRequest()
          .post('/admin/realms/import')
          .send(importPayload),
      ).expect(201);

      expect(res.body).toHaveProperty('realmName', IMPORTED_REALM_NAME);
    });
  });

  // ─── VERIFY IMPORTED REALM ────────────────────────────────

  describe('Verify imported realm', () => {
    it('GET /admin/realms/:name — should return the imported realm', async () => {
      const res = await withKey(
        adminRequest().get(`/admin/realms/${IMPORTED_REALM_NAME}`),
      ).expect(200);

      expect(res.body).toHaveProperty('name', IMPORTED_REALM_NAME);
      expect(res.body).toHaveProperty('displayName', 'Imported');
      expect(res.body).toHaveProperty('enabled', true);
    });
  });

  // ─── DELETE IMPORTED REALM ────────────────────────────────

  describe('Delete imported realm', () => {
    it('DELETE /admin/realms/:name — should delete the imported realm', async () => {
      await withKey(
        adminRequest().delete(`/admin/realms/${IMPORTED_REALM_NAME}`),
      ).expect(204);
    });
  });

  // ─── DELETE MAIN REALM ────────────────────────────────────

  describe('Delete main realm', () => {
    it('DELETE /admin/realms/:name — should delete the lifecycle realm', async () => {
      await withKey(
        adminRequest().delete(`/admin/realms/${REALM_NAME}`),
      ).expect(204);
    });
  });

  // ─── DELETED REALM RETURNS 404 ────────────────────────────

  describe('Deleted realm returns 404', () => {
    it('GET /admin/realms/:name — should return 404 for the deleted realm', async () => {
      await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}`),
      ).expect(404);
    });
  });
});
