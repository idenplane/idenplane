import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  createTestApp,
  TEST_ADMIN_API_KEY,
  type SeededRealm,
  type TestContext,
} from './setup';
import { useThemeViews } from './helpers/browser';

/**
 * Exact redirect URI matching (0.11.0, RFC 9700, ASVS V10.4.1): the
 * authorization endpoint refuses anything but a registered string, apart
 * from the port of a loopback IP URI; `/*` wildcards only work through the
 * per-client insecure opt-in, and the upgrade health check lists them.
 */
describe('Exact redirect URI matching (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;

  const REALM = 'e2e-redirect-exact';
  const REGISTERED = 'http://localhost:3000/callback';
  const http = () => request(app.getHttpServer());

  const authorize = (redirectUri: string) =>
    http().get(`/realms/${REALM}/protocol/openid-connect/auth`).query({
      client_id: 'test-client',
      response_type: 'code',
      scope: 'openid',
      state: 'xyz',
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      code_challenge_method: 'S256',
      redirect_uri: redirectUri,
    });

  /** Accepted: on to the login page. Refused: 400, never a redirect. */
  const expectAccepted = async (redirectUri: string) => {
    const res = await authorize(redirectUri);
    expect(res.status).toBe(302);
    expect(String(res.headers['location'])).toMatch(
      new RegExp(`^/realms/${REALM}/login\\?`),
    );
  };
  const expectRefused = async (redirectUri: string) => {
    const res = await authorize(redirectUri);
    expect(res.status).toBe(400);
    expect(res.headers['location']).toBeUndefined();
    expect(res.text).not.toContain('code=');
  };

  const setClient = (data: {
    redirectUris: string[];
    allowInsecureWildcardRedirectUris: boolean;
  }) =>
    ctx.prisma.client.update({
      where: { id: seeded.client.id },
      data,
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app as INestApplication<App>;
    // A refused request renders the themed error page.
    useThemeViews(app);
    seeded = await ctx.seedTestRealm(REALM);
  }, 30_000);

  afterEach(async () => {
    await setClient({
      redirectUris: [REGISTERED],
      allowInsecureWildcardRedirectUris: false,
    });
  });

  afterAll(async () => {
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
  });

  it('accepts the registered redirect URI', async () => {
    await expectAccepted(REGISTERED);
  });

  it('refuses anything that is not the registered string', async () => {
    for (const uri of [
      `${REGISTERED}/`,
      `${REGISTERED}/extra`,
      `${REGISTERED}?next=/admin`,
      `${REGISTERED}#fragment`,
      'HTTP://LOCALHOST:3000/callback',
      'http://localhost:3000/Callback',
      'http://localhost:3000/callback/../admin',
      'http://localhost:3000/callback%2F..%2Fadmin',
      'http://localhost:3001/callback',
      'http://localhost:3000/callback.evil.example',
    ]) {
      await expectRefused(uri);
    }
  });

  it('refuses paths under a /* entry for a normal client', async () => {
    await setClient({
      redirectUris: ['http://localhost:3000/*'],
      allowInsecureWildcardRedirectUris: false,
    });
    await expectRefused(REGISTERED);
    await expectRefused('http://localhost:3000/anything');
  });

  it('keeps a /* entry working for a client with the insecure opt-in, within its path', async () => {
    await setClient({
      redirectUris: ['http://localhost:3000/app/*'],
      allowInsecureWildcardRedirectUris: true,
    });
    await expectAccepted('http://localhost:3000/app/callback');
    await expectRefused('http://localhost:3000/app/../admin');
    await expectRefused('http://localhost:3000/app/%2e%2e/admin');
    await expectRefused('http://localhost:3000/other');
    await expectRefused('http://localhost:3000/app/callback#x');
  });

  it('accepts a loopback IP redirect URI on any port (RFC 8252)', async () => {
    await setClient({
      redirectUris: ['http://127.0.0.1/callback', 'http://[::1]/callback'],
      allowInsecureWildcardRedirectUris: false,
    });
    await expectAccepted('http://127.0.0.1:49152/callback');
    await expectAccepted('http://[::1]:8080/callback');
    await expectRefused('http://127.0.0.1:49152/other');
    await expectRefused('http://localhost:49152/callback');
  });

  it('refuses a wildcard on a client through the admin API unless it opts in', async () => {
    const put = (body: Record<string, unknown>) =>
      http()
        .put(`/admin/realms/${REALM}/clients/test-client`)
        .set('x-admin-api-key', TEST_ADMIN_API_KEY)
        .send(body);

    const refused = await put({ redirectUris: ['http://localhost:3000/*'] });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toContain(
      'allowInsecureWildcardRedirectUris',
    );

    await put({
      redirectUris: ['http://localhost:3000/*'],
      allowInsecureWildcardRedirectUris: true,
    }).expect(200);
    // Turning the opt-in off while the wildcard is there is refused...
    await put({ allowInsecureWildcardRedirectUris: false }).expect(400);
    // ...and allowed once the wildcard is replaced.
    await put({
      redirectUris: [REGISTERED],
      allowInsecureWildcardRedirectUris: false,
    }).expect(200);
  });

  it('lists wildcard clients as an upgrade health warning', async () => {
    const health = async () =>
      (
        (
          await http()
            .get('/admin/upgrade/health')
            .set('x-admin-api-key', TEST_ADMIN_API_KEY)
            .expect(200)
        ).body as {
          checks: Array<{ name: string; status: string; details?: string }>;
        }
      ).checks.find((c) => c.name === 'wildcard_redirect_uris');

    const before = await health();
    expect(before).toBeDefined();
    expect(before?.details ?? '').not.toContain(`${REALM}/test-client`);

    await setClient({
      redirectUris: ['http://localhost:3000/*'],
      allowInsecureWildcardRedirectUris: true,
    });
    const after = await health();
    expect(after?.status).toBe('warn');
    expect(after?.details).toContain(`${REALM}/test-client`);
  }, 60_000);
});
