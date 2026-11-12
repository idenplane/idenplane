import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, type SeededRealm, type TestContext } from './setup';

const SECRET = 'test-client-secret';

function basic(id: string, secret: string): string {
  const encode = (value: string) => encodeURIComponent(value);
  return `Basic ${Buffer.from(`${encode(id)}:${encode(secret)}`).toString('base64')}`;
}

describe('Token endpoint client authentication (e2e)', () => {
  let ctx: TestContext;
  let seeded: SeededRealm;
  let tokenUrl: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    seeded = await ctx.seedTestRealm('e2e-token-client-auth');
    tokenUrl = `/realms/${seeded.realm.name}/protocol/openid-connect/token`;
  });

  afterAll(async () => {
    await ctx.prisma.realm.deleteMany({ where: { name: seeded.realm.name } });
    await ctx.cleanup();
  });

  const post = () =>
    request(ctx.app.getHttpServer() as App)
      .post(tokenUrl)
      .type('form');

  it('accepts client_secret_basic, as discovery advertises', async () => {
    const res = await post()
      .set('Authorization', basic(seeded.client.clientId, SECRET))
      .send({ grant_type: 'client_credentials' });

    expect(res.status).toBe(200);
    expect(res.body.access_token).toEqual(expect.any(String));
  });

  it('still accepts client_secret_post', async () => {
    const res = await post().send({
      grant_type: 'client_credentials',
      client_id: seeded.client.clientId,
      client_secret: SECRET,
    });

    expect(res.status).toBe(200);
  });

  it('rejects a wrong Basic secret with WWW-Authenticate', async () => {
    const res = await post()
      .set('Authorization', basic(seeded.client.clientId, 'wrong'))
      .send({ grant_type: 'client_credentials' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_client');
    expect(res.headers['www-authenticate']).toMatch(/^Basic /);
  });

  it('rejects Basic together with client_secret', async () => {
    const res = await post()
      .set('Authorization', basic(seeded.client.clientId, SECRET))
      .send({ grant_type: 'client_credentials', client_secret: SECRET });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('rejects a body client_id that differs from Basic', async () => {
    const res = await post()
      .set('Authorization', basic(seeded.client.clientId, SECRET))
      .send({ grant_type: 'client_credentials', client_id: 'someone-else' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('no longer advertises private_key_jwt', async () => {
    const res = await request(ctx.app.getHttpServer() as App).get(
      `/realms/${seeded.realm.name}/.well-known/openid-configuration`,
    );

    expect(res.body.token_endpoint_auth_methods_supported).not.toContain(
      'private_key_jwt',
    );
    expect(res.body.token_endpoint_auth_methods_supported).toContain(
      'client_secret_basic',
    );
  });
});
