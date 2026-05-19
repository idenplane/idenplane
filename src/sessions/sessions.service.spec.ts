import { SessionsService, SessionInfo } from './sessions.service.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';
import type { Realm } from '@prisma/client';

describe('SessionsService', () => {
  let service: SessionsService;
  let prisma: MockPrismaService;

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

    service = new SessionsService(prisma as any);
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
        user: { realmId: 'realm-1' },
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

    it('should delete login session for sso type', async () => {
      prisma.loginSession.findUnique.mockResolvedValue({ realmId: 'realm-1' });
      prisma.loginSession.delete.mockResolvedValue({});

      await service.revokeSession(realm, 'sso-session-1', 'sso');

      expect(prisma.loginSession.delete).toHaveBeenCalledWith({
        where: { id: 'sso-session-1' },
      });
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
    it('should revoke all user sessions in batch operations', async () => {
      prisma.session.findMany.mockResolvedValue([
        { id: 'session-1' },
        { id: 'session-2' },
      ]);
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });
      prisma.session.deleteMany.mockResolvedValue({ count: 2 });
      prisma.loginSession.deleteMany.mockResolvedValue({
        count: 1,
      });

      await service.revokeAllUserSessions(mockRealm, 'user-1');

      expect(prisma.session.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', user: { realmId: 'realm-1' } },
        select: { id: true },
      });

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { sessionId: { in: ['session-1', 'session-2'] } },
        data: { revoked: true },
      });

      expect(prisma.session.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.session.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['session-1', 'session-2'] } },
      });

      expect(prisma.loginSession.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', realmId: 'realm-1' },
      });
    });

    it('should handle case with no existing sessions', async () => {
      prisma.session.findMany.mockResolvedValue([]);
      prisma.loginSession.deleteMany.mockResolvedValue({
        count: 0,
      });

      await service.revokeAllUserSessions(mockRealm, 'user-1');

      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(prisma.session.deleteMany).not.toHaveBeenCalled();
      expect(prisma.loginSession.deleteMany).toHaveBeenCalled();
    });
  });
});
