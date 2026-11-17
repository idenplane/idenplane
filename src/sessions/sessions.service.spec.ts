import { SessionsService } from './sessions.service.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';
import type { Realm } from '@prisma/client';

describe('SessionsService', () => {
  let service: SessionsService;
  let prisma: MockPrismaService;
  let backchannel: { endedSessions: jest.Mock; notifySessionsEnded: jest.Mock };

  const mockRealm: Realm = {
    id: 'realm-1',
    name: 'test-realm',
  } as Realm;

  beforeEach(() => {
    prisma = createMockPrismaService();

    // Add methods missing from the default mock
    prisma.loginSession.findMany = jest.fn();
    prisma.loginSession.deleteMany = jest.fn();
    prisma.session.findUnique = jest.fn();

    backchannel = {
      endedSessions: jest.fn().mockResolvedValue([]),
      notifySessionsEnded: jest.fn(),
    };
    service = new SessionsService(prisma as any, backchannel as any);
  });

  // ─── getRealmSessions ───────────────────────────────────────

  describe('getRealmSessions', () => {
    it('should merge oauth and sso sessions, sorted by createdAt desc', async () => {
      const oauthSession = {
        id: 'oauth-1',
        userId: 'user-1',
        user: { username: 'alice' },
        ipAddress: '10.0.0.1',
        userAgent: 'Mozilla/5.0',
        createdAt: new Date('2025-06-01T10:00:00Z'),
        expiresAt: new Date('2025-06-01T11:00:00Z'),
      };

      const ssoSession = {
        id: 'sso-1',
        userId: 'user-2',
        user: { username: 'bob' },
        ipAddress: '10.0.0.2',
        userAgent: 'Chrome/120',
        createdAt: new Date('2025-06-01T12:00:00Z'),
        expiresAt: new Date('2025-06-01T13:00:00Z'),
      };

      prisma.session.findMany.mockResolvedValue([oauthSession]);
      prisma.loginSession.findMany.mockResolvedValue([ssoSession]);

      const result = await service.getRealmSessions(mockRealm);

      expect(result).toHaveLength(2);
      // SSO session is newer, so it should be first
      expect(result[0]).toEqual(
        expect.objectContaining({ id: 'sso-1', type: 'sso', username: 'bob' }),
      );
      expect(result[1]).toEqual(
        expect.objectContaining({
          id: 'oauth-1',
          type: 'oauth',
          username: 'alice',
        }),
      );

      expect(prisma.session.findMany).toHaveBeenCalledWith({
        where: {
          user: { realmId: 'realm-1' },
          expiresAt: { gt: expect.any(Date) },
        },
        include: { user: { select: { username: true } } },
        orderBy: { createdAt: 'desc' },
      });

      expect(prisma.loginSession.findMany).toHaveBeenCalledWith({
        where: {
          realmId: 'realm-1',
          expiresAt: { gt: expect.any(Date) },
        },
        include: { user: { select: { username: true } } },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return empty array when no sessions exist', async () => {
      prisma.session.findMany.mockResolvedValue([]);
      prisma.loginSession.findMany.mockResolvedValue([]);

      const result = await service.getRealmSessions(mockRealm);

      expect(result).toEqual([]);
    });
  });

  // ─── getUserSessions ────────────────────────────────────────

  describe('getUserSessions', () => {
    it('should return sessions filtered by userId, sorted by createdAt desc', async () => {
      const oauthSession = {
        id: 'oauth-1',
        userId: 'user-1',
        user: { username: 'alice' },
        ipAddress: '10.0.0.1',
        userAgent: 'Mozilla/5.0',
        createdAt: new Date('2025-06-01T10:00:00Z'),
        expiresAt: new Date('2025-06-01T11:00:00Z'),
      };

      const ssoSession = {
        id: 'sso-1',
        userId: 'user-1',
        user: { username: 'alice' },
        ipAddress: '10.0.0.1',
        userAgent: 'Chrome/120',
        createdAt: new Date('2025-06-01T12:00:00Z'),
        expiresAt: new Date('2025-06-01T13:00:00Z'),
      };

      prisma.session.findMany.mockResolvedValue([oauthSession]);
      prisma.loginSession.findMany.mockResolvedValue([ssoSession]);

      const result = await service.getUserSessions(mockRealm, 'user-1');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('sso-1');
      expect(result[1].id).toBe('oauth-1');

      expect(prisma.session.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          user: { realmId: 'realm-1' },
          expiresAt: { gt: expect.any(Date) },
        },
        include: { user: { select: { username: true } } },
        orderBy: { createdAt: 'desc' },
      });

      expect(prisma.loginSession.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          realmId: 'realm-1',
          expiresAt: { gt: expect.any(Date) },
        },
        include: { user: { select: { username: true } } },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return empty array when user has no sessions', async () => {
      prisma.session.findMany.mockResolvedValue([]);
      prisma.loginSession.findMany.mockResolvedValue([]);

      const result = await service.getUserSessions(mockRealm, 'user-1');

      expect(result).toEqual([]);
    });
  });

  // ─── revokeSession ──────────────────────────────────────────

  describe('revokeSession', () => {
    const realm = { id: 'realm-1' } as Realm;

    it('should revoke refresh tokens then delete session for oauth type', async () => {
      prisma.session.findUnique.mockResolvedValue({
        userId: 'user-1',
        user: { realmId: 'realm-1', realm: { name: 'test-realm' } },
      });
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });
      prisma.session.delete.mockResolvedValue({});

      await service.revokeSession(realm, 'session-1', 'oauth');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { sessionId: 'session-1' },
        data: { revoked: true },
      });
      expect(prisma.session.delete).toHaveBeenCalledWith({
        where: { id: 'session-1' },
      });
    });

    it("tells the session's clients, read before it is deleted, once it is gone", async () => {
      prisma.session.findUnique.mockResolvedValue({
        userId: 'user-1',
        user: { realmId: 'realm-1', realm: { name: 'test-realm' } },
      });
      const ended = [
        { id: 'session-1', userId: 'user-1', clientIds: ['app-1'] },
      ];
      backchannel.endedSessions.mockResolvedValue(ended);
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.session.delete.mockResolvedValue({});

      // The admin API passes the realm; continuous verification passes null.
      await service.revokeSession(null, 'session-1', 'oauth');

      expect(backchannel.endedSessions).toHaveBeenCalledWith(['session-1']);
      expect(
        backchannel.endedSessions.mock.invocationCallOrder[0],
      ).toBeLessThan(prisma.session.delete.mock.invocationCallOrder[0]);
      expect(backchannel.notifySessionsEnded).toHaveBeenCalledWith(
        { id: 'realm-1', name: 'test-realm' },
        ended,
      );
      expect(
        backchannel.notifySessionsEnded.mock.invocationCallOrder[0],
      ).toBeGreaterThan(prisma.session.delete.mock.invocationCallOrder[0]);
    });

    it('sends nothing when the delete fails', async () => {
      prisma.session.findUnique.mockResolvedValue({
        userId: 'user-1',
        user: { realmId: 'realm-1', realm: { name: 'test-realm' } },
      });
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.session.delete.mockRejectedValue(new Error('db down'));

      await expect(
        service.revokeSession(realm, 'session-1', 'oauth'),
      ).rejects.toThrow('db down');
      expect(backchannel.notifySessionsEnded).not.toHaveBeenCalled();
    });

    it('should delete login session for sso type', async () => {
      prisma.loginSession.findUnique.mockResolvedValue({ realmId: 'realm-1' });
      prisma.loginSession.delete.mockResolvedValue({});

      await service.revokeSession(realm, 'sso-session-1', 'sso');

      expect(prisma.loginSession.delete).toHaveBeenCalledWith({
        where: { id: 'sso-session-1' },
      });
      // A browser SSO session is not tied to any client's session.
      expect(backchannel.notifySessionsEnded).not.toHaveBeenCalled();
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(prisma.session.delete).not.toHaveBeenCalled();
    });

    it('should reject revoking a session that belongs to a different realm', async () => {
      prisma.session.findUnique.mockResolvedValue({
        userId: 'user-2',
        user: { realmId: 'other-realm' },
      });

      await expect(
        service.revokeSession(realm, 'session-x', 'oauth'),
      ).rejects.toThrow('Session not found');
      expect(prisma.session.delete).not.toHaveBeenCalled();
    });

    it('should throw when the session does not exist', async () => {
      prisma.session.findUnique.mockResolvedValue(null);

      await expect(
        service.revokeSession(realm, 'missing', 'oauth'),
      ).rejects.toThrow('Session not found');
      expect(prisma.session.delete).not.toHaveBeenCalled();
    });
  });

  // ─── revokeAllUserSessions ──────────────────────────────────

  describe('revokeAllUserSessions', () => {
    beforeEach(() => {
      prisma.$transaction.mockResolvedValue([{ count: 0 }, []]);
      prisma.refreshToken.updateMany.mockReturnValue('revoke-tokens');
      prisma.$queryRaw.mockReturnValue('delete-sessions');
      prisma.loginSession.deleteMany.mockReturnValue('delete-sso');
      prisma.proxySession.deleteMany = jest
        .fn()
        .mockReturnValue('delete-proxy');
      prisma.adminRevokedToken.upsert.mockReturnValue('revoke-admin-tokens');
    });

    it('ends every session of the user in one transaction, selecting by user', async () => {
      await service.revokeAllUserSessions(mockRealm, 'user-1');

      const ofUser = { userId: 'user-1', user: { realmId: 'realm-1' } };
      // No list is read first: a session created meanwhile is not missed.
      expect(prisma.session.findMany).not.toHaveBeenCalled();
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { session: ofUser },
        data: { revoked: true },
      });
      // One DELETE ... RETURNING, scoped to the user and the realm.
      const [sql, ...params] = prisma.$queryRaw.mock.calls[0];
      const text = (sql as string[]).join('?');
      expect(text).toContain('DELETE FROM "sessions"');
      expect(text).toContain('u."realm_id" = ?');
      expect(text).toContain('s."user_id" = ?');
      expect(text).toContain('RETURNING');
      expect(params).toEqual(['realm-1', 'user-1']);
      expect(prisma.loginSession.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', realmId: 'realm-1' },
      });
      expect(prisma.proxySession.deleteMany).toHaveBeenCalledWith({
        where: ofUser,
      });
      expect(prisma.$transaction).toHaveBeenCalledWith([
        'revoke-tokens',
        'delete-sessions',
        'delete-sso',
        'delete-proxy',
      ]);
      // Not a master realm user: no admin console tokens to end.
      expect(prisma.adminRevokedToken.upsert).not.toHaveBeenCalled();
    });

    it('keeps the SSO session it is told to keep', async () => {
      await service.revokeAllUserSessions(mockRealm, 'user-1', {
        keepLoginSessionTokenHash: 'current-hash',
      });

      expect(prisma.loginSession.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          realmId: 'realm-1',
          tokenHash: { not: 'current-hash' },
        },
      });
      // OAuth sessions (offline ones included) all end.
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('announces exactly the sessions the transaction deleted, after it committed', async () => {
      const ended = [
        { id: 's-1', userId: 'user-1', clientIds: ['app-1'] },
        { id: 's-offline', userId: 'user-1', clientIds: ['app-2'] },
      ];
      prisma.$transaction.mockResolvedValue([{ count: 2 }, ended, {}, {}]);

      await service.revokeAllUserSessions(mockRealm, 'user-1');

      expect(backchannel.notifySessionsEnded).toHaveBeenCalledWith(
        mockRealm,
        ended,
      );
      expect(
        backchannel.notifySessionsEnded.mock.invocationCallOrder[0],
      ).toBeGreaterThan(prisma.$transaction.mock.invocationCallOrder[0]);
    });

    it('announces nothing when the transaction fails', async () => {
      prisma.$transaction.mockRejectedValue(new Error('serialization'));

      await expect(
        service.revokeAllUserSessions(mockRealm, 'user-1'),
      ).rejects.toThrow('serialization');
      expect(backchannel.notifySessionsEnded).not.toHaveBeenCalled();
    });

    it("ends a master realm user's admin console tokens too", async () => {
      await service.revokeAllUserSessions(
        { id: 'master-id', name: 'master' },
        'admin-1',
      );

      expect(prisma.adminRevokedToken.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { jti: 'user:admin-1' },
          create: expect.objectContaining({ jti: 'user:admin-1' }),
        }),
      );
      expect(prisma.$transaction).toHaveBeenCalledWith(
        expect.arrayContaining(['revoke-admin-tokens']),
      );
    });
  });
});
