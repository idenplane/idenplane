import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpsRequest } from 'node:https';
import type { RequestListener } from 'node:http';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  createTestApp,
  TEST_ADMIN_API_KEY,
  type SeededRealm,
  type TestContext,
} from './setup';
import { MtlsServerService } from '../src/mtls/mtls-server';
import { makeTestCertificate } from '../src/nhi/__mocks__/certificate.fixture';
import {
  chain,
  issue,
  type TestIdentity,
} from '../src/client-auth/__mocks__/test-pki';

/** Every MTLS_* variable a spec here sets, restored afterwards. */
const MTLS_ENV = [
  'MTLS_ENABLED',
  'MTLS_LISTEN_PORT',
  'MTLS_LISTEN_HOST',
  'MTLS_TLS_CERT_FILE',
  'MTLS_TLS_KEY_FILE',
  'MTLS_PROXY_CERT_HEADER',
  'MTLS_PROXY_CERT_CHAIN_HEADER',
  'MTLS_TRUSTED_PROXY_CIDRS',
  'MTLS_BASE_URL',
  'MTLS_AUTH_FAILURE_LIMIT_PER_MINUTE',
] as const;

const BASE_URL = 'https://mtls.idenplane.test';
const FAILURE_LIMIT = 3;
const CERT_HEADER = 'x-client-cert';
const CHAIN_HEADER = 'x-client-cert-chain';

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, any>;
}

function saveEnv(): () => void {
  const saved: Partial<Record<string, string>> = {};
  for (const name of MTLS_ENV) saved[name] = process.env[name];
  return () => {
    for (const name of MTLS_ENV) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  };
}

/** A PEM as a proxy forwards it: URL-encoded, the default format. */
const headerPem = (...pems: string[]) => encodeURIComponent(pems.join('\n'));

describe('RFC 8705 client authentication (e2e)', () => {
  let ctx: TestContext;
  let seeded: SeededRealm;
  let off: SeededRealm;
  let dir: string;
  let port: number;
  let restoreEnv: () => void;
  let serverCertificate: Awaited<ReturnType<typeof makeTestCertificate>>;
  let pinned: TestIdentity;
  let stranger: TestIdentity;
  let pki: Awaited<ReturnType<typeof chain>>;

  const admin = () => request(ctx.app.getHttpServer() as App);
  const realmPath = (name: string) => `/admin/realms/${name}`;
  const tokenPath = (name: string) =>
    `/realms/${name}/protocol/openid-connect/token`;

  async function createClient(realm: string, body: Record<string, unknown>) {
    const res = await admin()
      .post(`${realmPath(realm)}/clients`)
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .send({ grantTypes: ['client_credentials'], ...body });
    expect(res.status).toBe(201);
    return res.body;
  }

  /** POST a form over the certificate listener. */
  function tlsPost(
    path: string,
    form: Record<string, string>,
    identity?: TestIdentity,
    intermediates: TestIdentity[] = [],
  ): Promise<Reply> {
    const body = new URLSearchParams(form).toString();
    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        {
          hostname: '127.0.0.1',
          servername: 'localhost',
          port,
          path,
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'content-length': Buffer.byteLength(body),
          },
          ca: serverCertificate.pem,
          ...(identity
            ? {
                cert: [identity.pem, ...intermediates.map((i) => i.pem)].join(
                  '\n',
                ),
                key: identity.privateKeyPem,
              }
            : {}),
          agent: false,
        },
        (res) => {
          let text = '';
          res.on('data', (chunk) => (text += chunk));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: text ? JSON.parse(text) : {},
            }),
          );
        },
      );
      req.on('error', reject);
      req.end(body);
    });
  }

  beforeAll(async () => {
    restoreEnv = saveEnv();
    serverCertificate = await makeTestCertificate({
      name: 'localhost',
      dns: 'localhost',
      isCA: true,
    });
    dir = mkdtempSync(join(tmpdir(), 'idenplane-mtls-auth-'));
    writeFileSync(join(dir, 'tls.crt'), serverCertificate.pem);
    writeFileSync(join(dir, 'tls.key'), serverCertificate.privateKeyPem);

    process.env['MTLS_ENABLED'] = 'true';
    process.env['MTLS_LISTEN_PORT'] = '0';
    process.env['MTLS_LISTEN_HOST'] = '127.0.0.1';
    process.env['MTLS_TLS_CERT_FILE'] = join(dir, 'tls.crt');
    process.env['MTLS_TLS_KEY_FILE'] = join(dir, 'tls.key');
    process.env['MTLS_PROXY_CERT_HEADER'] = CERT_HEADER;
    process.env['MTLS_PROXY_CERT_CHAIN_HEADER'] = CHAIN_HEADER;
    process.env['MTLS_TRUSTED_PROXY_CIDRS'] = '127.0.0.1/32,::1/128';
    process.env['MTLS_BASE_URL'] = BASE_URL;
    process.env['MTLS_AUTH_FAILURE_LIMIT_PER_MINUTE'] = String(FAILURE_LIMIT);

    ctx = await createTestApp();
    seeded = await ctx.seedTestRealm('e2e-mtls-client-auth');
    off = await ctx.seedTestRealm('e2e-mtls-client-auth-off');

    const handler = ctx.app.getHttpAdapter().getInstance() as RequestListener;
    const address = await ctx.app.get(MtlsServerService).start(handler);
    if (!address) throw new Error('mTLS listener did not start');
    port = address.port;

    pinned = await issue({ cn: 'pinned-client' });
    stranger = await issue({ cn: 'stranger' });
    pki = await chain({
      name: [{ O: ['Idenplane E2E'] }, { CN: ['pki-device'] }],
    });

    // The realm opts in through the admin API.
    const realmRes = await admin()
      .patch(realmPath(seeded.realm.name))
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .send({ mtlsClientAuthEnabled: true });
    expect(realmRes.status).toBe(200);
    expect(realmRes.body.mtlsClientAuthEnabled).toBe(true);

    for (const realm of [seeded.realm.name, off.realm.name]) {
      const created = await createClient(realm, {
        clientId: 'pinned',
        tokenEndpointAuthMethod: 'self_signed_tls_client_auth',
      });
      expect(created.clientSecret).toBeUndefined();
      const upload = await admin()
        .post(`${realmPath(realm)}/clients/pinned/tls-certificates`)
        .set('x-admin-api-key', TEST_ADMIN_API_KEY)
        .send({ certificatePem: pinned.pem });
      expect(upload.status).toBe(201);
      expect(upload.body.x5tS256).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }

    await createClient(seeded.realm.name, {
      clientId: 'pki-device',
      tokenEndpointAuthMethod: 'tls_client_auth',
      tlsClientAuthSubjectDn: 'CN=pki-device,O=Idenplane E2E',
    });
    const anchor = await admin()
      .post(`${realmPath(seeded.realm.name)}/tls-trust-anchors`)
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .send({ certificatePem: pki.root.pem });
    expect(anchor.status).toBe(201);
  });

  afterAll(async () => {
    await ctx?.prisma.realm.deleteMany({
      where: { name: { in: [seeded?.realm.name, off?.realm.name] } },
    });
    await ctx?.cleanup();
    restoreEnv();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('over the certificate listener', () => {
    it('issues a token to self_signed_tls_client_auth', async () => {
      const res = await tlsPost(
        tokenPath(seeded.realm.name),
        { grant_type: 'client_credentials', client_id: 'pinned' },
        pinned,
      );
      expect(res.status).toBe(200);
      expect(res.body.access_token).toEqual(expect.any(String));
    });

    it('issues a token to tls_client_auth with a CA → intermediate → client chain', async () => {
      const res = await tlsPost(
        tokenPath(seeded.realm.name),
        { grant_type: 'client_credentials', client_id: 'pki-device' },
        pki.leaf,
        [pki.intermediate],
      );
      expect(res.status).toBe(200);
      expect(res.body.access_token).toEqual(expect.any(String));
    });

    it('authenticates introspection with the certificate too', async () => {
      const token = await tlsPost(
        tokenPath(seeded.realm.name),
        { grant_type: 'client_credentials', client_id: 'pinned' },
        pinned,
      );
      const res = await tlsPost(
        `${tokenPath(seeded.realm.name)}/introspect`,
        { token: token.body.access_token, client_id: 'pinned' },
        pinned,
      );
      expect(res.status).toBe(200);
      expect(res.body.active).toBe(true);
    });

    it('refuses a certificate that is not registered', async () => {
      const res = await tlsPost(
        tokenPath(seeded.realm.name),
        { grant_type: 'client_credentials', client_id: 'pinned' },
        stranger,
      );
      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        error: 'invalid_client',
        error_description: 'Invalid client certificate',
      });
    });

    it('refuses tls_client_auth from another CA with the same subject', async () => {
      const other = await chain({
        name: [{ O: ['Idenplane E2E'] }, { CN: ['pki-device'] }],
      });
      const res = await tlsPost(
        tokenPath(seeded.realm.name),
        { grant_type: 'client_credentials', client_id: 'pki-device' },
        other.leaf,
        [other.intermediate],
      );
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_client');
    });

    it('refuses tls_client_auth without the intermediate', async () => {
      const res = await tlsPost(
        tokenPath(seeded.realm.name),
        { grant_type: 'client_credentials', client_id: 'pki-device' },
        pki.leaf,
      );
      expect(res.status).toBe(401);
    });

    it('refuses a request with no certificate', async () => {
      const res = await tlsPost(tokenPath(seeded.realm.name), {
        grant_type: 'client_credentials',
        client_id: 'pinned',
      });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_client');
    });

    it('refuses a certificate together with a client secret', async () => {
      const res = await tlsPost(
        tokenPath(seeded.realm.name),
        {
          grant_type: 'client_credentials',
          client_id: 'pinned',
          client_secret: 'anything',
        },
        pinned,
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_request');
    });

    it('refuses certificate authentication in a realm that has not opted in', async () => {
      const res = await tlsPost(
        tokenPath(off.realm.name),
        { grant_type: 'client_credentials', client_id: 'pinned' },
        pinned,
      );
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_client');
    });

    it('ignores the certificate of a client that uses a secret', async () => {
      const res = await tlsPost(
        tokenPath(seeded.realm.name),
        {
          grant_type: 'client_credentials',
          client_id: seeded.client.clientId,
          client_secret: 'test-client-secret',
        },
        pinned,
      );
      expect(res.status).toBe(200);
    });

    it('refuses a revoked certificate on the next request', async () => {
      const listed = await admin()
        .post(`${realmPath(seeded.realm.name)}/tls-revoked-certificates`)
        .set('x-admin-api-key', TEST_ADMIN_API_KEY)
        .send({ certificatePem: pki.leaf.pem, reason: 'e2e' });
      expect(listed.status).toBe(201);
      const form = {
        grant_type: 'client_credentials',
        client_id: 'pki-device',
      };
      expect(
        (
          await tlsPost(tokenPath(seeded.realm.name), form, pki.leaf, [
            pki.intermediate,
          ])
        ).status,
      ).toBe(401);
      const removed = await admin()
        .delete(
          `${realmPath(seeded.realm.name)}/tls-revoked-certificates/${listed.body.id}`,
        )
        .set('x-admin-api-key', TEST_ADMIN_API_KEY);
      expect(removed.status).toBe(204);
      expect(
        (
          await tlsPost(tokenPath(seeded.realm.name), form, pki.leaf, [
            pki.intermediate,
          ])
        ).status,
      ).toBe(200);
    });
  });

  describe('through a trusted proxy header', () => {
    const post = (realm: string) => admin().post(tokenPath(realm)).type('form');

    it('issues a token to self_signed_tls_client_auth', async () => {
      const res = await post(seeded.realm.name)
        .set(CERT_HEADER, headerPem(pinned.pem))
        .send({ grant_type: 'client_credentials', client_id: 'pinned' });
      expect(res.status).toBe(200);
      expect(res.body.access_token).toEqual(expect.any(String));
    });

    it('issues a token to tls_client_auth with the chain header', async () => {
      const res = await post(seeded.realm.name)
        .set(CERT_HEADER, headerPem(pki.leaf.pem))
        .set(CHAIN_HEADER, headerPem(pki.intermediate.pem))
        .send({ grant_type: 'client_credentials', client_id: 'pki-device' });
      expect(res.status).toBe(200);
    });

    it('answers 429 slow_down once a certificate has spent its failure budget', async () => {
      const intruder = await issue({ cn: 'intruder' });
      const attempt = () =>
        post(seeded.realm.name)
          .set(CERT_HEADER, headerPem(intruder.pem))
          .send({ grant_type: 'client_credentials', client_id: 'pinned' });
      for (let i = 0; i < FAILURE_LIMIT; i++) {
        expect((await attempt()).status).toBe(401);
      }
      const throttled = await attempt();
      expect(throttled.status).toBe(429);
      expect(throttled.body.error).toBe('slow_down');
      expect(Number(throttled.headers['retry-after'])).toBeGreaterThan(0);
      expect(throttled.headers['www-authenticate']).toBeUndefined();

      // The budget is per certificate: the registered one still works.
      const ok = await post(seeded.realm.name)
        .set(CERT_HEADER, headerPem(pinned.pem))
        .send({ grant_type: 'client_credentials', client_id: 'pinned' });
      expect(ok.status).toBe(200);
    });
  });

  describe('discovery', () => {
    const discovery = (realm: string) =>
      admin().get(`/realms/${realm}/.well-known/openid-configuration`);

    it('advertises the certificate methods and aliases for an opted-in realm', async () => {
      const res = await discovery(seeded.realm.name);
      expect(res.body.token_endpoint_auth_methods_supported).toEqual(
        expect.arrayContaining([
          'tls_client_auth',
          'self_signed_tls_client_auth',
        ]),
      );
      expect(res.body.mtls_endpoint_aliases.token_endpoint).toBe(
        `${BASE_URL}/realms/${seeded.realm.name}/protocol/openid-connect/token`,
      );
      expect(res.body).not.toHaveProperty(
        'tls_client_certificate_bound_access_tokens',
      );
    });

    it('advertises nothing for a realm that has not opted in', async () => {
      const res = await discovery(off.realm.name);
      expect(res.body.token_endpoint_auth_methods_supported).not.toContain(
        'tls_client_auth',
      );
      expect(res.body).not.toHaveProperty('mtls_endpoint_aliases');
    });
  });

  describe('admin API validation', () => {
    const key = (req: request.Test) =>
      req.set('x-admin-api-key', TEST_ADMIN_API_KEY);

    it('refuses tls_client_auth without exactly one subject rule', async () => {
      const res = await key(
        admin().post(`${realmPath(seeded.realm.name)}/clients`),
      ).send({
        clientId: 'no-rule',
        tokenEndpointAuthMethod: 'tls_client_auth',
      });
      expect(res.status).toBe(400);
    });

    it('refuses an invalid subject DN', async () => {
      const res = await key(
        admin().post(`${realmPath(seeded.realm.name)}/clients`),
      ).send({
        clientId: 'bad-dn',
        tokenEndpointAuthMethod: 'tls_client_auth',
        tlsClientAuthSubjectDn: 'CN=a;O=b',
      });
      expect(res.status).toBe(400);
    });

    it('refuses a private key in an upload', async () => {
      const res = await key(
        admin().post(
          `${realmPath(seeded.realm.name)}/clients/pinned/tls-certificates`,
        ),
      ).send({ certificatePem: `${stranger.pem}\n${stranger.privateKeyPem}` });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/private key/);
    });

    it('refuses a trust anchor that is not a CA', async () => {
      const res = await key(
        admin().post(`${realmPath(seeded.realm.name)}/tls-trust-anchors`),
      ).send({ certificatePem: stranger.pem });
      expect(res.status).toBe(400);
    });

    it('lists the registered certificates without their PEM', async () => {
      const res = await key(
        admin().get(
          `${realmPath(seeded.realm.name)}/clients/pinned/tls-certificates`,
        ),
      );
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).not.toHaveProperty('certificatePem');
      expect(res.body[0].subject).toBe('CN=pinned-client');
    });
  });
});

describe('RFC 8705 client authentication with MTLS_ENABLED off (e2e)', () => {
  let ctx: TestContext;
  let seeded: SeededRealm;
  let restoreEnv: () => void;
  let pinned: TestIdentity;

  beforeAll(async () => {
    restoreEnv = saveEnv();
    for (const name of MTLS_ENV) delete process.env[name];
    ctx = await createTestApp();
    seeded = await ctx.seedTestRealm('e2e-mtls-client-auth-disabled');
    pinned = await issue({ cn: 'pinned-off' });
    await ctx.prisma.realm.update({
      where: { id: seeded.realm.id },
      data: { mtlsClientAuthEnabled: true },
    });
    const res = await request(ctx.app.getHttpServer() as App)
      .post(`/admin/realms/${seeded.realm.name}/clients`)
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .send({
        clientId: 'pinned',
        grantTypes: ['client_credentials'],
        tokenEndpointAuthMethod: 'self_signed_tls_client_auth',
      });
    expect(res.status).toBe(201);
    const upload = await request(ctx.app.getHttpServer() as App)
      .post(
        `/admin/realms/${seeded.realm.name}/clients/pinned/tls-certificates`,
      )
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .send({ certificatePem: pinned.pem });
    expect(upload.status).toBe(201);
  });

  afterAll(async () => {
    await ctx?.prisma.realm.deleteMany({
      where: { name: seeded?.realm.name },
    });
    await ctx?.cleanup();
    restoreEnv();
  });

  it('is invalid_client, even with a certificate header and the realm flag on', async () => {
    const res = await request(ctx.app.getHttpServer() as App)
      .post(`/realms/${seeded.realm.name}/protocol/openid-connect/token`)
      .type('form')
      .set(CERT_HEADER, headerPem(pinned.pem))
      .send({ grant_type: 'client_credentials', client_id: 'pinned' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_client');
  });

  it('advertises no certificate method', async () => {
    const res = await request(ctx.app.getHttpServer() as App).get(
      `/realms/${seeded.realm.name}/.well-known/openid-configuration`,
    );
    expect(res.body.token_endpoint_auth_methods_supported).toEqual([
      'client_secret_post',
      'client_secret_basic',
      'none',
    ]);
    expect(res.body).not.toHaveProperty('mtls_endpoint_aliases');
  });
});
