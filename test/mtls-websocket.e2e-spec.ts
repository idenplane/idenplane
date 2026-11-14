import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpsRequest } from 'node:https';
import request from 'supertest';
import type { App } from 'supertest/types';
import { WebSocket } from 'ws';
import {
  createTestApp,
  TEST_ADMIN_API_KEY,
  type SeededRealm,
  type TestContext,
} from './setup';
import { startCertificateListener } from '../src/realtime/certificate-listener';
import { SessionEventsGateway } from '../src/realtime/session-events.gateway';
import { makeTestCertificate } from '../src/nhi/__mocks__/certificate.fixture';
import {
  issue,
  type TestIdentity,
} from '../src/client-auth/__mocks__/test-pki';

/**
 * The session events WebSocket over the certificate listener: a
 * certificate-bound token is accepted only over a handshake with its own
 * certificate, read from the TLS socket. Only the gateway's path upgrades.
 */

const MTLS_ENV = [
  'MTLS_ENABLED',
  'MTLS_LISTEN_PORT',
  'MTLS_LISTEN_HOST',
  'MTLS_TLS_CERT_FILE',
  'MTLS_TLS_KEY_FILE',
] as const;

type Outcome =
  | { kind: 'open'; ws: WebSocket }
  | { kind: 'refused'; status: number }
  | { kind: 'error'; message: string };

/** The payload of a JWT, unverified. */
const claims = (jwt: string) =>
  JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));

describe('session events WebSocket over the mTLS listener (e2e)', () => {
  let ctx: TestContext;
  let seeded: SeededRealm;
  let dir: string;
  let port: number;
  let closed = false;
  let serverCertificate: Awaited<ReturnType<typeof makeTestCertificate>>;
  let alice: TestIdentity;
  let bob: TestIdentity;
  let aliceToken: string;
  const saved: Partial<Record<(typeof MTLS_ENV)[number], string>> = {};
  const opened: WebSocket[] = [];

  const http = () => request(ctx.app.getHttpServer() as App);
  const realmPath = () => `/admin/realms/${seeded.realm.name}`;

  /** Opens a WebSocket on the listener, with `identity`'s certificate. */
  function connect(path: string, identity?: TestIdentity): Promise<Outcome> {
    return new Promise((resolve) => {
      const ws = new WebSocket(`wss://127.0.0.1:${port}${path}`, {
        servername: 'localhost',
        ca: serverCertificate.pem,
        ...(identity
          ? { cert: identity.pem, key: identity.privateKeyPem }
          : {}),
      });
      ws.once('open', () => {
        opened.push(ws);
        resolve({ kind: 'open', ws });
      });
      ws.once('unexpected-response', (_req, res) => {
        resolve({ kind: 'refused', status: res.statusCode ?? 0 });
        res.resume();
        ws.terminate();
      });
      ws.once('error', (err) =>
        resolve({ kind: 'error', message: err.message }),
      );
    });
  }

  const eventsPath = (token: string) =>
    `/ws/events?realm=${encodeURIComponent(seeded.realm.name)}&token=${encodeURIComponent(token)}`;

  /** A token request over the listener with `identity`'s certificate. */
  function machineToken(identity: TestIdentity): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: 'ws-machine',
    }).toString();
    return new Promise((resolve, reject) => {
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
          cert: identity.pem,
          key: identity.privateKeyPem,
          agent: false,
        },
        (res) => {
          let text = '';
          res.on('data', (chunk) => (text += chunk));
          res.on('end', () => {
            if (res.statusCode !== 200) {
              reject(new Error(`token ${res.statusCode}: ${text}`));
              return;
            }
            resolve(JSON.parse(text).access_token);
          });
        },
      );
      req.on('error', reject);
      req.end(body);
    });
  }

  beforeAll(async () => {
    for (const name of MTLS_ENV) saved[name] = process.env[name];
    serverCertificate = await makeTestCertificate({
      name: 'localhost',
      dns: 'localhost',
      isCA: true,
    });
    dir = mkdtempSync(join(tmpdir(), 'idenplane-mtls-ws-'));
    writeFileSync(join(dir, 'tls.crt'), serverCertificate.pem);
    writeFileSync(join(dir, 'tls.key'), serverCertificate.privateKeyPem);

    process.env['MTLS_ENABLED'] = 'true';
    process.env['MTLS_LISTEN_PORT'] = '0';
    process.env['MTLS_LISTEN_HOST'] = '127.0.0.1';
    process.env['MTLS_TLS_CERT_FILE'] = join(dir, 'tls.crt');
    process.env['MTLS_TLS_KEY_FILE'] = join(dir, 'tls.key');

    ctx = await createTestApp();
    seeded = await ctx.seedTestRealm('e2e-mtls-websocket');
    // The same wiring main.ts uses.
    const address = await startCertificateListener(ctx.app);
    if (!address) throw new Error('mTLS listener did not start');
    port = address.port;

    alice = await issue({ cn: 'alice-ws' });
    bob = await issue({ cn: 'bob-ws' });

    const realmRes = await http()
      .patch(realmPath())
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .send({ mtlsClientAuthEnabled: true });
    expect(realmRes.status).toBe(200);

    const client = await http()
      .post(`${realmPath()}/clients`)
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .send({
        clientId: 'ws-machine',
        grantTypes: ['client_credentials'],
        tokenEndpointAuthMethod: 'self_signed_tls_client_auth',
        tlsClientCertificateBoundAccessTokens: true,
      });
    expect(client.status).toBe(201);
    for (const identity of [alice, bob]) {
      const upload = await http()
        .post(`${realmPath()}/clients/ws-machine/tls-certificates`)
        .set('x-admin-api-key', TEST_ADMIN_API_KEY)
        .send({ certificatePem: identity.pem });
      expect(upload.status).toBe(201);
    }

    aliceToken = await machineToken(alice);
    expect(claims(aliceToken).cnf).toEqual({
      'x5t#S256': expect.any(String),
    });
  });

  afterAll(async () => {
    for (const ws of opened) ws.terminate();
    if (!closed) {
      await ctx?.prisma.realm.deleteMany({
        where: { name: 'e2e-mtls-websocket' },
      });
      await ctx?.cleanup();
    }
    for (const name of MTLS_ENV) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('accepts a bound token over a handshake with its certificate, and delivers events', async () => {
    const outcome = await connect(eventsPath(aliceToken), alice);
    expect(outcome.kind).toBe('open');
    const ws = (outcome as { ws: WebSocket }).ws;

    const message = new Promise<Record<string, unknown>>((resolve) =>
      ws.once('message', (data) => resolve(JSON.parse(String(data)))),
    );
    ctx.app
      .get(SessionEventsGateway)
      .emitSessionTerminated(claims(aliceToken).sub, {
        sessionId: 'sess-ws',
        reason: 'test',
        timestamp: '2026-11-14T00:00:00.000Z',
      });
    expect(await message).toEqual({
      type: 'session.terminated',
      sessionId: 'sess-ws',
      reason: 'test',
      timestamp: '2026-11-14T00:00:00.000Z',
    });
    ws.close();
  });

  it('refuses the bound token over a handshake with a different certificate: 401', async () => {
    expect(await connect(eventsPath(aliceToken), bob)).toEqual({
      kind: 'refused',
      status: 401,
    });
  });

  it('refuses the bound token without a client certificate: 401', async () => {
    expect(await connect(eventsPath(aliceToken))).toEqual({
      kind: 'refused',
      status: 401,
    });
  });

  it('refuses an invalid token: 401', async () => {
    expect(await connect(eventsPath('not-a-jwt'), alice)).toEqual({
      kind: 'refused',
      status: 401,
    });
  });

  it.each([
    `/realms/e2e-mtls-websocket/protocol/openid-connect/token`,
    '/ws/events/',
    '/ws/other',
    '/ws/%65vents',
    '//ws/events',
    '/admin/realms',
  ])('refuses an upgrade of %s: 404', async (path) => {
    expect(
      await connect(
        `${path}?realm=e2e-mtls-websocket&token=${aliceToken}`,
        alice,
      ),
    ).toEqual({
      kind: 'refused',
      status: 404,
    });
  });

  it('still serves the OAuth aliases over HTTP on the same listener', async () => {
    const token = await machineToken(bob);
    expect(claims(token).cnf).toBeDefined();
  });

  it('closes open sockets on shutdown instead of hanging', async () => {
    const outcome = await connect(eventsPath(aliceToken), alice);
    expect(outcome.kind).toBe('open');
    const ws = (outcome as { ws: WebSocket }).ws;
    const closedSocket = new Promise<number>((resolve) =>
      ws.once('close', (code) => resolve(code)),
    );

    await ctx.prisma.realm.deleteMany({
      where: { name: 'e2e-mtls-websocket' },
    });
    closed = true;
    await ctx.cleanup();
    expect([1001, 1006]).toContain(await closedSocket);
  }, 20000);
});
