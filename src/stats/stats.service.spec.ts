import { StatsService } from './stats.service.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';
import type { Realm } from '@prisma/client';

describe('StatsService', () => {
  let service: StatsService;
  let prisma: MockPrismaService;

  const mockRealm: Realm = {
    id: 'realm-1',
    name: 'test-realm',
  } as Realm;

  beforeEach(() => {
    prisma = createMockPrismaService();

    // groupBy is not in the default mock — add it
    prisma.loginEvent.groupBy = jest.fn();
    prisma.session.count = jest.fn();
    prisma.loginSession.count = jest.fn();

    service = new StatsService(prisma as any);
  });

  describe('getRealmStats', () => {
    it('should return aggregated stats from prisma queries', async () => {
      // groupBy is called 3 times (24h, 7d, 30d active users)
      prisma.loginEvent.groupBy
        .mockResolvedValueOnce([{ userId: 'u1' }, { userId: 'u2' }]) // 24h → 2
        .mockResolvedValueOnce([
          { userId: 'u1' },
          { userId: 'u2' },
          { userId: 'u3' },
        ]) // 7d → 3
        .mockResolvedValueOnce([
          { userId: 'u1' },
          { userId: 'u2' },
          { userId: 'u3' },
          { userId: 'u4' },
        ]); // 30d → 4

      // count is called for successCount, failureCount, oauthSessions, ssoSessions
      prisma.loginEvent.count
        .mockResolvedValueOnce(50) // successCount
        .mockResolvedValueOnce(5); // failureCount

      prisma.session.count.mockResolvedValue(10);
      prisma.loginSession.count.mockResolvedValue(3);

      const stats = await service.getRealmStats(mockRealm);

      expect(stats).toEqual({
        activeUsers24h: 2,
        activeUsers7d: 3,
        activeUsers30d: 4,
        loginSuccessCount: 50,
        loginFailureCount: 5,
        activeSessionCount: 13,
      });
    });

    it('should use correct realmId filter for all queries', async () => {
      prisma.loginEvent.groupBy.mockResolvedValue([]);
      prisma.loginEvent.count.mockResolvedValue(0);
      prisma.session.count.mockResolvedValue(0);
      prisma.loginSession.count.mockResolvedValue(0);

      await service.getRealmStats(mockRealm);

      // All groupBy calls should use realmId
      const groupByCalls = prisma.loginEvent.groupBy.mock.calls;
      for (const call of groupByCalls) {
        expect(call[0].where.realmId).toBe('realm-1');
      }

      // Count calls should use realmId
      const countCalls = prisma.loginEvent.count.mock.calls;
      for (const call of countCalls) {
        expect(call[0].where.realmId).toBe('realm-1');
      }
    });

    it('should return zeros when there is no activity', async () => {
      prisma.loginEvent.groupBy.mockResolvedValue([]);
      prisma.loginEvent.count.mockResolvedValue(0);
      prisma.session.count.mockResolvedValue(0);
      prisma.loginSession.count.mockResolvedValue(0);

      const stats = await service.getRealmStats(mockRealm);

      expect(stats).toEqual({
        activeUsers24h: 0,
        activeUsers7d: 0,
        activeUsers30d: 0,
        loginSuccessCount: 0,
        loginFailureCount: 0,
        activeSessionCount: 0,
      });
    });

    it('should combine oauth and sso session counts for activeSessionCount', async () => {
      prisma.loginEvent.groupBy.mockResolvedValue([]);
      prisma.loginEvent.count.mockResolvedValue(0);
      prisma.session.count.mockResolvedValue(7);
      prisma.loginSession.count.mockResolvedValue(4);

      const stats = await service.getRealmStats(mockRealm);

      expect(stats.activeSessionCount).toBe(11);
    });

    it('should filter active sessions using expiresAt > now', async () => {
      prisma.loginEvent.groupBy.mockResolvedValue([]);
      prisma.loginEvent.count.mockResolvedValue(0);
      prisma.session.count.mockResolvedValue(0);
      prisma.loginSession.count.mockResolvedValue(0);

      await service.getRealmStats(mockRealm);

      expect(prisma.session.count).toHaveBeenCalledWith({
        where: {
          user: { realmId: 'realm-1' },
          expiresAt: { gt: expect.any(Date) },
        },
      });

      expect(prisma.loginSession.count).toHaveBeenCalledWith({
        where: {
          realmId: 'realm-1',
          expiresAt: { gt: expect.any(Date) },
        },
      });
    });
  });
});
