import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, TEST_ADMIN_API_KEY, type TestContext } from './setup';

describe('Admin CRUD API (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;

  const REALM_NAME = 'e2e-admin-realm';
  const API_KEY_HEADER = 'x-admin-api-key';

  /** Helper: perform an admin request with the API key set. */
  const adminRequest = () => request(app.getHttpServer());
  const withKey = (req: request.Test) =>
    req.set(API_KEY_HEADER, TEST_ADMIN_API_KEY);

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;

    // Ensure the realm does not already exist from a previous failed run
    await ctx.prisma.realm
      .delete({ where: { name: REALM_NAME } })
      .catch(() => {});
  });

  afterAll(async () => {
    // Final cleanup in case a test failed before the delete step
    await ctx.prisma.realm
      .delete({ where: { name: REALM_NAME } })
      .catch(() => {});
    await ctx.cleanup();
  });

  // ─── 401 WITHOUT API KEY ───────────────────────────────────

  describe('Authentication guard', () => {
    it('should return 401 when x-admin-api-key header is missing', async () => {
      await adminRequest()
        .get('/admin/realms')
        .expect(401);
    });

    it('should return 401 when x-admin-api-key header has wrong value', async () => {
      await adminRequest()
        .get('/admin/realms')
        .set(API_KEY_HEADER, 'wrong-api-key')
        .expect(401);
    });
  });

  // ─── REALMS ────────────────────────────────────────────────

  describe('Realms CRUD', () => {
    it('POST /admin/realms — should create a new realm', async () => {
      const res = await withKey(
        adminRequest()
          .post('/admin/realms')
          .send({
            name: REALM_NAME,
            displayName: 'E2E Admin Realm',
          }),
      ).expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('name', REALM_NAME);
      expect(res.body).toHaveProperty('displayName', 'E2E Admin Realm');
      expect(res.body).toHaveProperty('enabled', true);
    });

    it('POST /admin/realms — should return 409 for duplicate realm name', async () => {
      await withKey(
        adminRequest()
          .post('/admin/realms')
          .send({ name: REALM_NAME }),
      ).expect(409);
    });

    it('GET /admin/realms — should return all realms including the created one', async () => {
      const res = await withKey(
        adminRequest().get('/admin/realms'),
      ).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const found = res.body.find(
        (r: { name: string }) => r.name === REALM_NAME,
      );
      expect(found).toBeDefined();
      expect(found.displayName).toBe('E2E Admin Realm');
    });

    it('GET /admin/realms/:name — should return the realm by name', async () => {
      const res = await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}`),
      ).expect(200);

      expect(res.body).toHaveProperty('name', REALM_NAME);
      expect(res.body).toHaveProperty('displayName', 'E2E Admin Realm');
    });

    it('GET /admin/realms/:name — should return 404 for non-existent realm', async () => {
      await withKey(
        adminRequest().get('/admin/realms/does-not-exist'),
      ).expect(404);
    });

    it('PUT /admin/realms/:name — should update the realm', async () => {
      const res = await withKey(
        adminRequest()
          .put(`/admin/realms/${REALM_NAME}`)
          .send({ displayName: 'Updated E2E Realm' }),
      ).expect(200);

      expect(res.body).toHaveProperty('displayName', 'Updated E2E Realm');
    });
  });

  // ─── USERS ─────────────────────────────────────────────────

  describe('Users CRUD', () => {
    let createdUserId: string;

    it('POST /admin/realms/:name/users — should create a user', async () => {
      const res = await withKey(
        adminRequest()
          .post(`/admin/realms/${REALM_NAME}/users`)
          .send({
            username: 'e2e-user',
            email: 'e2e-user@example.com',
            firstName: 'E2E',
            lastName: 'User',
            password: 'SecurePass123!',
          }),
      ).expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('username', 'e2e-user');
      expect(res.body).toHaveProperty('email', 'e2e-user@example.com');
      createdUserId = res.body.id;
    });

    it('GET /admin/realms/:name/users — should return the created user', async () => {
      const res = await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}/users`),
      ).expect(200);

      expect(Array.isArray(res.body.users)).toBe(true);
      const found = res.body.users.find(
        (u: { username: string }) => u.username === 'e2e-user',
      );
      expect(found).toBeDefined();
      expect(found.email).toBe('e2e-user@example.com');
    });

    it('GET /admin/realms/:name/users/:id — should return a single user', async () => {
      const res = await withKey(
        adminRequest().get(
          `/admin/realms/${REALM_NAME}/users/${createdUserId}`,
        ),
      ).expect(200);

      expect(res.body).toHaveProperty('id', createdUserId);
      expect(res.body).toHaveProperty('username', 'e2e-user');
    });
  });

  // ─── CLIENTS ───────────────────────────────────────────────

  describe('Clients CRUD', () => {
    it('POST /admin/realms/:name/clients — should create a client', async () => {
      const res = await withKey(
        adminRequest()
          .post(`/admin/realms/${REALM_NAME}/clients`)
          .send({
            clientId: 'e2e-client',
            name: 'E2E Test Client',
            clientType: 'CONFIDENTIAL',
            redirectUris: ['http://localhost:4000/callback'],
            grantTypes: ['authorization_code', 'client_credentials'],
          }),
      ).expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('clientId', 'e2e-client');
      expect(res.body).toHaveProperty('clientSecret');
      expect(res.body.clientSecret).toBeTruthy();
    });

    it('GET /admin/realms/:name/clients — should return all clients', async () => {
      const res = await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}/clients`),
      ).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const found = res.body.find(
        (c: { clientId: string }) => c.clientId === 'e2e-client',
      );
      expect(found).toBeDefined();
    });
  });

  // ─── ROLES ─────────────────────────────────────────────────

  describe('Roles CRUD', () => {
    it('POST /admin/realms/:name/roles — should create a realm role', async () => {
      const res = await withKey(
        adminRequest()
          .post(`/admin/realms/${REALM_NAME}/roles`)
          .send({
            name: 'e2e-admin',
            description: 'E2E administrator role',
          }),
      ).expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('name', 'e2e-admin');
      expect(res.body).toHaveProperty('description', 'E2E administrator role');
    });

    it('GET /admin/realms/:name/roles — should return the created role', async () => {
      const res = await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}/roles`),
      ).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const found = res.body.find(
        (r: { name: string }) => r.name === 'e2e-admin',
      );
      expect(found).toBeDefined();
    });
  });

  // ─── ROLE ASSIGNMENT ───────────────────────────────────────

  describe('Role assignment', () => {
    it('should assign a realm role to a user', async () => {
      // First, get the user id
      const usersRes = await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}/users`),
      ).expect(200);

      const user = usersRes.body.users.find(
        (u: { username: string }) => u.username === 'e2e-user',
      );
      expect(user).toBeDefined();

      // Assign the role
      const res = await withKey(
        adminRequest()
          .post(
            `/admin/realms/${REALM_NAME}/users/${user.id}/role-mappings/realm`,
          )
          .send({ roleNames: ['e2e-admin'] }),
      ).expect(200);

      expect(res.body).toHaveProperty('assigned');
      expect(Array.isArray(res.body.assigned)).toBe(true);
      expect(res.body.assigned.length).toBeGreaterThanOrEqual(1);
    });

    it('should list the assigned realm roles for the user', async () => {
      // Get the user id
      const usersRes = await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}/users`),
      ).expect(200);

      const user = usersRes.body.users.find(
        (u: { username: string }) => u.username === 'e2e-user',
      );

      const res = await withKey(
        adminRequest().get(
          `/admin/realms/${REALM_NAME}/users/${user.id}/role-mappings/realm`,
        ),
      ).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const roleNames = res.body.map((r: { name: string }) => r.name);
      expect(roleNames).toContain('e2e-admin');
    });
  });

  // ─── CLEANUP: DELETE REALM ─────────────────────────────────

  describe('Realm deletion (cleanup)', () => {
    it('DELETE /admin/realms/:name — should delete the realm', async () => {
      await withKey(
        adminRequest().delete(`/admin/realms/${REALM_NAME}`),
      ).expect(204);

      // Verify it is gone
      await withKey(
        adminRequest().get(`/admin/realms/${REALM_NAME}`),
      ).expect(404);
    });
  });
});
