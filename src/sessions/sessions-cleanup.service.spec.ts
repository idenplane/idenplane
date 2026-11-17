import { SessionsCleanupService } from './sessions-cleanup.service.js';
import { sessionExpiresAt } from './session-lifetime.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';

describe('SessionsCleanupService', () => {
  let service: SessionsCleanupService;
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createMockPrismaService();

    // Add deleteMany overloads that are missing from the shared mock
    prisma.refreshToken.deleteMany = jest.fn();
    prisma.authorizationCode.deleteMany = jest.fn();
    prisma.impersonationSession.deleteMany = jest.fn();

    service = new SessionsCleanupService(prisma as any);
  });

  describe('cleanupExpiredSessions', () => {
    it("deletes SSO sessions gone idle, by each realm's own timeout", async () => {
      prisma.session.deleteMany.mockResolvedValue({ count: 0 });
      prisma.loginSession.deleteMany.mockResolvedValue({ count: 0 });
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });
      prisma.authorizationCode.deleteMany.mockResolvedValue({ count: 0 });
      prisma.impersonationSession.deleteMany.mockResolvedValue({ count: 0 });
      prisma.proxySession.deleteMany.mockResolvedValue({ count: 0 });
      prisma.$executeRaw.mockResolvedValue(4);

      await service.cleanupExpiredSessions();

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      const sql = (prisma.$executeRaw.mock.calls[0][0] as string[]).join('?');
      expect(sql).toContain('DELETE FROM "login_sessions"');
      expect(sql).toContain('"sso_session_idle_timeout" > 0');
      expect(sql).toContain('"last_activity_at"');
    });

    it('should delete expired records across all session-related tables', async () => {
      prisma.session.deleteMany.mockResolvedValue({ count: 3 });
      prisma.loginSession.deleteMany.mockResolvedValue({
        count: 2,
      });
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 5 });
      prisma.authorizationCode.deleteMany.mockResolvedValue({
        count: 1,
      });
      prisma.impersonationSession.deleteMany.mockResolvedValue({
        count: 0,
      });
      prisma.proxySession.deleteMany.mockResolvedValue({ count: 0 });

      const before = new Date();
      await service.cleanupExpiredSessions();
      const after = new Date();

      // Each deleteMany should have been called with expiresAt < now
      expect(prisma.session.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) } },
      });
      const oauthCall = prisma.session.deleteMany.mock.calls[0][0];
      expect(oauthCall.where.expiresAt.lt.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
      expect(oauthCall.where.expiresAt.lt.getTime()).toBeLessThanOrEqual(
        after.getTime(),
      );

      expect(prisma.loginSession.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) } },
      });

      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) } },
      });

      expect(prisma.authorizationCode.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) } },
      });

      expect(prisma.impersonationSession.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) } },
      });

      // Proxy (forward-auth) sessions are swept here too. Nothing else prunes
      // them: the proxy only re-checks a session when its cookie expires, so a
      // missing sweep grows proxy_sessions for the life of the deployment.
      expect(prisma.proxySession.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) } },
      });
    });

    it('should not throw when all tables return zero deleted rows', async () => {
      prisma.session.deleteMany.mockResolvedValue({ count: 0 });
      prisma.loginSession.deleteMany.mockResolvedValue({
        count: 0,
      });
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });
      prisma.authorizationCode.deleteMany.mockResolvedValue({
        count: 0,
      });
      prisma.impersonationSession.deleteMany.mockResolvedValue({
        count: 0,
      });
      prisma.proxySession.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.cleanupExpiredSessions()).resolves.toBeUndefined();
    });

    it('should use a consistent timestamp across all delete calls', async () => {
      const fixedNow = new Date('2026-03-24T12:00:00.000Z').getTime();
      jest.spyOn(Date, 'now').mockReturnValue(fixedNow);

      prisma.session.deleteMany.mockResolvedValue({ count: 1 });
      prisma.loginSession.deleteMany.mockResolvedValue({
        count: 1,
      });
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 1 });
      prisma.authorizationCode.deleteMany.mockResolvedValue({
        count: 1,
      });
      prisma.impersonationSession.deleteMany.mockResolvedValue({
        count: 1,
      });
      prisma.proxySession.deleteMany.mockResolvedValue({ count: 1 });

      await service.cleanupExpiredSessions();

      const timestamps = [
        prisma.session.deleteMany.mock.calls[0][0].where.expiresAt.lt,
        prisma.loginSession.deleteMany.mock.calls[0][0].where.expiresAt.lt,
        prisma.refreshToken.deleteMany.mock.calls[0][0].where.expiresAt.lt,
        prisma.authorizationCode.deleteMany.mock.calls[0][0].where.expiresAt.lt,
        prisma.impersonationSession.deleteMany.mock.calls[0][0].where.expiresAt
          .lt,
        prisma.proxySession.deleteMany.mock.calls[0][0].where.expiresAt.lt,
      ];

      // All six calls must use the exact same Date instance / value
      const referenceTime = timestamps[0].getTime();
      for (const ts of timestamps) {
        expect(ts.getTime()).toBe(referenceTime);
      }

      jest.restoreAllMocks();
    });
    it('keeps an offline session past the normal lifespan, until its own expiry', async () => {
      // A table of sessions the fake deleteMany filters as the database would.
      const realm = { refreshTokenLifespan: 1800, offlineTokenLifespan: 86400 };
      const signIn = new Date('2026-11-16T10:00:00.000Z');
      let sessions = [
        { id: 'normal', expiresAt: sessionExpiresAt(realm, false, signIn) },
        { id: 'offline', expiresAt: sessionExpiresAt(realm, true, signIn) },
      ];
      prisma.session.deleteMany.mockImplementation(
        ({ where }: { where: { expiresAt: { lt: Date } } }) => {
          const before = sessions.length;
          sessions = sessions.filter(
            (s) => !(s.expiresAt < where.expiresAt.lt),
          );
          return Promise.resolve({ count: before - sessions.length });
        },
      );
      for (const table of [
        prisma.loginSession,
        prisma.refreshToken,
        prisma.authorizationCode,
        prisma.impersonationSession,
        prisma.proxySession,
      ]) {
        table.deleteMany.mockResolvedValue({ count: 0 });
      }
      const runAt = async (hoursAfterSignIn: number) => {
        jest
          .useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
          .setSystemTime(signIn.getTime() + hoursAfterSignIn * 3600 * 1000);
        try {
          await service.cleanupExpiredSessions();
        } finally {
          jest.useRealTimers();
        }
        return sessions.map((s) => s.id);
      };

      // The hourly run after the normal lifespan: only the normal one goes.
      expect(await runAt(1)).toEqual(['offline']);
      // Still there late on the first day.
      expect(await runAt(23)).toEqual(['offline']);
      // Gone at the first run after the offline lifespan.
      expect(await runAt(25)).toEqual([]);
    });
  });
});
