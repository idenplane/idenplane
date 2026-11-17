/**
 * OpenID Connect Back-Channel Logout 1.0 when Idenplane ends sessions
 * itself: the admin API (one session, or all of a user's) and the SSO idle
 * timeout. A local HTTP server stands in for the relying party's
 * `backchannel_logout_uri`; each test checks that a valid logout token
 * arrived for exactly the sessions that ended, and only at the clients they
 * were used with.
 */
import type { INestApplication } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import type { App } from 'supertest/types';
import { decodeJwt, importSPKI, jwtVerify, type JWTPayload } from 'jose';
import { SessionsCleanupService } from '../src/sessions/sessions-cleanup.service.js';
import {
  createTestApp,
  TEST_ADMIN_API_KEY,
  type SeededRealm,
  type TestContext,
} from './setup';

const REALM = 'e2e-bc-logout-admin';
const EVENT = 'http://schemas.openid.net/event/backchannel-logout';

interface Received {
  path: string;
  contentType: string | undefined;
  logoutToken: string;
}

describe('Back-channel logout on administrative sign-out (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;
  let receiver: Server;
  let baseUri: string;
  let received: Received[] = [];
  let publicKeyPem: string;

  const http = () => request(app.getHttpServer());

  /** Signs the seeded user in to `test-client`; returns the session id. */
  const signIn = async (): Promise<string> => (await signInTokens()).sid;

  /** Signs the seeded user in; returns the session id and refresh token. */
  const signInTokens = async (): Promise<{
    sid: string;
    refreshToken: string;
  }> => {
    const res = await http()
      .post(`/realms/${REALM}/protocol/openid-connect/token`)
      .send({
        grant_type: 'password',
        client_id: 'test-client',
        client_secret: 'test-client-secret',
        username: 'testuser',
        password: 'TestPassword123!',
        scope: 'openid',
      })
      .expect(200);
    // The ID token and the access token both carry the session id.
    const token = (res.body.id_token ?? res.body.access_token) as string;
    const sid = decodeJwt(token)['sid'];
    expect(typeof sid).toBe('string');
    return {
      sid: sid as string,
      refreshToken: res.body.refresh_token as string,
    };
  };

  /** Ends the user's sessions without announcing them, between tests. */
  const quietlyClearSessions = async () => {
    await ctx.prisma.session.deleteMany({ where: { userId: seeded.user.id } });
    received = [];
  };

  const refresh = (refreshToken: string) =>
    http().post(`/realms/${REALM}/protocol/openid-connect/token`).send({
      grant_type: 'refresh_token',
      client_id: 'test-client',
      client_secret: 'test-client-secret',
      refresh_token: refreshToken,
    });

  /** Waits until `count` logout tokens have arrived (or fails after 10s). */
  const waitForTokens = async (count: number): Promise<Received[]> => {
    const deadline = Date.now() + 10_000;
    while (received.length < count && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    // A little longer, so an unexpected extra delivery would show up too.
    await new Promise((resolve) => setTimeout(resolve, 300));
    return received;
  };

  /** Verifies a logout token as an RP must (Back-Channel Logout 1.0 §2.6). */
  const verifyLogoutToken = async (
    token: string,
    audience: string,
  ): Promise<JWTPayload> => {
    const key = await importSPKI(publicKeyPem, 'RS256');
    const { payload, protectedHeader } = await jwtVerify(token, key, {
      issuer: `${process.env['BASE_URL'] ?? 'http://localhost:3000'}/realms/${REALM}`,
      audience,
      typ: 'logout+jwt',
      maxTokenAge: '2 minutes',
    });
    expect(protectedHeader.alg).toBe('RS256');
    expect(payload.iat).toEqual(expect.any(Number));
    expect(payload.jti).toEqual(expect.any(String));
    expect(payload['events']).toEqual({ [EVENT]: {} });
    expect(payload).not.toHaveProperty('nonce');
    expect(payload.sub).toBe(seeded.user.id);
    return payload;
  };

  beforeAll(async () => {
    receiver = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      req.on('end', () => {
        received.push({
          path: req.url ?? '',
          contentType: req.headers['content-type'],
          logoutToken: new URLSearchParams(body).get('logout_token') ?? '',
        });
        res.writeHead(200).end();
      });
    });
    await new Promise<void>((resolve) =>
      receiver.listen(0, '127.0.0.1', resolve),
    );
    baseUri = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;

    ctx = await createTestApp();
    app = ctx.app as INestApplication<App>;
    seeded = await ctx.seedTestRealm(REALM);

    // The app the user signs in to: wants sid.
    await ctx.prisma.client.update({
      where: { id: seeded.client.id },
      data: {
        backchannelLogoutUri: `${baseUri}/used`,
        backchannelLogoutSessionRequired: true,
      },
    });
    // Another app of the realm the user never used: must hear nothing.
    await ctx.prisma.client.create({
      data: {
        realmId: seeded.realm.id,
        clientId: 'unused-client',
        clientType: 'CONFIDENTIAL',
        redirectUris: ['http://localhost:3000/cb'],
        backchannelLogoutUri: `${baseUri}/unused`,
      },
    });

    const key = await ctx.prisma.realmSigningKey.findUniqueOrThrow({
      where: { id: seeded.signingKey.id },
    });
    publicKeyPem = key.publicKey;
  }, 30_000);

  beforeEach(() => {
    received = [];
  });

  afterAll(async () => {
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
    await new Promise((resolve) => receiver.close(resolve));
  });

  it('signing a user out of all sessions sends a logout token per session, offline ones included', async () => {
    const normal = await signIn();
    const offline = await signIn();
    // An offline session differs only in its refresh tokens; the sign-out
    // revokes those too, so its client is told as well.
    await ctx.prisma.refreshToken.updateMany({
      where: { sessionId: offline },
      data: { isOffline: true },
    });

    await http()
      .delete(`/admin/realms/${REALM}/users/${seeded.user.id}/sessions`)
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .expect(204);

    const tokens = await waitForTokens(2);
    expect(tokens).toHaveLength(2);
    for (const t of tokens) {
      expect(t.path).toBe('/used');
      expect(t.contentType).toBe('application/x-www-form-urlencoded');
    }
    const sids = await Promise.all(
      tokens.map(
        async (t) =>
          (await verifyLogoutToken(t.logoutToken, 'test-client')).sid,
      ),
    );
    expect(sids.sort()).toEqual([normal, offline].sort());
    expect(
      await ctx.prisma.session.count({ where: { userId: seeded.user.id } }),
    ).toBe(0);
  });

  it('ending one session from the admin API sends a logout token for that session only', async () => {
    const ended = await signIn();
    const kept = await signIn();

    await http()
      .delete(`/admin/realms/${REALM}/sessions/${ended}`)
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .expect(204);

    const tokens = await waitForTokens(1);
    expect(tokens).toHaveLength(1);
    const payload = await verifyLogoutToken(
      tokens[0].logoutToken,
      'test-client',
    );
    expect(payload.sid).toBe(ended);
    expect(
      await ctx.prisma.session.findUnique({ where: { id: kept } }),
    ).not.toBeNull();
  });

  it('a client that does not require sid gets sub only', async () => {
    await ctx.prisma.client.update({
      where: { id: seeded.client.id },
      data: { backchannelLogoutSessionRequired: false },
    });
    try {
      await signIn();
      await signIn();

      await http()
        .delete(`/admin/realms/${REALM}/users/${seeded.user.id}/sessions`)
        .set('x-admin-api-key', TEST_ADMIN_API_KEY)
        .expect(204);

      // One token for the user, not one per session.
      const tokens = await waitForTokens(1);
      expect(tokens).toHaveLength(1);
      const payload = await verifyLogoutToken(
        tokens[0].logoutToken,
        'test-client',
      );
      expect(payload).not.toHaveProperty('sid');
    } finally {
      await ctx.prisma.client.update({
        where: { id: seeded.client.id },
        data: { backchannelLogoutSessionRequired: true },
      });
    }
  });

  it('an RP that is down does not fail or slow the sign-out', async () => {
    await ctx.prisma.client.update({
      where: { id: seeded.client.id },
      // Nothing listens on port 9 (discard) on the loopback interface.
      data: { backchannelLogoutUri: 'http://127.0.0.1:9/down' },
    });
    try {
      await signIn();
      const started = Date.now();
      await http()
        .delete(`/admin/realms/${REALM}/users/${seeded.user.id}/sessions`)
        .set('x-admin-api-key', TEST_ADMIN_API_KEY)
        .expect(204);
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      await ctx.prisma.client.update({
        where: { id: seeded.client.id },
        data: { backchannelLogoutUri: `${baseUri}/used` },
      });
    }
  });

  it('the SSO idle timeout ends an unused OAuth session and tells its client', async () => {
    await ctx.prisma.realm.update({
      where: { id: seeded.realm.id },
      data: { ssoSessionIdleTimeout: 600 },
    });
    try {
      const idle = await signIn();
      const active = await signIn();
      // The idle session's refresh token went unused past the timeout.
      await ctx.prisma.refreshToken.updateMany({
        where: { sessionId: idle },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await app.get(SessionsCleanupService).cleanupExpiredSessions();

      const tokens = await waitForTokens(1);
      expect(tokens).toHaveLength(1);
      expect(tokens[0].path).toBe('/used');
      const payload = await verifyLogoutToken(
        tokens[0].logoutToken,
        'test-client',
      );
      expect(payload.sid).toBe(idle);
      expect(
        await ctx.prisma.session.findUnique({ where: { id: idle } }),
      ).toBeNull();
      expect(
        await ctx.prisma.session.findUnique({ where: { id: active } }),
      ).not.toBeNull();
    } finally {
      await ctx.prisma.realm.update({
        where: { id: seeded.realm.id },
        data: { ssoSessionIdleTimeout: 0 },
      });
    }
  });

  it('a session evicted by maxSessionsPerUser is announced', async () => {
    await quietlyClearSessions();
    await ctx.prisma.realm.update({
      where: { id: seeded.realm.id },
      data: { maxSessionsPerUser: 1 },
    });
    try {
      const evicted = await signIn();
      const kept = await signIn();

      const tokens = await waitForTokens(1);
      expect(tokens).toHaveLength(1);
      const payload = await verifyLogoutToken(
        tokens[0].logoutToken,
        'test-client',
      );
      expect(payload.sid).toBe(evicted);
      expect(
        await ctx.prisma.session.findUnique({ where: { id: kept } }),
      ).not.toBeNull();
    } finally {
      await ctx.prisma.realm.update({
        where: { id: seeded.realm.id },
        data: { maxSessionsPerUser: 10 },
      });
    }
  });

  it('a session ended by refresh token reuse is announced', async () => {
    await quietlyClearSessions();
    const { sid, refreshToken } = await signInTokens();
    await refresh(refreshToken).expect(200);

    // The first token again: reuse, so the whole session ends.
    const reuse = await refresh(refreshToken);
    expect(reuse.status).toBe(400);

    const tokens = await waitForTokens(1);
    expect(tokens).toHaveLength(1);
    const payload = await verifyLogoutToken(
      tokens[0].logoutToken,
      'test-client',
    );
    expect(payload.sid).toBe(sid);
    expect(
      await ctx.prisma.session.findUnique({ where: { id: sid } }),
    ).toBeNull();
  });

  it("the user's own logout reaches every client with a URI when no token records its client", async () => {
    await quietlyClearSessions();
    const { sid, refreshToken } = await signInTokens();
    // A refresh token from before tokens recorded their client.
    await ctx.prisma.refreshToken.updateMany({
      where: { sessionId: sid },
      data: { clientId: null },
    });

    await http()
      .post(`/realms/${REALM}/protocol/openid-connect/logout`)
      .send({ refresh_token: refreshToken })
      .expect(204);

    // No authorization code either (a password grant): every client of the
    // realm with a back-channel URI is told, each naming the session.
    const tokens = await waitForTokens(2);
    expect(tokens.map((t) => t.path).sort()).toEqual(['/unused', '/used']);
    for (const t of tokens) {
      const audience = t.path === '/used' ? 'test-client' : 'unused-client';
      const payload = await verifyLogoutToken(t.logoutToken, audience);
      expect(payload.sid).toBe(sid);
    }
  });

  it('a back-channel URI on the cloud metadata address gets nothing, and the sign-out still succeeds', async () => {
    await quietlyClearSessions();
    await ctx.prisma.client.update({
      where: { id: seeded.client.id },
      data: { backchannelLogoutUri: 'http://169.254.169.254/latest/meta-data' },
    });
    try {
      await signIn();
      await http()
        .delete(`/admin/realms/${REALM}/users/${seeded.user.id}/sessions`)
        .set('x-admin-api-key', TEST_ADMIN_API_KEY)
        .expect(204);
      // Refused before any connection: nothing to observe but the absence
      // of a delivery anywhere, and a sign-out that went through.
      expect(await waitForTokens(1)).toHaveLength(0);
      expect(
        await ctx.prisma.session.count({ where: { userId: seeded.user.id } }),
      ).toBe(0);
    } finally {
      await ctx.prisma.client.update({
        where: { id: seeded.client.id },
        data: { backchannelLogoutUri: `${baseUri}/used` },
      });
    }
  });
});
