import { SessionsCleanupService } from './sessions-cleanup.service.js';
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

      await service.cleanupExpiredSessions();

      const timestamps = [
        prisma.session.deleteMany.mock.calls[0][0].where.expiresAt.lt,
        prisma.loginSession.deleteMany.mock.calls[0][0].where.expiresAt.lt,
        prisma.refreshToken.deleteMany.mock.calls[0][0].where.expiresAt.lt,
        prisma.authorizationCode.deleteMany.mock.calls[0][0].where.expiresAt.lt,
        prisma.impersonationSession.deleteMany.mock.calls[0][0].where.expiresAt
          .lt,
      ];

      // All five calls must use the exact same Date instance / value
      const referenceTime = timestamps[0].getTime();
      for (const ts of timestamps) {
        expect(ts.getTime()).toBe(referenceTime);
      }

      jest.restoreAllMocks();
    });
  });
});
