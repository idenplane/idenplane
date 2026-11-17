import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, TEST_ADMIN_API_KEY, type TestContext } from './setup';

/**
 * A full provisioning cycle as Microsoft Entra ID runs it, over
 * `application/scim+json`: look up by userName, create, patch with
 * capitalised op names and paths, deactivate with "False", delete. Plus the
 * group member operations Entra ID and Okta send, and the security rule
 * that deactivating a user through SCIM ends their sessions.
 */
describe('SCIM provisioning cycle (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let scimToken: string;

  const REALM = 'e2e-scim-provisioning';
  const BASE = `/scim/v2/${REALM}`;
  const TOKEN_URL = `/realms/${REALM}/protocol/openid-connect/token`;
  const CLIENT_ID = 'test-client';
  const CLIENT_SECRET = 'test-client-secret';
  const USER_PASSWORD = 'Scim-dummy-password-123!';

  const SCIM_JSON = 'application/scim+json';
  const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
  const ENTERPRISE =
    'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
  const GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
  const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
  const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
  const ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';

  const http = () => request(app.getHttpServer());

  /** A SCIM request with the client's media type and bearer token. */
  const scim = (
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    body?: unknown,
  ) => {
    const req = http()
      [method](`${BASE}${path}`)
      .set('Authorization', `Bearer ${scimToken}`)
      .set('Accept', SCIM_JSON);
    return body === undefined
      ? req
      : req.set('Content-Type', SCIM_JSON).send(JSON.stringify(body));
  };

  const patchOp = (...Operations: unknown[]) => ({
    schemas: [PATCH_SCHEMA],
    Operations,
  });

  const entraUser = (userName: string) => ({
    schemas: [USER_SCHEMA, ENTERPRISE],
    externalId: `${userName}-object-id`,
    userName,
    active: true,
    displayName: 'Ada Lovelace',
    title: 'Engineer',
    preferredLanguage: 'en-GB',
    emails: [{ primary: true, type: 'work', value: `${userName}@example.com` }],
    name: {
      formatted: 'Ada Lovelace',
      familyName: 'Lovelace',
      givenName: 'Ada',
    },
    phoneNumbers: [{ type: 'mobile', value: '+44 20 7946 0000' }],
    [ENTERPRISE]: { department: 'Research', employeeNumber: '1815' },
  });

  const signIn = async (username: string) =>
    (
      await http()
        .post(TOKEN_URL)
        .type('form')
        .send({
          grant_type: 'password',
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          username,
          password: USER_PASSWORD,
          scope: 'openid',
        })
        .expect(200)
    ).body as { access_token: string; refresh_token: string };

  const refresh = (refreshToken: string) =>
    http().post(TOKEN_URL).type('form').send({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
    });

  const introspect = async (token: string) =>
    (
      (
        await http()
          .post(`${TOKEN_URL}/introspect`)
          .type('form')
          .send({ token, client_id: CLIENT_ID, client_secret: CLIENT_SECRET })
          .expect(200)
      ).body as { active: boolean }
    ).active;

  const setPassword = (userId: string) =>
    http()
      .put(`/admin/realms/${REALM}/users/${userId}/reset-password`)
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .send({ password: USER_PASSWORD })
      .expect(204);

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app as INestApplication<App>;
    await ctx.seedTestRealm(REALM);

    await http()
      .patch(`/admin/realms/${REALM}`)
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .send({ scimEnabled: true })
      .expect(200);

    const res = await http()
      .post(`/admin/realms/${REALM}/scim/tokens`)
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .send({ name: 'e2e-entra' })
      .expect(201);
    scimToken = res.body.token as string;
  }, 30_000);

  afterAll(async () => {
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
  });

  it('serves discovery under the realm base URL', async () => {
    const config = await http()
      .get(`${BASE}/ServiceProviderConfig`)
      .expect(200);
    expect(config.body.schemas).toEqual([
      'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig',
    ]);
    expect(config.body.patch).toEqual({ supported: true });
    expect(config.body.changePassword).toEqual({ supported: true });

    const schemas = await http().get(`${BASE}/Schemas`).expect(200);
    expect(schemas.body.schemas).toEqual([LIST_SCHEMA]);
    expect(
      (schemas.body.Resources as Array<{ id: string }>).map((s) => s.id),
    ).toEqual(expect.arrayContaining([USER_SCHEMA, GROUP_SCHEMA]));
  });

  it('refuses a repeated filter or attributes parameter with 400, not 500', async () => {
    const twice = await scim(
      'get',
      `/Users?filter=${encodeURIComponent('userName eq "a"')}&filter=${encodeURIComponent('userName eq "b"')}`,
    ).expect(400);
    expect(twice.body).toMatchObject({
      scimType: 'invalidFilter',
      status: '400',
    });

    const attrs = await scim(
      'get',
      '/Users?attributes=userName&attributes=id',
    ).expect(400);
    expect(attrs.body).toMatchObject({
      scimType: 'invalidValue',
      status: '400',
    });
  });

  it('runs create → get-by-filter → patch → deactivate → delete', async () => {
    const userName = 'ada@example.com';

    // Entra ID and Okta look the user up before every create.
    const before = await scim(
      'get',
      `/Users?filter=${encodeURIComponent(`userName eq "${userName}"`)}`,
    ).expect(200);
    expect(before.headers['content-type']).toContain(SCIM_JSON);
    expect(before.body).toEqual({
      schemas: [LIST_SCHEMA],
      totalResults: 0,
      startIndex: 1,
      itemsPerPage: 0,
      Resources: [],
    });

    const created = await scim('post', '/Users', entraUser(userName)).expect(
      201,
    );
    const id = created.body.id as string;
    expect(created.body).toMatchObject({
      schemas: [USER_SCHEMA, ENTERPRISE],
      externalId: `${userName}-object-id`,
      displayName: 'Ada Lovelace',
      [ENTERPRISE]: { department: 'Research', employeeNumber: '1815' },
      userName,
      active: true,
      name: { givenName: 'Ada', familyName: 'Lovelace' },
      emails: [
        { value: `${userName}@example.com`, type: 'work', primary: true },
      ],
      meta: { resourceType: 'User' },
    });
    expect(created.body.meta.location).toMatch(
      new RegExp(`/scim/v2/${REALM}/Users/${id}$`),
    );
    expect(created.headers['location']).toBe(created.body.meta.location);

    // SCIM's externalId must not mark the user as LDAP-federated.
    const stored = await ctx.prisma.user.findUniqueOrThrow({ where: { id } });
    expect(stored.federationLink).toBeNull();
    expect(stored.phoneNumber).toBeNull();

    // A second create is a 409 with the SCIM error body.
    const dup = await scim('post', '/Users', entraUser(userName)).expect(409);
    expect(dup.headers['content-type']).toContain(SCIM_JSON);
    expect(dup.body).toMatchObject({
      schemas: [ERROR_SCHEMA],
      status: '409',
      scimType: 'uniqueness',
    });

    // The lookup now finds it, whatever the case.
    const found = await scim(
      'get',
      `/Users?filter=${encodeURIComponent(`userName eq "ADA@example.com"`)}`,
    ).expect(200);
    expect(found.body.totalResults).toBe(1);
    expect(found.body.Resources[0].id).toBe(id);

    // Entra ID's update: capitalised ops, paths, unstored attributes.
    const patched = await scim(
      'patch',
      `/Users/${id}`,
      patchOp(
        { op: 'Replace', path: 'displayName', value: 'Ada King' },
        { op: 'Replace', path: 'name.familyName', value: 'King' },
        {
          op: 'Replace',
          path: 'emails[type eq "work"].value',
          value: 'ada.king@example.com',
        },
        { op: 'Add', path: `${ENTERPRISE}:department`, value: 'Analytics' },
        { op: 'Replace', path: 'externalId', value: 'new-object-id' },
        { op: 'Add', path: 'title', value: 'Countess' },
      ),
    ).expect(200);
    expect(patched.body).toMatchObject({
      schemas: [USER_SCHEMA, ENTERPRISE],
      externalId: 'new-object-id',
      displayName: 'Ada King',
      title: 'Countess',
      name: { givenName: 'Ada', familyName: 'King' },
      emails: [{ value: 'ada.king@example.com' }],
      active: true,
      [ENTERPRISE]: { department: 'Analytics', employeeNumber: '1815' },
    });

    // An unknown path is refused and nothing in the request is applied.
    const bad = await scim(
      'patch',
      `/Users/${id}`,
      patchOp(
        { op: 'Replace', path: 'name.givenName', value: 'Changed' },
        { op: 'Replace', path: 'notAnAttribute', value: 'x' },
      ),
    ).expect(400);
    expect(bad.body).toMatchObject({
      schemas: [ERROR_SCHEMA],
      status: '400',
      scimType: 'invalidPath',
    });
    const unchanged = await scim('get', `/Users/${id}`).expect(200);
    expect(unchanged.body.name.givenName).toBe('Ada');

    // Deactivate exactly as Entra ID does.
    const deactivated = await scim(
      'patch',
      `/Users/${id}`,
      patchOp({ op: 'Replace', path: 'active', value: 'False' }),
    ).expect(200);
    expect(deactivated.body.active).toBe(false);
    expect(
      (await ctx.prisma.user.findUniqueOrThrow({ where: { id } })).enabled,
    ).toBe(false);

    // Re-activate with a no-path replace (Okta's form).
    await scim(
      'patch',
      `/Users/${id}`,
      patchOp({ op: 'replace', value: { active: true } }),
    ).expect(200);

    // DELETE deprovisions; a missing id is a SCIM 404.
    await scim('delete', `/Users/${id}`).expect(204);
    expect(
      (await ctx.prisma.user.findUniqueOrThrow({ where: { id } })).enabled,
    ).toBe(false);
    const missing = await scim('get', '/Users/does-not-exist').expect(404);
    expect(missing.body).toMatchObject({
      schemas: [ERROR_SCHEMA],
      status: '404',
    });
  });

  it('refuses filters it cannot run with 400 invalidFilter', async () => {
    for (const filter of [
      'passwordHash sw "$"',
      'realmId eq "other"',
      '(userName eq "a")',
      'userName eq "a" and passwordHash pr',
    ]) {
      const res = await scim(
        'get',
        `/Users?filter=${encodeURIComponent(filter)}`,
      ).expect(400);
      expect(res.body).toMatchObject({
        schemas: [ERROR_SCHEMA],
        scimType: 'invalidFilter',
      });
    }
  });

  it('ends the sessions and tokens of a user SCIM deactivates', async () => {
    const userName = 'session.user@example.com';
    const created = await scim('post', '/Users', entraUser(userName)).expect(
      201,
    );
    const id = created.body.id as string;
    await setPassword(id);

    const tokens = await signIn(userName);
    expect(await introspect(tokens.access_token)).toBe(true);
    expect(await ctx.prisma.session.count({ where: { userId: id } })).toBe(1);

    await scim(
      'patch',
      `/Users/${id}`,
      patchOp({ op: 'Replace', path: 'active', value: 'False' }),
    ).expect(200);

    expect(await introspect(tokens.access_token)).toBe(false);
    const refused = await refresh(tokens.refresh_token);
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe('invalid_grant');
    expect(await ctx.prisma.session.count({ where: { userId: id } })).toBe(0);

    // Re-activating does not bring the old tokens back: they were revoked,
    // not just refused while the user was disabled.
    await scim(
      'patch',
      `/Users/${id}`,
      patchOp({ op: 'Replace', path: 'active', value: 'True' }),
    ).expect(200);
    expect(await introspect(tokens.access_token)).toBe(false);
    expect((await refresh(tokens.refresh_token)).status).toBe(400);

    // The user can sign in again with a fresh session.
    const again = await signIn(userName);
    expect(await introspect(again.access_token)).toBe(true);
  });

  it('ends sessions on PUT active=false and on DELETE', async () => {
    const userName = 'put.user@example.com';
    const created = await scim('post', '/Users', entraUser(userName)).expect(
      201,
    );
    const id = created.body.id as string;
    await setPassword(id);

    const first = await signIn(userName);
    await scim('put', `/Users/${id}`, {
      ...entraUser(userName),
      active: 'False',
    }).expect(200);
    expect(await ctx.prisma.session.count({ where: { userId: id } })).toBe(0);
    expect(await introspect(first.access_token)).toBe(false);

    await scim('put', `/Users/${id}`, entraUser(userName)).expect(200);
    const second = await signIn(userName);
    await scim('delete', `/Users/${id}`).expect(204);
    expect(await ctx.prisma.session.count({ where: { userId: id } })).toBe(0);
    expect(await introspect(second.access_token)).toBe(false);
  });

  it('adds, renames and removes group members as Entra ID and Okta do', async () => {
    const a = (
      await scim('post', '/Users', { schemas: [USER_SCHEMA], userName: 'm.a' })
    ).body.id as string;
    const b = (
      await scim('post', '/Users', { schemas: [USER_SCHEMA], userName: 'm.b' })
    ).body.id as string;

    const group = await scim('post', '/Groups', {
      schemas: [GROUP_SCHEMA],
      displayName: 'Engineering',
      externalId: 'entra-group-id',
    }).expect(201);
    const gid = group.body.id as string;
    expect(group.body.meta).toMatchObject({ resourceType: 'Group' });

    const members = async () =>
      (
        (await scim('get', `/Groups/${gid}`).expect(200)).body.members as
          Array<{ value: string }> | undefined
      )
        ?.map((m) => m.value)
        .sort() ?? [];

    await scim(
      'patch',
      `/Groups/${gid}`,
      patchOp({
        op: 'Add',
        path: 'members',
        value: [{ value: a }, { value: b }],
      }),
    ).expect(204);
    expect(await members()).toEqual([a, b].sort());

    // Okta: remove by filter.
    await scim(
      'patch',
      `/Groups/${gid}`,
      patchOp({ op: 'remove', path: `members[value eq "${a}"]` }),
    ).expect(204);
    expect(await members()).toEqual([b]);

    // Entra ID: remove with a value list; and rename.
    await scim(
      'patch',
      `/Groups/${gid}`,
      patchOp(
        { op: 'Remove', path: 'members', value: [{ value: b }] },
        { op: 'Replace', path: 'displayName', value: 'Platform' },
      ),
    ).expect(204);
    expect(await members()).toEqual([]);

    const byName = await scim(
      'get',
      `/Groups?filter=${encodeURIComponent('displayName eq "Platform"')}&excludedAttributes=members`,
    ).expect(200);
    expect(byName.body.totalResults).toBe(1);
    expect(byName.body.Resources[0]).not.toHaveProperty('members');
  });

  it('accepts Bulk "Operations" and answers with "Operations"', async () => {
    const res = await scim('post', '/Bulk', {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkRequest'],
      Operations: [
        {
          method: 'POST',
          path: '/Users',
          bulkId: 'b1',
          data: { schemas: [USER_SCHEMA], userName: 'bulk.user' },
        },
      ],
    }).expect(200);
    expect(res.body.schemas).toEqual([
      'urn:ietf:params:scim:api:messages:2.0:BulkResponse',
    ]);
    expect(res.body.Operations).toEqual([
      expect.objectContaining({ bulkId: 'b1', method: 'POST', status: '201' }),
    ]);
  });
});
