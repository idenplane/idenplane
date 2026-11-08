import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, TEST_ADMIN_API_KEY, type TestContext } from './setup';

/**
 * client_credentials for a client with a service account: the token carries
 * the service account's identity but no session, so nothing is written per
 * token, no token is pushed out by newer ones, and disabling the service
 * account still ends every token it holds.
 */
describe('Service account tokens (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;

  const REALM = 'e2e-service-account-tokens';
  const CLIENT_ID = 'machine';
  const TOKEN_URL = `/realms/${REALM}/protocol/openid-connect/token`;
  const INTROSPECT_URL = `${TOKEN_URL}/introspect`;
  const USERINFO_URL = `/realms/${REALM}/protocol/openid-connect/userinfo`;
  let secret: string;

  const issue = async () =>
    (
      await request(app.getHttpServer())
        .post(TOKEN_URL)
        .type('form')
        .send({
          grant_type: 'client_credentials',
          client_id: CLIENT_ID,
          client_secret: secret,
          scope: 'openid',
        })
        .expect(200)
    ).body as Record<string, unknown>;

  const introspect = async (token: string) =>
    (
      (
        await request(app.getHttpServer())
          .post(INTROSPECT_URL)
          .type('form')
          .send({ token, client_id: CLIENT_ID, client_secret: secret })
          .expect(200)
      ).body as { active: boolean }
    ).active;

  const claims = (jwt: string) =>
    JSON.parse(
      Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'),
    ) as Record<string, unknown>;

  const serviceAccount = () =>
    ctx.prisma.user.findFirstOrThrow({
      where: {
        username: `service-account-${CLIENT_ID}`,
        realm: { name: REALM },
      },
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app as INestApplication<App>;
    await ctx.seedTestRealm(REALM);
    const res = await request(app.getHttpServer())
      .post(`/admin/realms/${REALM}/clients`)
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .send({
        clientId: CLIENT_ID,
        clientType: 'CONFIDENTIAL',
        grantTypes: ['client_credentials'],
      })
      .expect(201);
    secret = (res.body as { clientSecret: string }).clientSecret;
  }, 30_000);

  afterAll(async () => {
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
  });

  it('issues an access token for the service account and nothing else', async () => {
    const body = await issue();

    expect(body).not.toHaveProperty('refresh_token');
    expect(body).not.toHaveProperty('id_token');
    expect(body).not.toHaveProperty('session_state');
    const token = claims(body.access_token as string);
    expect(token.sub).toBe((await serviceAccount()).id);
    expect(token).not.toHaveProperty('sid');
  });

  it('writes no session for the service account', async () => {
    await issue();
    const { id } = await serviceAccount();
    expect(await ctx.prisma.session.count({ where: { userId: id } })).toBe(0);
  });

  it('keeps a token active however many newer ones are issued', async () => {
    const first = (await issue()).access_token as string;
    // Before the fix, the 101st newer token deleted the first one's session.
    for (let batch = 0; batch < 11; batch++) {
      await Promise.all(Array.from({ length: 10 }, () => issue()));
    }
    expect(await introspect(first)).toBe(true);
  }, 60_000);

  it('ends its tokens when the service account is disabled', async () => {
    const token = (await issue()).access_token as string;
    await request(app.getHttpServer())
      .get(USERINFO_URL)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const { id } = await serviceAccount();
    await ctx.prisma.user.update({ where: { id }, data: { enabled: false } });
    try {
      expect(await introspect(token)).toBe(false);
      await request(app.getHttpServer())
        .get(USERINFO_URL)
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    } finally {
      await ctx.prisma.user.update({ where: { id }, data: { enabled: true } });
    }
  });
});
