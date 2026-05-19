import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  createTestApp,
  TEST_ADMIN_API_KEY,
  type SeededRealm,
  type TestContext,
} from './setup';

describe('User Management API (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;

  const REALM_NAME = 'e2e-user-mgmt-realm';
  const API_KEY_HEADER = 'x-admin-api-key';

  /** Helper: perform a request against the running app. */
  const adminRequest = () => request(app.getHttpServer());
  /** Helper: attach the admin API key to a request. */
  const withKey = (req: request.Test) =>
    req.set(API_KEY_HEADER, TEST_ADMIN_API_KEY);

  // State shared across ordered tests
  let createdUserId: string;
  let createdRoleId: string;
  let createdGroupId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    seeded = await ctx.seedTestRealm(REALM_NAME);
  }, 30_000);

  afterAll(async () => {
    await ctx.prisma.realm
      .delete({ where: { name: REALM_NAME } })
      .catch(() => {});
    await ctx.cleanup();
  });

  // ─── 1. CREATE USER ───────────────────────────────────────

  it('POST /admin/realms/:name/users — should create a new user', async () => {
    const res = await withKey(
      adminRequest()
        .post(`/admin/realms/${REALM_NAME}/users`)
        .send({
          username: 'mgmt-user',
          email: 'mgmt-user@example.com',
          firstName: 'Management',
          lastName: 'User',
          password: 'MgmtPass123!',
        }),
    ).expect(201);

    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('username', 'mgmt-user');
    expect(res.body).toHaveProperty('email', 'mgmt-user@example.com');
    expect(res.body).toHaveProperty('firstName', 'Management');
    expect(res.body).toHaveProperty('lastName', 'User');
    createdUserId = res.body.id;
  });

  // ─── 2. LIST USERS ────────────────────────────────────────

  it('GET /admin/realms/:name/users — should return array containing created user', async () => {
    const res = await withKey(
      adminRequest().get(`/admin/realms/${REALM_NAME}/users`),
    ).expect(200);

    // The service returns { users, total }
    expect(res.body).toHaveProperty('users');
    expect(Array.isArray(res.body.users)).toBe(true);
    const found = res.body.users.find(
      (u: { username: string }) => u.username === 'mgmt-user',
    );
    expect(found).toBeDefined();
    expect(found.email).toBe('mgmt-user@example.com');
  });

  // ─── 3. GET USER BY ID ────────────────────────────────────

  it('GET /admin/realms/:name/users/:id — should return the user', async () => {
    const res = await withKey(
      adminRequest().get(
        `/admin/realms/${REALM_NAME}/users/${createdUserId}`,
      ),
    ).expect(200);

    expect(res.body).toHaveProperty('id', createdUserId);
    expect(res.body).toHaveProperty('username', 'mgmt-user');
    expect(res.body).toHaveProperty('email', 'mgmt-user@example.com');
  });

  // ─── 4. UPDATE USER ───────────────────────────────────────

  it('PUT /admin/realms/:name/users/:id — should update firstName', async () => {
    const res = await withKey(
      adminRequest()
        .put(`/admin/realms/${REALM_NAME}/users/${createdUserId}`)
        .send({ firstName: 'UpdatedFirst' }),
    ).expect(200);

    expect(res.body).toHaveProperty('firstName', 'UpdatedFirst');
    expect(res.body).toHaveProperty('id', createdUserId);
  });

  // ─── 5. SEARCH USERS BY USERNAME ──────────────────────────

  it('GET /admin/realms/:name/users — listing should include the user by username', async () => {
    // The API does not support a `search` query parameter, so we list all
    // users and verify our created user is present.
    const res = await withKey(
      adminRequest().get(`/admin/realms/${REALM_NAME}/users`),
    ).expect(200);

    expect(res.body).toHaveProperty('users');
    const found = res.body.users.find(
      (u: { username: string }) => u.username === 'mgmt-user',
    );
    expect(found).toBeDefined();
    expect(found.id).toBe(createdUserId);
  });

  // ─── 6. RESET PASSWORD ────────────────────────────────────

  it('PUT /admin/realms/:name/users/:id/reset-password — should reset password', async () => {
    await withKey(
      adminRequest()
        .put(`/admin/realms/${REALM_NAME}/users/${createdUserId}/reset-password`)
        .send({ password: 'NewPass456!' }),
    ).expect(204);
  });

  // ─── 7. OLD PASSWORD FAILS AFTER RESET ────────────────────

  it('password grant with old password should fail after reset', async () => {
    const res = await adminRequest()
      .post(`/realms/${REALM_NAME}/protocol/openid-connect/token`)
      .send({
        grant_type: 'password',
        client_id: 'test-client',
        client_secret: 'test-client-secret',
        username: 'mgmt-user',
        password: 'MgmtPass123!',
      });

    // Should fail — either 401 or 400 depending on implementation
    expect([400, 401]).toContain(res.status);
  });

  // ─── 8. NEW PASSWORD WORKS AFTER RESET ────────────────────

  it('password grant with new password should succeed after reset', async () => {
    const res = await adminRequest()
      .post(`/realms/${REALM_NAME}/protocol/openid-connect/token`)
      .send({
        grant_type: 'password',
        client_id: 'test-client',
        client_secret: 'test-client-secret',
        username: 'mgmt-user',
        password: 'NewPass456!',
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('access_token');
    expect(res.body).toHaveProperty('refresh_token');
  });

  // ─── 9. CREATE REALM ROLE ─────────────────────────────────

  it('POST /admin/realms/:name/roles — should create a realm role', async () => {
    const res = await withKey(
      adminRequest()
        .post(`/admin/realms/${REALM_NAME}/roles`)
        .send({
          name: 'mgmt-role',
          description: 'Role for user-management E2E tests',
        }),
    ).expect(201);

    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('name', 'mgmt-role');
    expect(res.body).toHaveProperty(
      'description',
      'Role for user-management E2E tests',
    );
    createdRoleId = res.body.id;
  });

  // ─── 10. ASSIGN REALM ROLE TO USER ────────────────────────

  it('POST /admin/realms/:name/users/:id/role-mappings/realm — should assign role', async () => {
    const res = await withKey(
      adminRequest()
        .post(
          `/admin/realms/${REALM_NAME}/users/${createdUserId}/role-mappings/realm`,
        )
        .send({ roleNames: ['mgmt-role'] }),
    ).expect(200);

    // Role assignment is an update operation (HTTP 200, not 201) and the
    // service returns { assigned: string[] } listing the roles applied.
    expect(Array.isArray(res.body.assigned)).toBe(true);
    expect(res.body.assigned.length).toBeGreaterThanOrEqual(1);
  });

  // ─── 11. GET USER REALM ROLES ─────────────────────────────

  it('GET /admin/realms/:name/users/:id/role-mappings/realm — should include assigned role', async () => {
    const res = await withKey(
      adminRequest().get(
        `/admin/realms/${REALM_NAME}/users/${createdUserId}/role-mappings/realm`,
      ),
    ).expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    const roleNames = res.body.map((r: { name: string }) => r.name);
    expect(roleNames).toContain('mgmt-role');
  });

  // ─── 12. CREATE GROUP ─────────────────────────────────────

  it('POST /admin/realms/:name/groups — should create a group', async () => {
    const res = await withKey(
      adminRequest()
        .post(`/admin/realms/${REALM_NAME}/groups`)
        .send({ name: 'test-group' }),
    ).expect(201);

    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('name', 'test-group');
    createdGroupId = res.body.id;
  });

  // ─── 13. ADD USER TO GROUP ────────────────────────────────

  it('PUT /admin/realms/:name/users/:id/groups/:groupId — should add user to group', async () => {
    await withKey(
      adminRequest().put(
        `/admin/realms/${REALM_NAME}/users/${createdUserId}/groups/${createdGroupId}`,
      ),
    ).expect(200);
  });

  // ─── 14. GET USER GROUPS ──────────────────────────────────

  it('GET /admin/realms/:name/users/:id/groups — should include the group', async () => {
    const res = await withKey(
      adminRequest().get(
        `/admin/realms/${REALM_NAME}/users/${createdUserId}/groups`,
      ),
    ).expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    const groupNames = res.body.map((g: { name: string }) => g.name);
    expect(groupNames).toContain('test-group');
  });

  // ─── 15. DELETE USER ──────────────────────────────────────

  it('DELETE /admin/realms/:name/users/:id — should delete the user', async () => {
    await withKey(
      adminRequest().delete(
        `/admin/realms/${REALM_NAME}/users/${createdUserId}`,
      ),
    ).expect(204);

    // Verify user is gone
    await withKey(
      adminRequest().get(
        `/admin/realms/${REALM_NAME}/users/${createdUserId}`,
      ),
    ).expect(404);
  });
});
