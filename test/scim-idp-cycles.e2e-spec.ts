import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, TEST_ADMIN_API_KEY, type TestContext } from './setup';

/**
 * SCIM as Microsoft Entra ID and Okta drive it, request for request, as
 * their provisioning documentation describes: the lookups before a create,
 * the create payloads (enterprise extension, password sync), Entra's
 * non-standard PATCH forms, Okta's PUT updates and password changes,
 * deactivation, group push with member add/remove, and the discovery
 * claims those clients rely on. Plus pagination, projections, a group too
 * large for the default body limit, and Bulk with bulkId references.
 */
describe('SCIM provisioning by Entra ID and Okta (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let scimToken: string;
  let realmId: string;

  const REALM = 'e2e-scim-idp-cycles';
  const BASE = `/scim/v2/${REALM}`;
  const TOKEN_URL = `/realms/${REALM}/protocol/openid-connect/token`;
  const CLIENT_ID = 'test-client';
  const CLIENT_SECRET = 'test-client-secret';

  const SCIM_JSON = 'application/scim+json';
  const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
  const ENTERPRISE =
    'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
  const GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
  const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
  const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
  const ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';

  const http = () => request(app.getHttpServer());

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

  const filter = (expression: string) =>
    `filter=${encodeURIComponent(expression)}`;

  const patchOp = (...Operations: unknown[]) => ({
    schemas: [PATCH_SCHEMA],
    Operations,
  });

  const passwordGrant = (username: string, password: string) =>
    http().post(TOKEN_URL).type('form').send({
      grant_type: 'password',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      username,
      password,
      scope: 'openid',
    });

  const refresh = (refreshToken: string) =>
    http().post(TOKEN_URL).type('form').send({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app as INestApplication<App>;
    const seeded = await ctx.seedTestRealm(REALM);
    realmId = seeded.realm.id;

    // A realm policy for the password tests: 10+ characters with a digit,
    // and the last 3 passwords may not be reused.
    await ctx.prisma.realm.update({
      where: { id: realmId },
      data: {
        scimEnabled: true,
        passwordMinLength: 10,
        passwordRequireDigits: true,
        passwordHistoryCount: 3,
      },
    });

    const res = await http()
      .post(`/admin/realms/${REALM}/scim/tokens`)
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .send({ name: 'e2e-idp-cycles' })
      .expect(201);
    scimToken = res.body.token as string;
  }, 60_000);

  afterAll(async () => {
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
  });

  it('answers the discovery Entra ID and Okta read with accurate claims', async () => {
    const config = await http()
      .get(`${BASE}/ServiceProviderConfig`)
      .expect(200);
    expect(config.body).toMatchObject({
      patch: { supported: true },
      changePassword: { supported: true },
      bulk: { supported: true, maxPayloadSize: 1048576 },
      sort: { supported: false },
      etag: { supported: false },
      meta: { resourceType: 'ServiceProviderConfig' },
    });
    expect(
      (config.body.authenticationSchemes as Array<{ type: string }>).map(
        (s) => s.type,
      ),
    ).toEqual(['oauthbearertoken']);

    const types = await http().get(`${BASE}/ResourceTypes`).expect(200);
    expect(types.body.schemas).toEqual([LIST_SCHEMA]);
    expect(types.body.Resources[0].meta.location).toContain(
      `/scim/v2/${REALM}/ResourceTypes/`,
    );

    const user = await http().get(`${BASE}/Schemas/${USER_SCHEMA}`).expect(200);
    expect(
      (user.body.attributes as Array<{ name: string }>).find(
        (a) => a.name === 'password',
      ),
    ).toMatchObject({ mutability: 'writeOnly', returned: 'never' });
  });

  it('replays an Entra ID provisioning cycle', async () => {
    // Test connection: a lookup by a userName that cannot exist.
    const probe = await scim(
      'get',
      `/Users?${filter('userName eq "non-existent-user-2c8d6f4b"')}`,
    ).expect(200);
    expect(probe.body).toMatchObject({ totalResults: 0, Resources: [] });

    // Manager first, so the user can point at it.
    const manager = await scim('post', '/Users', {
      schemas: [USER_SCHEMA],
      externalId: 'entra-manager-oid',
      userName: 'grace@contoso.example',
      active: true,
      emails: [{ primary: true, type: 'work', value: 'grace@contoso.example' }],
      name: { givenName: 'Grace', familyName: 'Hopper' },
    }).expect(201);
    const managerId = manager.body.id as string;

    // Lookup by the matching attribute, then the create Entra ID sends.
    await scim(
      'get',
      `/Users?${filter('userName eq "alan@contoso.example"')}`,
    ).expect(200);
    const created = await scim('post', '/Users', {
      schemas: [USER_SCHEMA, ENTERPRISE],
      externalId: 'entra-alan-oid',
      userName: 'alan@contoso.example',
      active: true,
      displayName: 'Alan Turing',
      title: 'Researcher',
      preferredLanguage: 'en-GB',
      emails: [{ primary: true, type: 'work', value: 'alan@contoso.example' }],
      name: {
        formatted: 'Alan Turing',
        familyName: 'Turing',
        givenName: 'Alan',
      },
      phoneNumbers: [
        { type: 'work', value: '+44 20 7946 0001' },
        { type: 'mobile', value: '+44 7700 900001' },
      ],
      addresses: [
        { type: 'work', locality: 'Manchester', country: 'GB', primary: true },
      ],
      [ENTERPRISE]: {
        employeeNumber: '1912',
        department: 'Mathematics',
        manager: { value: managerId },
      },
    }).expect(201);
    const id = created.body.id as string;
    expect(created.body).toMatchObject({
      schemas: [USER_SCHEMA, ENTERPRISE],
      externalId: 'entra-alan-oid',
      displayName: 'Alan Turing',
      title: 'Researcher',
      preferredLanguage: 'en-GB',
      name: {
        formatted: 'Alan Turing',
        givenName: 'Alan',
        familyName: 'Turing',
      },
      phoneNumbers: [
        { type: 'work', value: '+44 20 7946 0001' },
        { type: 'mobile', value: '+44 7700 900001' },
      ],
      addresses: [
        { type: 'work', locality: 'Manchester', country: 'GB', primary: true },
      ],
      [ENTERPRISE]: {
        employeeNumber: '1912',
        department: 'Mathematics',
        manager: { value: managerId },
      },
    });
    expect(created.body).not.toHaveProperty('password');
    // phoneNumbers are profile data, never the SMS MFA number.
    expect(
      (await ctx.prisma.user.findUniqueOrThrow({ where: { id } })).phoneNumber,
    ).toBeNull();

    // Matching on externalId (a common alternative matching attribute).
    const byExternalId = await scim(
      'get',
      `/Users?${filter('externalId eq "entra-alan-oid"')}`,
    ).expect(200);
    expect(byExternalId.body.totalResults).toBe(1);
    expect(byExternalId.body.Resources[0].id).toBe(id);
    // externalId is caseExact.
    expect(
      (
        await scim(
          'get',
          `/Users?${filter('externalId eq "ENTRA-ALAN-OID"')}`,
        ).expect(200)
      ).body.totalResults,
    ).toBe(0);
    // And by email.
    expect(
      (
        await scim(
          'get',
          `/Users?${filter('emails.value eq "ALAN@contoso.example"')}`,
        ).expect(200)
      ).body.totalResults,
    ).toBe(1);

    // An incremental update, in Entra ID's forms: capitalised ops, a
    // path-less Replace with dotted and URN-prefixed keys, filtered
    // multi-valued paths, and the manager as a bare string.
    await scim(
      'patch',
      `/Users/${id}`,
      patchOp(
        {
          op: 'Replace',
          value: {
            'name.givenName': 'Alan M.',
            displayName: 'Alan M. Turing',
            [`${ENTERPRISE}:department`]: 'Computing',
          },
        },
        {
          op: 'Replace',
          path: 'emails[type eq "work"].value',
          value: 'alan.turing@contoso.example',
        },
        {
          op: 'Replace',
          path: 'phoneNumbers[type eq "work"].value',
          value: '+44 20 7946 0002',
        },
        {
          op: 'Add',
          path: 'phoneNumbers[type eq "fax"].value',
          value: '+44 20 7946 0003',
        },
        {
          op: 'Replace',
          path: 'addresses[type eq "work"].locality',
          value: 'Bletchley',
        },
        { op: 'Add', path: `${ENTERPRISE}:manager`, value: managerId },
        { op: 'Remove', path: 'phoneNumbers[type eq "mobile"]' },
      ),
    ).expect(200);

    const after = await scim('get', `/Users/${id}`).expect(200);
    expect(after.body).toMatchObject({
      displayName: 'Alan M. Turing',
      name: { givenName: 'Alan M.' },
      emails: [{ value: 'alan.turing@contoso.example', type: 'work' }],
      phoneNumbers: [
        { type: 'work', value: '+44 20 7946 0002' },
        { type: 'fax', value: '+44 20 7946 0003' },
      ],
      addresses: [{ type: 'work', locality: 'Bletchley', country: 'GB' }],
      [ENTERPRISE]: { department: 'Computing', manager: { value: managerId } },
    });

    // Groups: lookup without members, create, add, remove, rename.
    const noGroup = await scim(
      'get',
      `/Groups?excludedAttributes=members&${filter('displayName eq "Codebreakers"')}`,
    ).expect(200);
    expect(noGroup.body.totalResults).toBe(0);
    const group = await scim('post', '/Groups', {
      schemas: [GROUP_SCHEMA],
      externalId: 'entra-group-oid',
      displayName: 'Codebreakers',
      members: [],
    }).expect(201);
    const gid = group.body.id as string;
    expect(group.body.externalId).toBe('entra-group-oid');

    await scim(
      'patch',
      `/Groups/${gid}`,
      patchOp({
        op: 'Add',
        path: 'members',
        value: [
          { $ref: null, value: id },
          { $ref: null, value: managerId },
        ],
      }),
    ).expect(204);
    // Membership check, as Entra ID makes it.
    const member = await scim(
      'get',
      `/Groups?excludedAttributes=members&${filter(`id eq "${gid}" and members eq "${id}"`)}`,
    ).expect(200);
    expect(member.body.totalResults).toBe(1);
    expect(member.body.Resources[0]).not.toHaveProperty('members');

    await scim(
      'patch',
      `/Groups/${gid}`,
      patchOp({
        op: 'Remove',
        path: 'members',
        value: [{ $ref: null, value: managerId }],
      }),
    ).expect(204);
    await scim(
      'patch',
      `/Groups/${gid}`,
      patchOp({ op: 'Replace', path: 'displayName', value: 'Hut 8' }),
    ).expect(204);
    const groupNow = await scim(
      'get',
      `/Groups/${gid}?excludedAttributes=members`,
    ).expect(200);
    expect(groupNow.body).toMatchObject({
      displayName: 'Hut 8',
      externalId: 'entra-group-oid',
    });
    expect(groupNow.body).not.toHaveProperty('members');
    const withMembers = await scim('get', `/Groups/${gid}`).expect(200);
    expect(
      (withMembers.body.members as Array<{ value: string }>).map(
        (m) => m.value,
      ),
    ).toEqual([id]);
    expect(
      (
        await scim(
          'get',
          `/Groups?${filter('externalId eq "entra-group-oid"')}`,
        ).expect(200)
      ).body.totalResults,
    ).toBe(1);

    // Soft delete (out of scope): active "False"; then a hard delete.
    const disabled = await scim(
      'patch',
      `/Users/${id}`,
      patchOp({ op: 'Replace', path: 'active', value: 'False' }),
    ).expect(200);
    expect(disabled.body.active).toBe(false);
    await scim('delete', `/Users/${id}`).expect(204);
    await scim('delete', `/Groups/${gid}`).expect(204);
    await scim('get', `/Groups/${gid}`).expect(404);
  });

  it('replays an Okta provisioning cycle, password sync included', async () => {
    const userName = 'katherine@okta.example';
    const firstPassword = 'Orbit-1962-launch';

    // Import / assignment: lookup, then a create with the password.
    const lookup = await scim(
      'get',
      `/Users?${filter(`userName eq "${userName}"`)}&startIndex=1&count=100`,
    ).expect(200);
    expect(lookup.body).toMatchObject({
      schemas: [LIST_SCHEMA],
      totalResults: 0,
      startIndex: 1,
      itemsPerPage: 0,
    });
    const oktaUser = (password?: string) => ({
      schemas: [USER_SCHEMA],
      userName,
      name: { givenName: 'Katherine', familyName: 'Johnson' },
      emails: [{ primary: true, value: userName, type: 'work' }],
      displayName: 'Katherine Johnson',
      locale: 'en-US',
      externalId: '00u1okta',
      groups: [],
      ...(password ? { password } : {}),
      active: true,
    });
    const created = await scim(
      'post',
      '/Users',
      oktaUser(firstPassword),
    ).expect(201);
    const id = created.body.id as string;
    expect(created.body).not.toHaveProperty('password');
    expect(JSON.stringify(created.body)).not.toContain(firstPassword);

    // The password works for sign-in and is stored hashed.
    const first = await passwordGrant(userName, firstPassword).expect(200);
    const stored = await ctx.prisma.user.findUniqueOrThrow({ where: { id } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored.passwordChangedAt).not.toBeNull();

    // Okta's profile update is a PUT of the whole user, with the same
    // password when password sync is on: not a password change, so the
    // user stays signed in.
    await scim('put', `/Users/${id}`, {
      ...oktaUser(firstPassword),
      name: { givenName: 'Katherine G.', familyName: 'Johnson' },
    }).expect(200);
    expect((await refresh(first.body.refresh_token as string)).status).toBe(
      200,
    );

    // A password the policy refuses: 400 invalidValue, nothing changed.
    const weak = await scim(
      'patch',
      `/Users/${id}`,
      patchOp({ op: 'replace', value: { password: 'short' } }),
    ).expect(400);
    expect(weak.body).toMatchObject({
      schemas: [ERROR_SCHEMA],
      status: '400',
      scimType: 'invalidValue',
    });
    expect(JSON.stringify(weak.body)).not.toContain('short"');

    // Okta's password change: a path-less replace.
    const signedIn = await passwordGrant(userName, firstPassword).expect(200);
    const secondPassword = 'Apollo-1969-orbit';
    const changed = await scim(
      'patch',
      `/Users/${id}`,
      patchOp({ op: 'replace', value: { password: secondPassword } }),
    ).expect(200);
    expect(changed.body).not.toHaveProperty('password');

    // Every session from before the change has ended.
    const oldRefresh = await refresh(signedIn.body.refresh_token as string);
    expect(oldRefresh.status).toBe(400);
    expect(oldRefresh.body.error).toBe('invalid_grant');
    const oldPassword = await passwordGrant(userName, firstPassword);
    expect(oldPassword.status).toBe(400);
    expect(oldPassword.body.error).toBe('invalid_grant');
    await passwordGrant(userName, secondPassword).expect(200);

    // History: the previous password cannot come back.
    const reused = await scim(
      'patch',
      `/Users/${id}`,
      patchOp({ op: 'replace', path: 'password', value: firstPassword }),
    ).expect(400);
    expect(reused.body.scimType).toBe('invalidValue');

    // A password is never returned, even when asked for.
    const asked = await scim(
      'get',
      `/Users/${id}?attributes=password,userName`,
    ).expect(200);
    expect(asked.body).not.toHaveProperty('password');
    expect(
      (await scim('get', `/Users?${filter('password pr')}`).expect(400)).body
        .scimType,
    ).toBe('invalidFilter');

    // Push groups: create with members, rename with Okta's path-less
    // replace, remove a member by filter, then a full PUT.
    const other = (
      await scim('post', '/Users', {
        schemas: [USER_SCHEMA],
        userName: 'dorothy@okta.example',
      }).expect(201)
    ).body.id as string;
    const group = await scim('post', '/Groups', {
      schemas: [GROUP_SCHEMA],
      displayName: 'Computers',
      members: [
        { value: id, display: userName },
        { value: other, display: 'dorothy@okta.example' },
      ],
    }).expect(201);
    const gid = group.body.id as string;
    expect(group.body.members).toHaveLength(2);

    await scim(
      'patch',
      `/Groups/${gid}`,
      patchOp({
        op: 'replace',
        value: { id: gid, displayName: 'Human Computers' },
      }),
    ).expect(204);
    await scim(
      'patch',
      `/Groups/${gid}`,
      patchOp({ op: 'remove', path: `members[value eq "${other}"]` }),
    ).expect(204);
    // A PATCH that asks for attributes gets the group back.
    const projected = await scim(
      'patch',
      `/Groups/${gid}?attributes=members`,
      patchOp({ op: 'add', path: 'members', value: [{ value: other }] }),
    ).expect(200);
    expect(projected.body.members).toHaveLength(2);
    expect(projected.body).not.toHaveProperty('externalId');

    await scim('put', `/Groups/${gid}`, {
      schemas: [GROUP_SCHEMA],
      id: gid,
      displayName: 'Human Computers',
      members: [{ value: other }],
    }).expect(200);
    expect(
      (
        (await scim('get', `/Groups/${gid}`).expect(200)).body
          .members as Array<{
          value: string;
        }>
      ).map((m) => m.value),
    ).toEqual([other]);

    // Deactivation, Okta's way; the user is signed out.
    const current = await passwordGrant(userName, secondPassword).expect(200);
    await scim(
      'patch',
      `/Users/${id}`,
      patchOp({ op: 'replace', value: { active: false } }),
    ).expect(200);
    expect((await refresh(current.body.refresh_token as string)).status).toBe(
      400,
    );
  });

  it('refuses a userName that differs only in case with 409 uniqueness', async () => {
    await scim('post', '/Users', {
      schemas: [USER_SCHEMA],
      userName: 'Case.User@example.com',
    }).expect(201);
    const dup = await scim('post', '/Users', {
      schemas: [USER_SCHEMA],
      userName: 'case.user@EXAMPLE.com',
    }).expect(409);
    expect(dup.body).toMatchObject({
      schemas: [ERROR_SCHEMA],
      status: '409',
      scimType: 'uniqueness',
    });
  });

  it('pages with startIndex/count and applies attributes/excludedAttributes', async () => {
    for (let i = 1; i <= 5; i++) {
      await scim('post', '/Users', {
        schemas: [USER_SCHEMA],
        userName: `page.user.${i}`,
        emails: [{ value: `page.user.${i}@example.com`, primary: true }],
        title: 'Pager',
      }).expect(201);
    }
    const where = filter('userName sw "page.user."');
    const pages = [];
    for (const startIndex of [1, 3, 5]) {
      const res = await scim(
        'get',
        `/Users?${where}&startIndex=${startIndex}&count=2&attributes=userName`,
      ).expect(200);
      expect(res.body).toMatchObject({ totalResults: 5, startIndex });
      for (const r of res.body.Resources as Array<Record<string, unknown>>) {
        expect(Object.keys(r).sort()).toEqual(
          ['id', 'meta', 'schemas', 'userName'].sort(),
        );
      }
      pages.push(
        ...(res.body.Resources as Array<{ userName: string }>).map(
          (r) => r.userName,
        ),
      );
    }
    expect(pages).toEqual([1, 2, 3, 4, 5].map((i) => `page.user.${i}`));

    const countOnly = await scim('get', `/Users?${where}&count=0`).expect(200);
    expect(countOnly.body).toMatchObject({
      totalResults: 5,
      itemsPerPage: 0,
      Resources: [],
    });

    const excluded = await scim(
      'get',
      `/Users?${where}&excludedAttributes=emails,title`,
    ).expect(200);
    expect(excluded.body.Resources[0]).not.toHaveProperty('emails');
    expect(excluded.body.Resources[0]).not.toHaveProperty('title');
    expect(excluded.body.Resources[0]).toHaveProperty('userName');

    const orFilter = await scim(
      'get',
      `/Users?${filter('userName eq "page.user.1" or userName eq "page.user.4"')}`,
    ).expect(200);
    expect(orFilter.body.totalResults).toBe(2);

    const search = await scim('post', '/Users/.search', {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:SearchRequest'],
      filter: 'userName sw "page.user."',
      attributes: ['emails.value'],
      startIndex: 2,
      count: 1,
    }).expect(200);
    expect(search.body.Resources).toEqual([
      expect.objectContaining({
        userName: 'page.user.2',
        emails: [{ value: 'page.user.2@example.com' }],
      }),
    ]);
  });

  it('takes a group with thousands of members in one PUT', async () => {
    const count = 2500;
    await ctx.prisma.user.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        realmId,
        username: `bulk.member.${String(i).padStart(4, '0')}`,
      })),
    });
    const members = await ctx.prisma.user.findMany({
      where: { realmId, username: { startsWith: 'bulk.member.' } },
      select: { id: true },
    });
    expect(members).toHaveLength(count);

    const group = await scim('post', '/Groups', {
      schemas: [GROUP_SCHEMA],
      displayName: 'Everyone',
    }).expect(201);
    const gid = group.body.id as string;

    // ~110 KB: over the 100 KB limit of other endpoints.
    const body = {
      schemas: [GROUP_SCHEMA],
      displayName: 'Everyone',
      members: members.map((m) => ({ value: m.id })),
    };
    expect(JSON.stringify(body).length).toBeGreaterThan(100 * 1024);
    await scim('put', `/Groups/${gid}?excludedAttributes=members`, body).expect(
      200,
    );
    expect(await ctx.prisma.userGroup.count({ where: { groupId: gid } })).toBe(
      count,
    );

    const light = await scim(
      'get',
      `/Groups/${gid}?excludedAttributes=members`,
    ).expect(200);
    expect(light.body).not.toHaveProperty('members');

    // Over the SCIM limit (1 MiB) is still refused.
    const tooBig = await scim('put', `/Groups/${gid}`, {
      ...body,
      members: Array.from({ length: 30_000 }, (_, i) => ({
        value: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
      })),
    });
    expect(tooBig.status).toBe(413);
  });

  it('resolves bulkId references in a Bulk request', async () => {
    const res = await scim('post', '/Bulk', {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkRequest'],
      Operations: [
        {
          method: 'POST',
          path: '/Groups',
          bulkId: 'grp',
          data: {
            schemas: [GROUP_SCHEMA],
            displayName: 'Bulk Group',
            members: [{ value: 'bulkId:usr' }],
          },
        },
        {
          method: 'POST',
          path: '/Users',
          bulkId: 'usr',
          data: { schemas: [USER_SCHEMA], userName: 'bulk.ref.user' },
        },
      ],
    }).expect(200);
    expect(
      (res.body.Operations as Array<{ bulkId: string; status: string }>).map(
        (o) => [o.bulkId, o.status],
      ),
    ).toEqual([
      ['usr', '201'],
      ['grp', '201'],
    ]);
    const groupLocation = (
      res.body.Operations as Array<{ bulkId: string; location: string }>
    ).find((o) => o.bulkId === 'grp')!.location;
    const gid = groupLocation.split('/').pop()!;
    const group = await scim('get', `/Groups/${gid}`).expect(200);
    expect(group.body.members).toEqual([
      expect.objectContaining({ display: 'bulk.ref.user' }),
    ]);
  });
});
