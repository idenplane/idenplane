import { lookupsBackedBy } from '../cache/cached-lookups.mock.js';
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
    return (
      service as unknown as {
        authenticate: (
          p: URLSearchParams,
        ) => Promise<{ userId: string } | null>;
      }
    ).authenticate(new URLSearchParams(searchParams));
  }

  function makeFakeSocket(readyState: number) {
    return { readyState, send: jest.fn() };
  }

  beforeEach(() => {
    prisma = createMockPrismaService();
    prisma.session.findUnique = jest.fn();
    jwkService = { verifyJwt: jest.fn() };
    blacklist = { isBlacklisted: jest.fn().mockResolvedValue(false) };

    // A bus with no database channel delivers to this process, as the
    // real one does then.
    const handlers = new Map<string, Array<(p: unknown) => void>>();
    const bus = {
      onMessage: (topic: string, h: (p: unknown) => void) =>
        handlers.set(topic, [...(handlers.get(topic) ?? []), h]),
      publish: async (topic: string, payload: unknown) =>
        (handlers.get(topic) ?? []).forEach((h) => h(payload)),
    };
    service = new SessionEventsGateway(
      lookupsBackedBy(prisma as any) as any,
      prisma as any,
      jwkService as any,
      blacklist as any,
      bus as any,
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
      expect(await authenticate({ token: 'abc', realm: 'test-realm' })).toEqual(
        { userId: 'user-1' },
      );
    });

    it('returns the userId for a valid token with no sid claim', async () => {
      prisma.realm.findUnique.mockResolvedValue(mockRealm);
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockResolvedValue({ sub: 'user-1' });
      expect(await authenticate({ token: 'abc', realm: 'test-realm' })).toEqual(
        { userId: 'user-1' },
      );
    });
  });

  describe('certificate-bound tokens (RFC 8705 §3)', () => {
    const X5T = 'n4bQgYhMfWWaL-qgxVrQFaO_TxsrC4Is0V1sFbDwCgg';
    const req = { headers: {}, socket: {} } as any;

    function gatewayWith(fromRequest: jest.Mock | undefined) {
      return new SessionEventsGateway(
        lookupsBackedBy(prisma as any) as any,
        prisma as any,
        jwkService as any,
        blacklist as any,
        { onMessage: () => undefined, publish: async () => undefined } as any,
        fromRequest ? ({ fromRequest } as any) : undefined,
      );
    }

    const auth = (gateway: SessionEventsGateway) =>
      (
        gateway as unknown as {
          authenticate: (
            p: URLSearchParams,
            r?: unknown,
          ) => Promise<{ userId: string } | null>;
        }
      ).authenticate(
        new URLSearchParams({ token: 'abc', realm: 'test-realm' }),
        req,
      );

    beforeEach(() => {
      prisma.realm.findUnique.mockResolvedValue(mockRealm);
      prisma.realmSigningKey.findFirst.mockResolvedValue(mockSigningKey);
      jwkService.verifyJwt.mockResolvedValue({
        sub: 'user-1',
        cnf: { 'x5t#S256': X5T },
      });
    });

    it('accepts a bound token whose certificate the request presents', async () => {
      const fromRequest = jest.fn().mockReturnValue({ x5tS256: X5T });
      expect(await auth(gatewayWith(fromRequest))).toEqual({
        userId: 'user-1',
      });
      expect(fromRequest).toHaveBeenCalledWith(req);
    });

    it.each([
      ['no certificate', () => null],
      ['another certificate', () => ({ x5tS256: `x${X5T.slice(1)}` })],
      [
        'a malformed proxy header',
        () => {
          throw new Error('Invalid client certificate header');
        },
      ],
    ])('refuses a bound token with %s', async (_label, impl) => {
      expect(await auth(gatewayWith(jest.fn(impl)))).toBeNull();
    });

    it('refuses a bound token when no certificate source is wired', async () => {
      expect(await auth(gatewayWith(undefined))).toBeNull();
    });

    it('does not read the certificate for an unbound token', async () => {
      jwkService.verifyJwt.mockResolvedValue({ sub: 'user-1' });
      const fromRequest = jest.fn();
      expect(await auth(gatewayWith(fromRequest))).toEqual({
        userId: 'user-1',
      });
      expect(fromRequest).not.toHaveBeenCalled();
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

  describe('emitStepUpRequired', () => {
    it('does nothing when the user has no open connections', () => {
      expect(() =>
        service.emitStepUpRequired('user-1', {
          sessionId: 'sess-1',
          requiredAcr: 'urn:idenplane:acr:mfa',
          reason: 'Risk threshold exceeded',
          timestamp: new Date().toISOString(),
        }),
      ).not.toThrow();
    });

    it('sends a session.stepup_required event to every OPEN socket for the user', () => {
      const openSocket = makeFakeSocket(WebSocket.OPEN);
      const closedSocket = makeFakeSocket(WebSocket.CLOSED);
      (service as any).connections.set(
        'user-1',
        new Set([openSocket, closedSocket]),
      );

      service.emitStepUpRequired('user-1', {
        sessionId: 'sess-1',
        requiredAcr: 'urn:idenplane:acr:mfa',
        reason: 'Risk threshold exceeded',
        timestamp: '2026-08-02T00:00:00.000Z',
      });

      expect(openSocket.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'session.stepup_required',
          sessionId: 'sess-1',
          requiredAcr: 'urn:idenplane:acr:mfa',
          reason: 'Risk threshold exceeded',
          timestamp: '2026-08-02T00:00:00.000Z',
        }),
      );
      expect(closedSocket.send).not.toHaveBeenCalled();
    });

    it('does not deliver to a different user', () => {
      const socket = makeFakeSocket(WebSocket.OPEN);
      (service as any).connections.set('user-1', new Set([socket]));

      service.emitStepUpRequired('user-2', {
        sessionId: 'sess-1',
        requiredAcr: 'urn:idenplane:acr:mfa',
        reason: 'Risk threshold exceeded',
        timestamp: new Date().toISOString(),
      });

      expect(socket.send).not.toHaveBeenCalled();
    });
  });
});
