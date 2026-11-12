import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpsRequest } from 'node:https';
import type { RequestListener } from 'node:http';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, type SeededRealm, type TestContext } from './setup';
import { MtlsServerService } from '../src/mtls/mtls-server';
import { makeTestCertificate } from '../src/nhi/__mocks__/certificate.fixture';

const MTLS_ENV = [
  'MTLS_ENABLED',
  'MTLS_LISTEN_PORT',
  'MTLS_LISTEN_HOST',
  'MTLS_TLS_CERT_FILE',
  'MTLS_TLS_KEY_FILE',
] as const;

interface Response {
  status: number;
  body: string;
}

describe('mTLS listener (e2e)', () => {
  let ctx: TestContext;
  let seeded: SeededRealm;
  let dir: string;
  let port: number;
  let serverCertificate: Awaited<ReturnType<typeof makeTestCertificate>>;
  let clientCertificate: Awaited<ReturnType<typeof makeTestCertificate>>;
  const saved: Partial<Record<(typeof MTLS_ENV)[number], string>> = {};

  beforeAll(async () => {
    serverCertificate = await makeTestCertificate({
      name: 'localhost',
      dns: 'localhost',
      isCA: true,
    });
    clientCertificate = await makeTestCertificate({ name: 'mtls-e2e-client' });
    dir = mkdtempSync(join(tmpdir(), 'idenplane-mtls-'));
    writeFileSync(join(dir, 'tls.crt'), serverCertificate.pem);
    writeFileSync(join(dir, 'tls.key'), serverCertificate.privateKeyPem);

    for (const name of MTLS_ENV) saved[name] = process.env[name];
    process.env['MTLS_ENABLED'] = 'true';
    process.env['MTLS_LISTEN_PORT'] = '0';
    process.env['MTLS_LISTEN_HOST'] = '127.0.0.1';
    process.env['MTLS_TLS_CERT_FILE'] = join(dir, 'tls.crt');
    process.env['MTLS_TLS_KEY_FILE'] = join(dir, 'tls.key');

    ctx = await createTestApp();
    seeded = await ctx.seedTestRealm('e2e-mtls-listener');

    const handler = ctx.app.getHttpAdapter().getInstance() as RequestListener;
    const address = await ctx.app.get(MtlsServerService).start(handler);
    if (!address) throw new Error('mTLS listener did not start');
    port = address.port;
  });

  afterAll(async () => {
    await ctx?.prisma.realm.deleteMany({
      where: { name: 'e2e-mtls-listener' },
    });
    await ctx?.cleanup();
    for (const name of MTLS_ENV) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    rmSync(dir, { recursive: true, force: true });
  });

  function get(path: string, withCertificate = true): Promise<Response> {
    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        {
          hostname: '127.0.0.1',
          servername: 'localhost',
          port,
          path,
          method: 'GET',
          ca: serverCertificate.pem,
          ...(withCertificate
            ? {
                cert: clientCertificate.pem,
                key: clientCertificate.privateKeyPem,
              }
            : {}),
          agent: false,
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  it('serves discovery to a client that presents a certificate', async () => {
    const res = await get(
      `/realms/${seeded.realm.name}/.well-known/openid-configuration`,
    );
    expect(res.status).toBe(200);
    const document = JSON.parse(res.body) as {
      issuer: string;
      token_endpoint: string;
    };
    expect(document.issuer).toContain(`/realms/${seeded.realm.name}`);
    expect(document.token_endpoint).toContain('/protocol/openid-connect/token');
  });

  it('serves the token endpoint alias', async () => {
    const res = await new Promise<Response>((resolve, reject) => {
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: seeded.client.clientId,
        client_secret: 'test-client-secret',
      }).toString();
      const req = httpsRequest(
        {
          hostname: '127.0.0.1',
          servername: 'localhost',
          port,
          path: `/realms/${seeded.realm.name}/protocol/openid-connect/token`,
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'content-length': Buffer.byteLength(body),
          },
          ca: serverCertificate.pem,
          cert: clientCertificate.pem,
          key: clientCertificate.privateKeyPem,
          agent: false,
        },
        (response) => {
          let text = '';
          response.on('data', (chunk) => (text += chunk));
          response.on('end', () =>
            resolve({ status: response.statusCode ?? 0, body: text }),
          );
        },
      );
      req.on('error', reject);
      req.end(body);
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).access_token).toEqual(expect.any(String));
  });

  it('accepts a client without a certificate at the handshake', async () => {
    const res = await get(
      `/realms/${seeded.realm.name}/.well-known/openid-configuration`,
      false,
    );
    expect(res.status).toBe(200);
  });

  it('returns 404 for a path the main listener serves but that is not an alias', async () => {
    const main = await request(ctx.app.getHttpServer() as App).get('/api-json');
    expect(main.status).toBe(200);

    expect((await get('/api-json')).status).toBe(404);
    expect((await get(`/admin/realms/${seeded.realm.name}`)).status).toBe(404);
    expect((await get(`/realms/${seeded.realm.name}/login`)).status).toBe(404);
  });

  it('returns 404 for a path that only normalises to an alias', async () => {
    const realm = seeded.realm.name;
    for (const path of [
      `/realms/${realm}/protocol/openid-connect/token/../../../../api-json`,
      `/realms/${realm}/%2e%2e/.well-known/openid-configuration`,
      `//realms/${realm}/.well-known/openid-configuration`,
    ]) {
      expect((await get(path)).status).toBe(404);
    }
  });
});
