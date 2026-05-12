// Mock JwkService module to avoid importing jose (ESM-only)
jest.mock('../crypto/jwk.service.js', () => ({
  JwkService: jest.fn(),
}));

import { BackchannelLogoutService } from './backchannel-logout.service.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';
import type { Realm } from '@prisma/client';

/** Drain the microtask / promise queue so fire-and-forget work completes. */
const flushPromises = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

describe('BackchannelLogoutService', () => {
  let service: BackchannelLogoutService;
  let prisma: MockPrismaService;
  let mockJwkService: { signJwt: jest.Mock };
  let originalFetch: typeof global.fetch;

  const mockRealm: Realm = {
    id: 'realm-1',
    name: 'test-realm',
  } as Realm;

  const mockSigningKey = {
    id: 'key-1',
    realmId: 'realm-1',
    kid: 'kid-1',
    privateKey: 'mock-private-key',
    active: true,
    createdAt: new Date(),
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    mockJwkService = { signJwt: jest.fn().mockResolvedValue('mock.jwt.token') };
    service = new BackchannelLogoutService(
      prisma as any,
      mockJwkService as any,
    );

    // Save original fetch and replace with mock
    originalFetch = global.fetch;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // ─── sendLogoutTokens ───────────────────────────────────────

  describe('sendLogoutTokens', () => {
    it('should return early when no clients have a backchannelLogoutUri', async () => {
      prisma.client.findMany.mockResolvedValue([]);

      service.sendLogoutTokens(mockRealm, 'user-1', 'session-1');
      await flushPromises();

      expect(prisma.client.findMany).toHaveBeenCalledWith({
        where: {
          realmId: 'realm-1',
          backchannelLogoutUri: { not: null },
        },
      });
      expect(prisma.realmSigningKey.findFirst).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should return early and log warning when no active signing key is found', async () => {
      prisma.client.findMany.mockResolvedValue([
        {
          id: 'client-1',
          clientId: 'my-app',
          backchannelLogoutUri: 'https://example.com/logout',
          backchannelLogoutSessionRequired: false,
        },
      ]);
      prisma.realmSigningKey.findFirst.mockResolvedValue(null);

      service.sendLogoutTokens(mockRealm, 'user-1', 'session-1');
      await flushPromises();

      expect(prisma.realmSigningKey.findFirst).toHaveBeenCalledWith({
        where: { realmId: 'realm-1', active: true },
        orderBy: { createdAt: 'desc' },
      });
      expect(mockJwkService.signJwt).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should send logout tokens to all clients with backchannelLogoutUri', async () => {
      const clients = [
        {
          id: 'client-1',
          clientId: 'app-1',
          backchannelLogoutUri: 'https://app1.example.com/logout',
          backchannelLogoutSessionRequired: false,
        },
        {
          id: 'client-2',
          clientId: 'app-2',
          backchannelLogoutUri: 'https://app2.example.com/logout',
          backchannelLogoutSessionRequired: false,
        },
      ];

      prisma.client.findMany.mockResolvedValue(clients);
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

      service.sendLogoutTokens(mockRealm, 'user-1', 'session-1');
      await flushPromises();

      expect(mockJwkService.signJwt).toHaveBeenCalledTimes(2);
      expect(global.fetch).toHaveBeenCalledTimes(2);

      // Verify first client call
      expect(global.fetch).toHaveBeenCalledWith(
        'https://app1.example.com/logout',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'logout_token=mock.jwt.token',
        }),
      );

      // Verify second client call
      expect(global.fetch).toHaveBeenCalledWith(
        'https://app2.example.com/logout',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'logout_token=mock.jwt.token',
        }),
      );
    });

    it('should include sid claim when backchannelLogoutSessionRequired is true', async () => {
      const clients = [
        {
          id: 'client-1',
          clientId: 'app-1',
          backchannelLogoutUri: 'https://app1.example.com/logout',
          backchannelLogoutSessionRequired: true,
        },
      ];

      prisma.client.findMany.mockResolvedValue(clients);
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

      service.sendLogoutTokens(mockRealm, 'user-1', 'session-1');
      await flushPromises();

      expect(mockJwkService.signJwt).toHaveBeenCalledWith(
        expect.objectContaining({
          iss: expect.stringContaining('/realms/test-realm'),
          sub: 'user-1',
          aud: 'app-1',
          sid: 'session-1',
          events: { 'http://schemas.openid.net/event/backchannel-logout': {} },
        }),
        'mock-private-key',
        'kid-1',
        120,
      );
    });

    it('should NOT include sid claim when backchannelLogoutSessionRequired is false', async () => {
      const clients = [
        {
          id: 'client-1',
          clientId: 'app-1',
          backchannelLogoutUri: 'https://app1.example.com/logout',
          backchannelLogoutSessionRequired: false,
        },
      ];

      prisma.client.findMany.mockResolvedValue(clients);
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

      service.sendLogoutTokens(mockRealm, 'user-1', 'session-1');
      await flushPromises();

      const signCall = mockJwkService.signJwt.mock.calls[0][0];
      expect(signCall).not.toHaveProperty('sid');
      expect(signCall).toEqual(
        expect.objectContaining({
          iss: expect.stringContaining('/realms/test-realm'),
          sub: 'user-1',
          aud: 'app-1',
          events: { 'http://schemas.openid.net/event/backchannel-logout': {} },
        }),
      );
    });

    it('should handle fetch failure gracefully without throwing', async () => {
      const clients = [
        {
          id: 'client-1',
          clientId: 'app-1',
          backchannelLogoutUri: 'https://app1.example.com/logout',
          backchannelLogoutSessionRequired: false,
        },
      ];

      prisma.client.findMany.mockResolvedValue(clients);
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      // sendLogoutTokens is fire-and-forget (void); errors must not propagate
      expect(() =>
        service.sendLogoutTokens(mockRealm, 'user-1', 'session-1'),
      ).not.toThrow();
      await flushPromises(); // confirm the background work also swallows the error
    });

    it('should handle non-ok response gracefully without throwing', async () => {
      const clients = [
        {
          id: 'client-1',
          clientId: 'app-1',
          backchannelLogoutUri: 'https://app1.example.com/logout',
          backchannelLogoutSessionRequired: false,
        },
      ];

      prisma.client.findMany.mockResolvedValue(clients);
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500 });

      // sendLogoutTokens is fire-and-forget (void); non-ok responses must not propagate
      expect(() =>
        service.sendLogoutTokens(mockRealm, 'user-1', 'session-1'),
      ).not.toThrow();
      await flushPromises(); // confirm the background work also swallows the warning
    });
  });
});
