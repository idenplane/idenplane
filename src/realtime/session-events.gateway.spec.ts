// Mock JwkService to avoid importing jose (ESM-only) in Jest's CJS transform.
jest.mock('../crypto/jwk.service.js', () => ({
  JwkService: jest.fn(),
}));

import { WebSocket } from 'ws';
import { SessionEventsGateway } from './session-events.gateway.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';

describe('SessionEventsGateway', () => {
  let service: SessionEventsGateway;
  let prisma: MockPrismaService;
  let jwkService: { verifyJwt: jest.Mock };
  let blacklist: { isBlacklisted: jest.Mock };

  const mockRealm = { id: 'realm-1', name: 'test-realm' };
  const mockSigningKey = {
    id: 'key-1',
    realmId: 'realm-1',
    publicKey: 'public-key-pem',
    active: true,
  };

  function authenticate(searchParams: Record<string, string>) {
    return (service as unknown as {
      authenticate: (
        p: URLSearchParams,
      ) => Promise<{ userId: string } | null>;
    }).authenticate(new URLSearchParams(searchParams));
  }

  function makeFakeSocket(readyState: number) {
    return { readyState, send: jest.fn() };
  }

  beforeEach(() => {
    prisma = createMockPrismaService();
    prisma.session.findUnique = jest.fn();
    jwkService = { verifyJwt: jest.fn() };
    blacklist = { isBlacklisted: jest.fn().mockResolvedValue(false) };

    service = new SessionEventsGateway(
      prisma as any,
      jwkService as any,
      blacklist as any,
    );
  });

  describe('authenticate', () => {
    it('returns null when token or realm query params are missing', async () => {
      expect(await authenticate({ realm: 'test-realm' })).toBeNull();
      expect(await authenticate({ token: 'abc' })).toBeNull();
    });

    it('returns null when the realm does not exist', async () => {
      prisma.realm.findUnique.mockResolvedValue(null);
      expect(
        await authenticate({ token: 'abc', realm: 'nonexistent' }),
      ).toBeNull();
    });

    it('returns null when the realm has no active signing key', async () => {
      prisma.realm.findUnique.mockResolvedValue(mockRealm);
      prisma.realmSigningKey.findFirst.mockResolvedValue(null);
      expect(
        await authenticate({ token: 'abc', realm: 'test-realm' }),
      ).toBeNull();
    });

    it('returns null when the token fails verification', async () => {
      prisma.realm.findUnique.mockResolvedValue(mockRealm);
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockRejectedValue(new Error('invalid signature'));
      expect(
        await authenticate({ token: 'bad', realm: 'test-realm' }),
      ).toBeNull();
    });

    it('returns null when the jti is blacklisted', async () => {
      prisma.realm.findUnique.mockResolvedValue(mockRealm);
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockResolvedValue({ sub: 'user-1', jti: 'jti-1' });
      blacklist.isBlacklisted.mockResolvedValue(true);
      expect(
        await authenticate({ token: 'abc', realm: 'test-realm' }),
      ).toBeNull();
    });

    it('returns null when the token has a sid but the session no longer exists', async () => {
      prisma.realm.findUnique.mockResolvedValue(mockRealm);
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockResolvedValue({ sub: 'user-1', sid: 'sess-1' });
      prisma.session.findUnique.mockResolvedValue(null);
      expect(
        await authenticate({ token: 'abc', realm: 'test-realm' }),
      ).toBeNull();
    });

    it('returns the userId for a valid token with a live session', async () => {
      prisma.realm.findUnique.mockResolvedValue(mockRealm);
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockResolvedValue({ sub: 'user-1', sid: 'sess-1' });
      prisma.session.findUnique.mockResolvedValue({ id: 'sess-1' });
      expect(
        await authenticate({ token: 'abc', realm: 'test-realm' }),
      ).toEqual({ userId: 'user-1' });
    });

    it('returns the userId for a valid token with no sid claim', async () => {
      prisma.realm.findUnique.mockResolvedValue(mockRealm);
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockResolvedValue({ sub: 'user-1' });
      expect(
        await authenticate({ token: 'abc', realm: 'test-realm' }),
      ).toEqual({ userId: 'user-1' });
    });
  });

  describe('emitSessionTerminated', () => {
    it('does nothing when the user has no open connections', () => {
      expect(() =>
        service.emitSessionTerminated('user-1', {
          sessionId: 'sess-1',
          reason: 'Critical risk detected',
          timestamp: new Date().toISOString(),
        }),
      ).not.toThrow();
    });

    it('sends the event to every OPEN socket for the user and skips closed ones', () => {
      const openSocket = makeFakeSocket(WebSocket.OPEN);
      const closedSocket = makeFakeSocket(WebSocket.CLOSED);
      (service as any).connections.set(
        'user-1',
        new Set([openSocket, closedSocket]),
      );

      service.emitSessionTerminated('user-1', {
        sessionId: 'sess-1',
        reason: 'Critical risk detected',
        timestamp: '2026-08-02T00:00:00.000Z',
      });

      expect(openSocket.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'session.terminated',
          sessionId: 'sess-1',
          reason: 'Critical risk detected',
          timestamp: '2026-08-02T00:00:00.000Z',
        }),
      );
      expect(closedSocket.send).not.toHaveBeenCalled();
    });

    it('does not deliver to a different user', () => {
      const socket = makeFakeSocket(WebSocket.OPEN);
      (service as any).connections.set('user-1', new Set([socket]));

      service.emitSessionTerminated('user-2', {
        sessionId: 'sess-1',
        reason: 'Critical risk detected',
        timestamp: new Date().toISOString(),
      });

      expect(socket.send).not.toHaveBeenCalled();
    });
  });
});
