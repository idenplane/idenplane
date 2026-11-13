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
import { TokensService } from '../src/tokens/tokens.service';
import { makeTestCertificate } from '../src/nhi/__mocks__/certificate.fixture';
import {
  chain,
  issue,
  type TestIdentity,
} from '../src/client-auth/__mocks__/test-pki';

/**
 * RFC 8705 NHI binding, end to end over real TLS on the certificate
 * listener: a device (an NHI identity) gets an OAuth client, authenticates
 * at /token with its own certificate and receives a certificate-bound
 * client_credentials token; rotation with overlap; inactive identities,
 * other realms and introspection.
 */

const MTLS_ENV = [
  'MTLS_ENABLED',
  'MTLS_LISTEN_PORT',
  'MTLS_LISTEN_HOST',
  'MTLS_TLS_CERT_FILE',
  'MTLS_TLS_KEY_FILE',
  'MTLS_AUTH_FAILURE_LIMIT_PER_MINUTE',
] as const;

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, any>;
}

const x5tOf = (identity: TestIdentity) =>
  createHash('sha256')
    .update(new X509Certificate(identity.pem).raw)
    .digest('base64url');

/** The payload of a JWT, unverified: the tests only read its claims. */
const claims = (jwt: string) =>
  JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));

describe('NHI certificate binding (e2e)', () => {
  let ctx: TestContext;
  let seeded: SeededRealm;
  let other: SeededRealm;
  let dir: string;
  let port: number;
  let saved: Partial<Record<string, string>>;
  let serverCertificate: Awaited<ReturnType<typeof makeTestCertificate>>;
  let device: TestIdentity;
  let renewed: TestIdentity;
  let stranger: TestIdentity;
  let pki: Awaited<ReturnType<typeof chain>>;

  const http = () => request(ctx.app.getHttpServer() as App);
  const admin = (realmName = seeded.realm.name) => ({
    post: (path: string) =>
      http()
        .post(`/admin/realms/${realmName}${path}`)
        .set('x-admin-api-key', TEST_ADMIN_API_KEY),
    get: (path: string) =>
      http()
        .get(`/admin/realms/${realmName}${path}`)
        .set('x-admin-api-key', TEST_ADMIN_API_KEY),
    put: (path: string) =>
      http()
        .put(`/admin/realms/${realmName}${path}`)
        .set('x-admin-api-key', TEST_ADMIN_API_KEY),
    patch: (path: string) =>
      http()
        .patch(`/admin/realms/${realmName}${path}`)
        .set('x-admin-api-key', TEST_ADMIN_API_KEY),
    delete: (path: string) =>
      http()
        .delete(`/admin/realms/${realmName}${path}`)
        .set('x-admin-api-key', TEST_ADMIN_API_KEY),
  });
  const oidc = (endpoint: string, realmName = seeded.realm.name) =>
    `/realms/${realmName}/protocol/openid-connect/${endpoint}`;

  /** A request over the certificate listener, with `identity`'s certificate. */
  function tls(
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

  const tokenFor = (
    clientId: string,
    identity?: TestIdentity,
    intermediates: TestIdentity[] = [],
    realmName?: string,
  ) =>
    tls(
      oidc('token', realmName),
      { grant_type: 'client_credentials', client_id: clientId },
      identity,
      intermediates,
    );

  const introspect = (
    clientId: string,
    token: string,
    identity: TestIdentity,
    intermediates: TestIdentity[] = [],
  ) =>
    tls(
      oidc('token/introspect'),
      { token, client_id: clientId },
      identity,
      intermediates,
    );

  async function createIdentity(name: string, realmName?: string) {
    const res = await admin(realmName)
      .post('/nhi')
      .send({ name, identityType: 'IOT_DEVICE', lifecycleStatus: 'ACTIVE' });
    expect(res.status).toBe(201);
    return res.body as { id: string };
  }

  beforeAll(async () => {
    saved = {};
    for (const name of MTLS_ENV) saved[name] = process.env[name];
    serverCertificate = await makeTestCertificate({
      name: 'localhost',
      dns: 'localhost',
      isCA: true,
    });
    dir = mkdtempSync(join(tmpdir(), 'idenplane-nhi-mtls-'));
    writeFileSync(join(dir, 'tls.crt'), serverCertificate.pem);
    writeFileSync(join(dir, 'tls.key'), serverCertificate.privateKeyPem);

    process.env['MTLS_ENABLED'] = 'true';
    process.env['MTLS_LISTEN_PORT'] = '0';
    process.env['MTLS_LISTEN_HOST'] = '127.0.0.1';
    process.env['MTLS_TLS_CERT_FILE'] = join(dir, 'tls.crt');
    process.env['MTLS_TLS_KEY_FILE'] = join(dir, 'tls.key');
    // The negative cases reuse certificates; keep them clear of the budget.
    process.env['MTLS_AUTH_FAILURE_LIMIT_PER_MINUTE'] = '1000';

    ctx = await createTestApp();
    seeded = await ctx.seedTestRealm('e2e-nhi-mtls');
    other = await ctx.seedTestRealm('e2e-nhi-mtls-other');
    const handler = ctx.app.getHttpAdapter().getInstance() as RequestListener;
    const address = await ctx.app.get(MtlsServerService).start(handler);
    if (!address) throw new Error('mTLS listener did not start');
    port = address.port;

    device = await issue({ cn: 'sensor-1' });
    renewed = await issue({ cn: 'sensor-1' });
    stranger = await issue({ cn: 'sensor-1' });
    pki = await chain({
      name: [{ O: ['Example Devices'] }, { CN: ['sensor-pki'] }],
      san: [{ type: 'dns', value: 'sensor-pki.devices.example' }],
    });

    for (const realm of [seeded.realm.name, other.realm.name]) {
      const res = await admin(realm)
        .patch('')
        .send({ mtlsClientAuthEnabled: true });
      expect(res.status).toBe(200);
    }
  });

  afterAll(async () => {
    await ctx?.prisma.realm.deleteMany({
      where: { name: { in: [seeded?.realm.name, other?.realm.name] } },
    });
    await ctx?.cleanup();
    for (const name of MTLS_ENV) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    rmSync(dir, { recursive: true, force: true });
  });

  describe('a self-signed device', () => {
    let identityId: string;
    let clientId: string;
    let firstCredentialId: string;
    let firstToken: string;

    beforeAll(async () => {
      identityId = (await createIdentity('sensor-1')).id;
    });

    it('registers its certificate as a credential, never a private key', async () => {
      const withKey = await admin()
        .post(`/nhi/${identityId}/credentials`)
        .send({
          name: 'with key',
          tlsAuthMode: 'SELF_SIGNED',
          certificatePem: device.pem,
          privateKeyPem: device.privateKeyPem,
        });
      expect(withKey.status).toBe(400);

      const keyInPem = await admin()
        .post(`/nhi/${identityId}/credentials`)
        .send({
          name: 'key in pem',
          tlsAuthMode: 'SELF_SIGNED',
          certificatePem: `${device.pem}\n${device.privateKeyPem}`,
        });
      expect(keyInPem.status).toBe(400);

      const res = await admin().post(`/nhi/${identityId}/credentials`).send({
        name: 'device cert',
        tlsAuthMode: 'SELF_SIGNED',
        certificatePem: device.pem,
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        credentialType: 'CERTIFICATE',
        tlsAuthMode: 'SELF_SIGNED',
        certThumbprintS256: x5tOf(device),
        certSubject: 'CN=sensor-1',
        status: 'active',
      });
      expect(res.body).not.toHaveProperty('privateKeyPem');
      firstCredentialId = res.body.id;
    });

    it('gets an OAuth client: confidential, client_credentials only, no secret, always bound', async () => {
      const created = await admin()
        .post(`/nhi/${identityId}/oauth-client`)
        .send({});
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        nhiIdentityId: identityId,
        clientType: 'CONFIDENTIAL',
        grantTypes: ['client_credentials'],
        tokenEndpointAuthMethod: 'self_signed_tls_client_auth',
        tlsClientCertificateBoundAccessTokens: true,
        tokenEndpoint: oidc('token'),
        mtlsClientAuthEnabled: true,
      });
      expect(created.body).not.toHaveProperty('clientSecret');
      clientId = created.body.clientId;

      const again = await admin()
        .post(`/nhi/${identityId}/oauth-client`)
        .send({});
      expect(again.status).toBe(200);
      expect(again.body.clientId).toBe(clientId);

      const read = await admin().get(`/nhi/${identityId}/oauth-client`);
      expect(read.status).toBe(200);
      expect(read.body.clientId).toBe(clientId);

      const conflicting = await admin()
        .post(`/nhi/${identityId}/oauth-client`)
        .send({ tokenEndpointAuthMethod: 'tls_client_auth' });
      expect(conflicting.status).toBe(409);
    });

    it('cannot be turned into a secret client through the clients API', async () => {
      const update = await admin()
        .put(`/clients/${clientId}`)
        .send({ tokenEndpointAuthMethod: 'client_secret_basic' });
      expect(update.status).toBe(409);
      const secret = await admin().post(
        `/clients/${clientId}/regenerate-secret`,
      );
      expect(secret.status).toBe(409);
    });

    it('a device certificate gives a client_credentials token bound with cnf', async () => {
      const res = await tokenFor(clientId, device);
      expect(res.status).toBe(200);
      firstToken = res.body.access_token;
      const payload = claims(firstToken);
      expect(payload.cnf).toEqual({ 'x5t#S256': x5tOf(device) });
      expect(payload.azp).toBe(clientId);
      // No service account: the subject is the client itself.
      const row = await ctx.prisma.client.findFirst({
        where: { clientId, realmId: seeded.realm.id },
      });
      expect(payload.sub).toBe(row?.id);
      expect(row?.serviceAccountUserId).toBeNull();
    });

    it('refuses no certificate, an unregistered certificate, and a secret', async () => {
      expect((await tokenFor(clientId)).status).toBe(401);
      const unknown = await tokenFor(clientId, stranger);
      expect(unknown.status).toBe(401);
      expect(unknown.body.error).toBe('invalid_client');

      const withSecret = await tls(
        oidc('token'),
        {
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: 'anything',
        },
        device,
      );
      expect(withSecret.status).toBe(400);
      expect(withSecret.body.error).toBe('invalid_request');
    });

    it('introspection: active, with cnf, for the client itself', async () => {
      const res = await introspect(clientId, firstToken, device);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        active: true,
        client_id: clientId,
        cnf: { 'x5t#S256': x5tOf(device) },
      });
      expect(res.body.username).toBeUndefined();
    });

    describe('rotation with overlap', () => {
      let renewedCredentialId: string;
      let renewedToken: string;

      it('the old certificate keeps working during the grace period, and so does the new one', async () => {
        const res = await admin()
          .post(`/nhi/${identityId}/credentials/${firstCredentialId}/rotate`)
          .send({ certificatePem: renewed.pem, overlapSeconds: 3600 });
        expect(res.status).toBe(200);
        expect(res.body.oldCredential).toMatchObject({
          id: firstCredentialId,
          status: 'grace',
        });
        expect(res.body.newCredential).toMatchObject({
          status: 'active',
          certThumbprintS256: x5tOf(renewed),
        });
        renewedCredentialId = res.body.newCredential.id;

        const old = await tokenFor(clientId, device);
        expect(old.status).toBe(200);
        const fresh = await tokenFor(clientId, renewed);
        expect(fresh.status).toBe(200);
        renewedToken = fresh.body.access_token;
        expect(claims(renewedToken).cnf).toEqual({
          'x5t#S256': x5tOf(renewed),
        });

        // A token bound to the old certificate stays active meanwhile.
        const introspected = await introspect(clientId, firstToken, renewed);
        expect(introspected.body.active).toBe(true);

        // Rotating the old credential again is refused.
        const twice = await admin()
          .post(`/nhi/${identityId}/credentials/${firstCredentialId}/rotate`)
          .send({ certificatePem: stranger.pem });
        expect(twice.status).toBe(409);
      });

      it('after the grace period only the new certificate works', async () => {
        await ctx.prisma.nhiCredential.update({
          where: { id: firstCredentialId },
          data: { rotationGraceUntil: new Date(Date.now() - 1000) },
        });

        const old = await tokenFor(clientId, device);
        expect(old.status).toBe(401);
        expect(old.body.error).toBe('invalid_client');
        expect((await tokenFor(clientId, renewed)).status).toBe(200);

        // Tokens bound to the old certificate are no longer active.
        const stale = await introspect(clientId, firstToken, renewed);
        expect(stale.body).toEqual({ active: false });
        const current = await introspect(clientId, renewedToken, renewed);
        expect(current.body.active).toBe(true);

        const list = await admin().get(`/nhi/${identityId}/credentials`);
        const status = Object.fromEntries(
          list.body.map((c: { id: string; status: string }) => [
            c.id,
            c.status,
          ]),
        );
        expect(status[firstCredentialId]).toBe('expired');
        expect(status[renewedCredentialId]).toBe('active');
      });
    });

    it('an inactive identity is refused, and its tokens stop introspecting as active', async () => {
      const token = (await tokenFor(clientId, renewed)).body.access_token;
      const tokens = ctx.app.get(TokensService);
      const realm = await ctx.prisma.realm.findUniqueOrThrow({
        where: { id: seeded.realm.id },
      });
      expect((await tokens.introspect(realm, token)).active).toBe(true);

      const suspended = await admin().post(`/nhi/${identityId}/suspend`);
      expect(suspended.status).toBe(200);
      const refused = await tokenFor(clientId, renewed);
      expect(refused.status).toBe(401);
      expect(refused.body.error).toBe('invalid_client');
      expect(await tokens.introspect(realm, token)).toEqual({ active: false });

      const reactivated = await admin().post(`/nhi/${identityId}/reactivate`);
      expect(reactivated.status).toBe(200);
      expect((await tokenFor(clientId, renewed)).status).toBe(200);
      expect((await tokens.introspect(realm, token)).active).toBe(true);
    });

    it("is refused while the realm's certificate authentication is off", async () => {
      await admin().patch('').send({ mtlsClientAuthEnabled: false });
      try {
        expect((await tokenFor(clientId, renewed)).status).toBe(401);
      } finally {
        await admin().patch('').send({ mtlsClientAuthEnabled: true });
      }
      expect((await tokenFor(clientId, renewed)).status).toBe(200);
    });

    it('a cross-realm attempt is refused', async () => {
      // The client does not exist in the other realm.
      const elsewhere = await tokenFor(clientId, renewed, [], other.realm.name);
      expect(elsewhere.status).toBe(401);

      // The other realm cannot reach this identity or bind it.
      expect(
        (await admin(other.realm.name).get(`/nhi/${identityId}`)).status,
      ).toBe(404);
      expect(
        (
          await admin(other.realm.name)
            .post(`/nhi/${identityId}/oauth-client`)
            .send({ tokenEndpointAuthMethod: 'self_signed_tls_client_auth' })
        ).status,
      ).toBe(404);

      // The same certificate on another realm's identity authenticates only
      // that identity's own client, there.
      const twin = await createIdentity('sensor-1-twin', other.realm.name);
      await admin(other.realm.name)
        .post(`/nhi/${twin.id}/credentials`)
        .send({
          name: 'c',
          tlsAuthMode: 'SELF_SIGNED',
          certificatePem: renewed.pem,
        })
        .expect(201);
      const twinClient = await admin(other.realm.name)
        .post(`/nhi/${twin.id}/oauth-client`)
        .send({});
      expect(twinClient.status).toBe(201);
      expect((await tokenFor(twinClient.body.clientId, renewed)).status).toBe(
        401,
      );
      expect(
        (
          await tokenFor(
            twinClient.body.clientId,
            renewed,
            [],
            other.realm.name,
          )
        ).status,
      ).toBe(200);

      // The database refuses to bind a client to another realm's identity.
      const otherClient = await ctx.prisma.client.findFirstOrThrow({
        where: { realmId: other.realm.id, nhiIdentityId: null },
      });
      await expect(
        ctx.prisma.client.update({
          where: { id: otherClient.id },
          data: { nhiIdentityId: identityId },
        }),
      ).rejects.toThrow(/another realm/);
    });

    it('deleting the identity deletes its OAuth client', async () => {
      const removed = await admin().delete(`/nhi/${identityId}`);
      expect(removed.status).toBe(204);
      expect(
        await ctx.prisma.client.findFirst({
          where: { clientId, realmId: seeded.realm.id },
        }),
      ).toBeNull();
      expect((await tokenFor(clientId, renewed)).status).toBe(401);
    });
  });

  describe('a PKI device (tls_client_auth)', () => {
    let identityId: string;
    let clientId: string;

    beforeAll(async () => {
      const anchor = await admin()
        .post('/tls-trust-anchors')
        .send({ certificatePem: pki.root.pem });
      expect(anchor.status).toBe(201);
      identityId = (await createIdentity('sensor-pki')).id;
      const credential = await admin()
        .post(`/nhi/${identityId}/credentials`)
        .send({
          name: 'fleet rule',
          tlsAuthMode: 'PKI',
          tlsClientAuthSanDns: 'sensor-pki.devices.example',
        });
      expect(credential.status).toBe(201);
      const client = await admin()
        .post(`/nhi/${identityId}/oauth-client`)
        .send({});
      expect(client.status).toBe(201);
      expect(client.body.tokenEndpointAuthMethod).toBe('tls_client_auth');
      clientId = client.body.clientId;
    });

    it('a CA-issued certificate matching the rule gets a bound token', async () => {
      const res = await tokenFor(clientId, pki.leaf, [pki.intermediate]);
      expect(res.status).toBe(200);
      expect(claims(res.body.access_token).cnf).toEqual({
        'x5t#S256': x5tOf(pki.leaf),
      });
      const introspected = await introspect(
        clientId,
        res.body.access_token,
        pki.leaf,
        [pki.intermediate],
      );
      expect(introspected.status).toBe(200);
      expect(introspected.body).toMatchObject({
        active: true,
        cnf: { 'x5t#S256': x5tOf(pki.leaf) },
      });
    });

    it('a self-signed certificate with the same name is refused', async () => {
      const lookalike = await issue({
        cn: 'sensor-pki',
        san: [{ type: 'dns', value: 'sensor-pki.devices.example' }],
      });
      expect((await tokenFor(clientId, lookalike)).status).toBe(401);
    });
  });
});
