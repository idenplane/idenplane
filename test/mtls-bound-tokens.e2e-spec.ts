import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, X509Certificate } from 'node:crypto';
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
  issue,
  type TestIdentity,
} from '../src/client-auth/__mocks__/test-pki';

/**
 * RFC 8705 §3 certificate-bound access tokens, end to end: real TLS
 * handshakes on the certificate listener, and a trusted proxy's header.
 */

const MTLS_ENV = [
  'MTLS_ENABLED',
  'MTLS_LISTEN_PORT',
  'MTLS_LISTEN_HOST',
  'MTLS_TLS_CERT_FILE',
  'MTLS_TLS_KEY_FILE',
  'MTLS_PROXY_CERT_HEADER',
  'MTLS_TRUSTED_PROXY_CIDRS',
  'MTLS_BASE_URL',
] as const;

const CERT_HEADER = 'x-client-cert';
const PASSWORD = 'TestPassword123!';

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, any>;
}

const x5tOf = (identity: TestIdentity) =>
  createHash('sha256')
    .update(new X509Certificate(identity.pem).raw)
    .digest('base64url');

/** The payload of a JWT, unverified: the tests only read `cnf`. */
const claims = (jwt: string) =>
  JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));

const headerPem = (pem: string) => encodeURIComponent(pem);

describe('RFC 8705 certificate-bound access tokens (e2e)', () => {
  let ctx: TestContext;
  let seeded: SeededRealm;
  let dir: string;
  let port: number;
  let saved: Partial<Record<string, string>>;
  let serverCertificate: Awaited<ReturnType<typeof makeTestCertificate>>;
  let alice: TestIdentity;
  let bob: TestIdentity;
  let boundSecret: string;

  const http = () => request(ctx.app.getHttpServer() as App);
  const realmPath = () => `/admin/realms/${seeded.realm.name}`;
  const oidc = (endpoint: string) =>
    `/realms/${seeded.realm.name}/protocol/openid-connect/${endpoint}`;

  /** A request over the certificate listener, with `identity`'s certificate. */
  function tls(
    method: 'GET' | 'POST',
    path: string,
    options: {
      form?: Record<string, string>;
      identity?: TestIdentity;
      bearer?: string;
    } = {},
  ): Promise<Reply> {
    const body = options.form
      ? new URLSearchParams(options.form).toString()
      : undefined;
    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        {
          hostname: '127.0.0.1',
          servername: 'localhost',
          port,
          path,
          method,
          headers: {
            ...(body !== undefined
              ? {
                  'content-type': 'application/x-www-form-urlencoded',
                  'content-length': Buffer.byteLength(body),
                }
              : {}),
            ...(options.bearer
              ? { authorization: `Bearer ${options.bearer}` }
              : {}),
          },
          ca: serverCertificate.pem,
          ...(options.identity
            ? {
                cert: options.identity.pem,
                key: options.identity.privateKeyPem,
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

  async function createClient(body: Record<string, unknown>) {
    const res = await http()
      .post(`${realmPath()}/clients`)
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .send(body);
    expect(res.status).toBe(201);
    return res.body;
  }

  beforeAll(async () => {
    saved = {};
    for (const name of MTLS_ENV) saved[name] = process.env[name];
    serverCertificate = await makeTestCertificate({
      name: 'localhost',
      dns: 'localhost',
      isCA: true,
    });
    dir = mkdtempSync(join(tmpdir(), 'idenplane-mtls-bound-'));
    writeFileSync(join(dir, 'tls.crt'), serverCertificate.pem);
    writeFileSync(join(dir, 'tls.key'), serverCertificate.privateKeyPem);

    process.env['MTLS_ENABLED'] = 'true';
    process.env['MTLS_LISTEN_PORT'] = '0';
    process.env['MTLS_LISTEN_HOST'] = '127.0.0.1';
    process.env['MTLS_TLS_CERT_FILE'] = join(dir, 'tls.crt');
    process.env['MTLS_TLS_KEY_FILE'] = join(dir, 'tls.key');
    process.env['MTLS_PROXY_CERT_HEADER'] = CERT_HEADER;
    process.env['MTLS_TRUSTED_PROXY_CIDRS'] = '127.0.0.1/32,::1/128';
    process.env['MTLS_BASE_URL'] = 'https://mtls.idenplane.test';

    ctx = await createTestApp();
    seeded = await ctx.seedTestRealm('e2e-mtls-bound-tokens');
    const handler = ctx.app.getHttpAdapter().getInstance() as RequestListener;
    const address = await ctx.app.get(MtlsServerService).start(handler);
    if (!address) throw new Error('mTLS listener did not start');
    port = address.port;

    alice = await issue({ cn: 'alice-device' });
    bob = await issue({ cn: 'bob-device' });

    const realmRes = await http()
      .patch(realmPath())
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .send({ mtlsClientAuthEnabled: true });
    expect(realmRes.status).toBe(200);

    // A certificate-authenticated machine client; its service account makes
    // its tokens usable at userinfo.
    const machine = await createClient({
      clientId: 'bound-machine',
      grantTypes: ['client_credentials'],
      tokenEndpointAuthMethod: 'self_signed_tls_client_auth',
      tlsClientCertificateBoundAccessTokens: true,
    });
    expect(machine.tlsClientCertificateBoundAccessTokens).toBe(true);
    for (const identity of [alice, bob]) {
      const upload = await http()
        .post(`${realmPath()}/clients/bound-machine/tls-certificates`)
        .set('x-admin-api-key', TEST_ADMIN_API_KEY)
        .send({ certificatePem: identity.pem });
      expect(upload.status).toBe(201);
    }

    // A secret client whose tokens are bound to whatever certificate it
    // presents (RFC 8705 §3: any authentication method).
    const secretClient = await createClient({
      clientId: 'bound-secret',
      grantTypes: ['password', 'refresh_token'],
      tlsClientCertificateBoundAccessTokens: true,
    });
    boundSecret = secretClient.clientSecret;
    expect(boundSecret).toEqual(expect.any(String));

    // A public client holding its certificate as its key (RFC 8705 §4).
    await createClient({
      clientId: 'bound-public',
      clientType: 'PUBLIC',
      grantTypes: ['password', 'refresh_token'],
      tlsClientCertificateBoundAccessTokens: true,
    });
  });

  afterAll(async () => {
    await ctx?.prisma.realm.deleteMany({
      where: { name: seeded?.realm.name },
    });
    await ctx?.cleanup();
    for (const name of MTLS_ENV) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    rmSync(dir, { recursive: true, force: true });
  });

  const machineToken = (identity: TestIdentity) =>
    tls('POST', oidc('token'), {
      form: { grant_type: 'client_credentials', client_id: 'bound-machine' },
      identity,
    });

  const passwordGrant = (clientId: string, identity?: TestIdentity) =>
    tls('POST', oidc('token'), {
      form: {
        grant_type: 'password',
        client_id: clientId,
        ...(clientId === 'bound-public'
          ? {}
          : {
              client_secret:
                clientId === 'bound-secret'
                  ? boundSecret
                  : 'test-client-secret',
            }),
        username: seeded.user.username,
        password: PASSWORD,
      },
      identity,
    });

  describe('over the certificate listener', () => {
    let accessToken: string;

    beforeAll(async () => {
      const res = await machineToken(alice);
      expect(res.status).toBe(200);
      accessToken = res.body.access_token;
    });

    it('binds a tls_client_auth client_credentials token to the certificate', () => {
      expect(claims(accessToken).cnf).toEqual({ 'x5t#S256': x5tOf(alice) });
    });

    it('answers userinfo with the same certificate', async () => {
      const res = await tls('GET', oidc('userinfo'), {
        identity: alice,
        bearer: accessToken,
      });
      expect(res.status).toBe(200);
      expect(res.body.sub).toBeDefined();
    });

    it('answers userinfo by POST with the same certificate', async () => {
      const res = await tls('POST', oidc('userinfo'), {
        identity: alice,
        form: { access_token: accessToken },
      });
      expect(res.status).toBe(200);
    });

    it('refuses userinfo with a different certificate: 401 invalid_token', async () => {
      const res = await tls('GET', oidc('userinfo'), {
        identity: bob,
        bearer: accessToken,
      });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_token');
      expect(res.headers['www-authenticate']).toMatch(
        /^Bearer error="invalid_token", error_description="The access token is bound to a different client certificate"$/,
      );
    });

    it('refuses userinfo without a certificate', async () => {
      const overListener = await tls('GET', oidc('userinfo'), {
        bearer: accessToken,
      });
      expect(overListener.status).toBe(401);
      expect(overListener.body.error).toBe('invalid_token');

      const overMainPort = await http()
        .get(oidc('userinfo'))
        .set('authorization', `Bearer ${accessToken}`);
      expect(overMainPort.status).toBe(401);
      expect(overMainPort.headers['www-authenticate']).toMatch(
        /^Bearer error="invalid_token"/,
      );
    });

    it('returns cnf from introspection', async () => {
      const res = await tls('POST', oidc('token/introspect'), {
        form: { token: accessToken, client_id: 'bound-machine' },
        identity: alice,
      });
      expect(res.status).toBe(200);
      expect(res.body.active).toBe(true);
      expect(res.body.cnf).toEqual({ 'x5t#S256': x5tOf(alice) });
    });

    it('binds the token of a secret-authenticated client too', async () => {
      const res = await passwordGrant('bound-secret', alice);
      expect(res.status).toBe(200);
      expect(claims(res.body.access_token).cnf).toEqual({
        'x5t#S256': x5tOf(alice),
      });
    });

    it('refuses a bound client that presents no certificate: invalid_client', async () => {
      const res = await passwordGrant('bound-secret');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_client');
    });

    it('rebinds a confidential client’s refreshed token to the certificate presented now', async () => {
      const first = await passwordGrant('bound-secret', alice);
      expect(first.status).toBe(200);

      const refreshed = await tls('POST', oidc('token'), {
        form: {
          grant_type: 'refresh_token',
          refresh_token: first.body.refresh_token,
          client_id: 'bound-secret',
          client_secret: boundSecret,
        },
        identity: bob,
      });
      expect(refreshed.status).toBe(200);
      expect(claims(refreshed.body.access_token).cnf).toEqual({
        'x5t#S256': x5tOf(bob),
      });
      const userinfo = await tls('GET', oidc('userinfo'), {
        identity: bob,
        bearer: refreshed.body.access_token,
      });
      expect(userinfo.status).toBe(200);
    });

    it('refreshes a public client’s token only with the same certificate', async () => {
      const first = await passwordGrant('bound-public', alice);
      expect(first.status).toBe(200);
      expect(claims(first.body.access_token).cnf).toEqual({
        'x5t#S256': x5tOf(alice),
      });
      const refresh = (identity: TestIdentity, token: string) =>
        tls('POST', oidc('token'), {
          form: {
            grant_type: 'refresh_token',
            refresh_token: token,
            client_id: 'bound-public',
          },
          identity,
        });

      const stolen = await refresh(bob, first.body.refresh_token);
      expect(stolen.status).toBe(400);
      expect(stolen.body.error).toBe('invalid_grant');

      // The refused attempt did not spend the token.
      const own = await refresh(alice, first.body.refresh_token);
      expect(own.status).toBe(200);
      expect(claims(own.body.access_token).cnf).toEqual({
        'x5t#S256': x5tOf(alice),
      });

      const introspected = await tls('POST', oidc('token/introspect'), {
        form: { token: own.body.refresh_token, client_id: 'bound-public' },
        identity: alice,
      });
      expect(introspected.body.cnf).toEqual({ 'x5t#S256': x5tOf(alice) });
    });

    it('leaves an unbound client unchanged, certificate or not', async () => {
      const res = await passwordGrant(seeded.client.clientId, alice);
      expect(res.status).toBe(200);
      expect(claims(res.body.access_token)).not.toHaveProperty('cnf');

      const userinfo = await http()
        .get(oidc('userinfo'))
        .set('authorization', `Bearer ${res.body.access_token}`);
      expect(userinfo.status).toBe(200);

      const introspected = await http()
        .post(oidc('token/introspect'))
        .type('form')
        .send({
          token: res.body.access_token,
          client_id: seeded.client.clientId,
          client_secret: 'test-client-secret',
        });
      expect(introspected.body.active).toBe(true);
      expect(introspected.body).not.toHaveProperty('cnf');
    });
  });

  describe('through a trusted proxy header', () => {
    let accessToken: string;

    beforeAll(async () => {
      const res = await http()
        .post(oidc('token'))
        .set(CERT_HEADER, headerPem(alice.pem))
        .type('form')
        .send({ grant_type: 'client_credentials', client_id: 'bound-machine' });
      expect(res.status).toBe(200);
      accessToken = res.body.access_token;
    });

    it('binds the token to the forwarded certificate', () => {
      expect(claims(accessToken).cnf).toEqual({ 'x5t#S256': x5tOf(alice) });
    });

    it('answers userinfo with the same forwarded certificate', async () => {
      const res = await http()
        .get(oidc('userinfo'))
        .set('authorization', `Bearer ${accessToken}`)
        .set(CERT_HEADER, headerPem(alice.pem));
      expect(res.status).toBe(200);
    });

    it('refuses userinfo with another forwarded certificate', async () => {
      const res = await http()
        .get(oidc('userinfo'))
        .set('authorization', `Bearer ${accessToken}`)
        .set(CERT_HEADER, headerPem(bob.pem));
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_token');
    });

    it('refuses userinfo when the forwarded header is malformed', async () => {
      const res = await http()
        .get(oidc('userinfo'))
        .set('authorization', `Bearer ${accessToken}`)
        .set(CERT_HEADER, 'not-a-certificate');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_token');
    });
  });

  describe('discovery', () => {
    it('advertises tls_client_certificate_bound_access_tokens for the opted-in realm', async () => {
      const res = await http().get(
        `/realms/${seeded.realm.name}/.well-known/openid-configuration`,
      );
      expect(res.body.tls_client_certificate_bound_access_tokens).toBe(true);
    });
  });
});
