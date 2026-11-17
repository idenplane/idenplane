import { lookupsBackedBy } from '../cache/cached-lookups.mock.js';
// Mock JwkService module to avoid importing jose (ESM-only)
jest.mock('../crypto/jwk.service.js', () => ({
  JwkService: jest.fn(),
}));
// No DNS in unit tests: the link-local check is its own unit, mocked here.
jest.mock('../common/security/safe-http-client.js', () => ({
  assertNotLinkLocalTarget: jest.fn().mockResolvedValue(undefined),
}));

import { Logger } from '@nestjs/common';
import { assertNotLinkLocalTarget } from '../common/security/safe-http-client.js';
import {
  BACKCHANNEL_LOGOUT_EVENT,
  BackchannelLogoutService,
  type EndedSession,
} from './backchannel-logout.service.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';
import type { Realm } from '@prisma/client';

/** Drain the promise queue so fire-and-forget work completes. */
const flushPromises = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

describe('BackchannelLogoutService', () => {
  let service: BackchannelLogoutService;
  let prisma: MockPrismaService;
  let mockJwkService: { signJwt: jest.Mock };
  let originalFetch: typeof global.fetch;
  let warn: jest.SpyInstance;

  const realm = { id: 'realm-1', name: 'test-realm' } as Realm;

  const mockSigningKey = {
    id: 'key-1',
    realmId: 'realm-1',
    kid: 'kid-1',
    privateKey: 'mock-private-key',
    active: true,
    createdAt: new Date(),
  };

  const client = (
    clientId: string,
    sessionRequired: boolean,
    uri = `https://${clientId}.example.com/logout`,
  ) => ({
    clientId,
    backchannelLogoutUri: uri,
    backchannelLogoutSessionRequired: sessionRequired,
  });

  const session = (
    id: string,
    clientIds: (string | null)[],
    userId = 'user-1',
  ): EndedSession => ({ id, userId, clientIds });

  beforeEach(() => {
    prisma = createMockPrismaService();
    mockJwkService = { signJwt: jest.fn().mockResolvedValue('mock.jwt.token') };
    service = new BackchannelLogoutService(
      lookupsBackedBy(prisma as any) as any,
      prisma as any,
      mockJwkService as any,
    );
    prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);

    originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    (assertNotLinkLocalTarget as jest.Mock)
      .mockReset()
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    warn.mockRestore();
  });

  describe('endedSessions', () => {
    it('reads each session with the distinct clients of its refresh tokens', async () => {
      prisma.session.findMany.mockResolvedValue([
        {
          id: 's-1',
          userId: 'user-1',
          refreshTokens: [{ clientId: 'app-1' }, { clientId: null }],
        },
      ]);

      await expect(service.endedSessions(['s-1'])).resolves.toEqual([
        { id: 's-1', userId: 'user-1', clientIds: ['app-1', null] },
      ]);
      expect(prisma.session.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['s-1'] } },
        select: {
          id: true,
          userId: true,
          refreshTokens: {
            select: { clientId: true },
            distinct: ['clientId'],
          },
        },
      });
    });

    it('reads nothing for no sessions', async () => {
      await expect(service.endedSessions([])).resolves.toEqual([]);
      expect(prisma.session.findMany).not.toHaveBeenCalled();
    });
  });

  describe('dispatch', () => {
    it('asks only for the clients the ended sessions were used with', async () => {
      prisma.client.findMany.mockResolvedValue([]);

      await service.dispatch(realm, [
        session('s-1', ['app-1', 'app-2']),
        session('s-2', ['app-1', null]),
      ]);

      expect(prisma.client.findMany).toHaveBeenCalledWith({
        where: {
          realmId: 'realm-1',
          clientId: { in: ['app-1', 'app-2'] },
          backchannelLogoutUri: { not: null },
        },
        select: {
          clientId: true,
          backchannelLogoutUri: true,
          backchannelLogoutSessionRequired: true,
        },
      });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('builds a spec-compliant logout token: iss, aud, sub, sid, events, no nonce, typed', async () => {
      prisma.client.findMany.mockResolvedValue([client('app-1', true)]);

      await service.dispatch(realm, [session('s-1', ['app-1'])]);

      expect(mockJwkService.signJwt).toHaveBeenCalledTimes(1);
      const [payload, key, kid, lifetime, typ] =
        mockJwkService.signJwt.mock.calls[0];
      expect(payload).toEqual({
        iss: expect.stringMatching(/\/realms\/test-realm$/),
        aud: 'app-1',
        sub: 'user-1',
        sid: 's-1',
        events: { [BACKCHANNEL_LOGOUT_EVENT]: {} },
      });
      // iat and jti are set by JwkService.signJwt on every token.
      expect(payload).not.toHaveProperty('nonce');
      expect(key).toBe('mock-private-key');
      expect(kid).toBe('kid-1');
      expect(lifetime).toBe(120);
      expect(typ).toBe('logout+jwt');
    });

    it('POSTs the token form-encoded to the registered URI, never following a redirect', async () => {
      prisma.client.findMany.mockResolvedValue([client('app-1', true)]);

      await service.dispatch(realm, [session('s-1', ['app-1'])]);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://app-1.example.com/logout',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'logout_token=mock.jwt.token',
          redirect: 'error',
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it('sends one token per session, with sid, to a client that requires sid', async () => {
      prisma.client.findMany.mockResolvedValue([client('app-1', true)]);

      await service.dispatch(
        realm,
        [
          session('s-1', ['app-1']),
          session('s-2', ['app-1']),
          session('s-3', ['other-app']),
        ],
        { allSessionsOfUser: true },
      );

      const sids = mockJwkService.signJwt.mock.calls.map((c) => c[0].sid);
      expect(sids.sort()).toEqual(['s-1', 's-2']);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('still names the session to a client that does not require sid when only some sessions ended', async () => {
      prisma.client.findMany.mockResolvedValue([client('app-1', false)]);

      await service.dispatch(realm, [session('s-1', ['app-1'])]);

      // A sub-only token would end the user's other sessions at the RP.
      expect(mockJwkService.signJwt).toHaveBeenCalledTimes(1);
      expect(mockJwkService.signJwt.mock.calls[0][0]).toMatchObject({
        sub: 'user-1',
        sid: 's-1',
      });
    });

    it('sends one sub-only token per user to a client that does not require sid when every session of the user ended', async () => {
      prisma.client.findMany.mockResolvedValue([client('app-1', false)]);

      await service.dispatch(
        realm,
        [session('s-1', ['app-1']), session('s-2', ['app-1'])],
        { allSessionsOfUser: true },
      );

      expect(mockJwkService.signJwt).toHaveBeenCalledTimes(1);
      const payload = mockJwkService.signJwt.mock.calls[0][0];
      expect(payload).not.toHaveProperty('sid');
      expect(payload).toMatchObject({ sub: 'user-1', aud: 'app-1' });
    });

    it('sends nothing without an active signing key, and logs it', async () => {
      prisma.client.findMany.mockResolvedValue([client('app-1', true)]);
      prisma.realmSigningKey.findFirst.mockResolvedValue(null);

      await service.dispatch(realm, [session('s-1', ['app-1'])]);

      expect(mockJwkService.signJwt).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('No active signing key'),
      );
    });

    it('logs a failed or refused delivery and carries on with the others', async () => {
      prisma.client.findMany.mockResolvedValue([
        client('down', true),
        client('refuses', true),
        client('fine', true),
      ]);
      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('down')) {
          return Promise.reject(new Error('connect ECONNREFUSED'));
        }
        if (url.includes('refuses')) {
          return Promise.resolve({ ok: false, status: 500 });
        }
        return Promise.resolve({ ok: true, status: 200 });
      });

      await expect(
        service.dispatch(realm, [session('s-1', ['down', 'refuses', 'fine'])]),
      ).resolves.toBeUndefined();

      expect(global.fetch).toHaveBeenCalledTimes(3);
      expect(warn).toHaveBeenCalledWith(
        'Back-channel logout to down in realm test-realm failed: connect ECONNREFUSED',
      );
      expect(warn).toHaveBeenCalledWith(
        'Back-channel logout to refuses in realm test-realm returned 500',
      );
    });

    it('never has more than 8 deliveries in flight', async () => {
      const clients = Array.from({ length: 20 }, (_, i) =>
        client(`app-${i}`, true),
      );
      prisma.client.findMany.mockResolvedValue(clients);
      let inFlight = 0;
      let peak = 0;
      (global.fetch as jest.Mock).mockImplementation(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setImmediate(resolve));
        inFlight--;
        return { ok: true, status: 200 };
      });

      await service.dispatch(realm, [
        session(
          's-1',
          clients.map((c) => c.clientId),
        ),
      ]);

      expect(global.fetch).toHaveBeenCalledTimes(20);
      expect(peak).toBe(8);
    });
  });

  describe('clients of a session whose refresh tokens name none', () => {
    it('falls back to the clients of the authorization codes it came from', async () => {
      prisma.authorizationCode.findMany = jest
        .fn()
        .mockResolvedValue([
          { sessionId: 's-old', client: { clientId: 'app-1' } },
        ]);
      prisma.client.findMany.mockResolvedValue([client('app-1', true)]);

      await service.dispatch(realm, [session('s-old', [null])]);

      expect(prisma.authorizationCode.findMany).toHaveBeenCalledWith({
        where: { sessionId: { in: ['s-old'] }, client: { realmId: 'realm-1' } },
        select: { sessionId: true, client: { select: { clientId: true } } },
      });
      expect(prisma.client.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ clientId: { in: ['app-1'] } }),
        }),
      );
      expect(mockJwkService.signJwt.mock.calls[0][0]).toMatchObject({
        aud: 'app-1',
        sid: 's-old',
      });
    });

    it('goes to every client of the realm with a back-channel URI when nothing names one', async () => {
      prisma.authorizationCode.findMany = jest.fn().mockResolvedValue([]);
      prisma.client.findMany.mockResolvedValue([
        client('app-1', true),
        client('app-2', false),
      ]);

      await service.dispatch(realm, [session('s-old', [null])]);

      // No clientId filter: the realm's clients with a URI.
      expect(prisma.client.findMany.mock.calls[0][0].where).toEqual({
        realmId: 'realm-1',
        backchannelLogoutUri: { not: null },
      });
      const sent = mockJwkService.signJwt.mock.calls.map((c) => c[0]);
      // Both name the session: one ended session is never sub-only.
      expect(sent).toEqual([
        expect.objectContaining({ aud: 'app-1', sid: 's-old' }),
        expect.objectContaining({ aud: 'app-2', sid: 's-old' }),
      ]);
    });

    it('does not look further when the refresh tokens name a client', async () => {
      prisma.authorizationCode.findMany = jest.fn();
      prisma.client.findMany.mockResolvedValue([]);

      await service.dispatch(realm, [session('s-1', ['app-1', null])]);

      expect(prisma.authorizationCode.findMany).not.toHaveBeenCalled();
    });
  });

  describe('link-local and cloud-metadata targets', () => {
    const original = process.env['BACKCHANNEL_LOGOUT_ALLOW_LINK_LOCAL'];
    afterEach(() => {
      if (original === undefined) {
        delete process.env['BACKCHANNEL_LOGOUT_ALLOW_LINK_LOCAL'];
      } else {
        process.env['BACKCHANNEL_LOGOUT_ALLOW_LINK_LOCAL'] = original;
      }
    });

    it('refuses a target the check rejects, logs it, and sends nothing there', async () => {
      delete process.env['BACKCHANNEL_LOGOUT_ALLOW_LINK_LOCAL'];
      prisma.client.findMany.mockResolvedValue([
        client('metadata', true, 'http://169.254.169.254/latest'),
      ]);
      (assertNotLinkLocalTarget as jest.Mock).mockRejectedValue(
        new Error(
          'Delivery blocked: target is a link-local or cloud-metadata address',
        ),
      );

      await service.dispatch(realm, [session('s-1', ['metadata'])]);

      expect(assertNotLinkLocalTarget).toHaveBeenCalledWith(
        'http://169.254.169.254/latest',
      );
      expect(global.fetch).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        'Back-channel logout to metadata in realm test-realm failed: Delivery blocked: target is a link-local or cloud-metadata address',
      );
    });

    it('skips the check when BACKCHANNEL_LOGOUT_ALLOW_LINK_LOCAL=true', async () => {
      process.env['BACKCHANNEL_LOGOUT_ALLOW_LINK_LOCAL'] = 'true';
      prisma.client.findMany.mockResolvedValue([client('app-1', true)]);

      await service.dispatch(realm, [session('s-1', ['app-1'])]);

      expect(assertNotLinkLocalTarget).not.toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('notifySessionsEnded', () => {
    it('returns at once and delivers in the background', async () => {
      prisma.client.findMany.mockResolvedValue([client('app-1', true)]);
      let release!: () => void;
      (global.fetch as jest.Mock).mockReturnValue(
        new Promise((resolve) => {
          release = () => resolve({ ok: true, status: 200 });
        }),
      );

      const result = service.notifySessionsEnded(realm, [
        session('s-1', ['app-1']),
      ]);

      expect(result).toBeUndefined();
      await flushPromises();
      expect(global.fetch).toHaveBeenCalledTimes(1);
      release();
      await flushPromises();
    });

    it('does nothing for sessions without refresh tokens (impersonation)', async () => {
      service.notifySessionsEnded(realm, [session('s-1', [])]);
      service.notifySessionsEnded(realm, []);
      await flushPromises();

      expect(prisma.client.findMany).not.toHaveBeenCalled();
    });

    it('swallows and logs a database failure: it can never reject', async () => {
      prisma.client.findMany.mockRejectedValue(new Error('db down'));

      expect(() =>
        service.notifySessionsEnded(realm, [session('s-1', ['app-1'])]),
      ).not.toThrow();
      await flushPromises();

      expect(warn).toHaveBeenCalledWith(
        'Back-channel logout for realm test-realm failed: db down',
      );
    });
  });
});
