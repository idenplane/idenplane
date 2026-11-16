import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, TEST_ADMIN_API_KEY, type TestContext } from './setup';

/**
 * SCIM clients (Entra ID, Okta, OneLogin…) send `application/scim+json`, as
 * RFC 7644 §3.1 requires. The server only parsed `application/json`, so those
 * bodies arrived empty and every create, replace and patch failed.
 */
describe('SCIM request media type (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let realmName: string;
  let scimToken: string;

  const SCIM_JSON = 'application/scim+json';
  const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
  const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app as INestApplication<App>;
    realmName = (await ctx.seedTestRealm('e2e-scim-media-type')).realm.name;

    const res = await request(app.getHttpServer())
      .post(`/admin/realms/${realmName}/scim/tokens`)
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .send({ name: 'e2e-scim-client' })
      .expect(201);
    scimToken = res.body.token as string;
    expect(typeof scimToken).toBe('string');
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  const scim = () => request(app.getHttpServer());
  const auth = () => `Bearer ${scimToken}`;

  it('creates, patches and replaces a user sent as application/scim+json', async () => {
    const created = await scim()
      .post(`/scim/v2/${realmName}/Users`)
      .set('Authorization', auth())
      .set('Content-Type', SCIM_JSON)
      .send(
        JSON.stringify({
          schemas: [USER_SCHEMA],
          userName: 'scim.media.type',
          name: { givenName: 'Scim', familyName: 'Client' },
          emails: [{ value: 'scim.media.type@example.com', primary: true }],
          active: true,
        }),
      )
      .expect(201);
    expect(created.body.userName).toBe('scim.media.type');
    const id = created.body.id as string;

    await scim()
      .patch(`/scim/v2/${realmName}/Users/${id}`)
      .set('Authorization', auth())
      .set('Content-Type', SCIM_JSON)
      .send(
        JSON.stringify({
          schemas: [PATCH_SCHEMA],
          Operations: [{ op: 'replace', path: 'active', value: false }],
        }),
      )
      .expect(200);

    const user = await ctx.prisma.user.findFirst({
      where: { id },
      select: { enabled: true, firstName: true },
    });
    expect(user).toEqual({ enabled: false, firstName: 'Scim' });

    const replaced = await scim()
      .put(`/scim/v2/${realmName}/Users/${id}`)
      .set('Authorization', auth())
      .set('Content-Type', SCIM_JSON)
      .send(
        JSON.stringify({
          schemas: [USER_SCHEMA],
          userName: 'scim.media.type',
          name: { givenName: 'Replaced', familyName: 'Client' },
          active: true,
        }),
      )
      .expect(200);
    expect(replaced.body.name?.givenName).toBe('Replaced');
  });

  it('still parses application/json', async () => {
    const res = await scim()
      .post(`/scim/v2/${realmName}/Users`)
      .set('Authorization', auth())
      .send({ schemas: [USER_SCHEMA], userName: 'scim.plain.json' })
      .expect(201);
    expect(res.body.userName).toBe('scim.plain.json');
  });

  it('does not parse other media types as JSON', async () => {
    // A body the server cannot read is still refused, not silently accepted.
    const res = await scim()
      .post(`/scim/v2/${realmName}/Users`)
      .set('Authorization', auth())
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ schemas: [USER_SCHEMA], userName: 'scim.text' }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
