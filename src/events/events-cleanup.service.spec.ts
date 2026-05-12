import { EventsCleanupService } from './events-cleanup.service.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';

describe('EventsCleanupService', () => {
  let service: EventsCleanupService;
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new EventsCleanupService(prisma as any);
  });

  describe('cleanupExpiredEvents', () => {
    it('should use loginEventRetentionDays for login cutoff and adminEventRetentionDays for admin cutoff', async () => {
      const realms = [
        {
          id: 'realm-1',
          eventsExpiration: 604800, // 7 days (legacy)
          loginEventRetentionDays: 10, // 10 days — takes priority
          adminEventRetentionDays: 30, // 30 days — takes priority
        },
      ];

      prisma.realm.findMany.mockResolvedValue(realms);
      prisma.loginEvent.deleteMany.mockResolvedValue({ count: 2 });
      prisma.adminEvent.deleteMany.mockResolvedValue({ count: 1 });

      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      await service.cleanupExpiredEvents();

      expect(prisma.realm.findMany).toHaveBeenCalledWith({
        where: { eventsEnabled: true },
        select: {
          id: true,
          eventsExpiration: true,
          loginEventRetentionDays: true,
          adminEventRetentionDays: true,
        },
      });

      const expectedLoginCutoff = new Date(now - 10 * 86_400 * 1000);
      const expectedAdminCutoff = new Date(now - 30 * 86_400 * 1000);

      expect(prisma.loginEvent.deleteMany).toHaveBeenCalledWith({
        where: { realmId: 'realm-1', createdAt: { lt: expectedLoginCutoff } },
      });
      expect(prisma.adminEvent.deleteMany).toHaveBeenCalledWith({
        where: { realmId: 'realm-1', createdAt: { lt: expectedAdminCutoff } },
      });

      jest.restoreAllMocks();
    });

    it('should fall back to eventsExpiration when retentionDays are 0', async () => {
      const realms = [
        {
          id: 'realm-2',
          eventsExpiration: 86400, // 1 day
          loginEventRetentionDays: 0, // 0 = use legacy expiration
          adminEventRetentionDays: 0,
        },
      ];

      prisma.realm.findMany.mockResolvedValue(realms);
      prisma.loginEvent.deleteMany.mockResolvedValue({ count: 0 });
      prisma.adminEvent.deleteMany.mockResolvedValue({ count: 0 });

      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      await service.cleanupExpiredEvents();

      const expectedCutoff = new Date(now - 86400 * 1000);

      expect(prisma.loginEvent.deleteMany).toHaveBeenCalledWith({
        where: { realmId: 'realm-2', createdAt: { lt: expectedCutoff } },
      });
      expect(prisma.adminEvent.deleteMany).toHaveBeenCalledWith({
        where: { realmId: 'realm-2', createdAt: { lt: expectedCutoff } },
      });

      jest.restoreAllMocks();
    });

    it('should process multiple realms', async () => {
      const realms = [
        {
          id: 'realm-1',
          eventsExpiration: 604800,
          loginEventRetentionDays: 7,
          adminEventRetentionDays: 90,
        },
        {
          id: 'realm-2',
          eventsExpiration: 86400,
          loginEventRetentionDays: 14,
          adminEventRetentionDays: 60,
        },
      ];

      prisma.realm.findMany.mockResolvedValue(realms);
      prisma.loginEvent.deleteMany.mockResolvedValue({ count: 5 });
      prisma.adminEvent.deleteMany.mockResolvedValue({ count: 3 });

      await service.cleanupExpiredEvents();

      expect(prisma.loginEvent.deleteMany).toHaveBeenCalledTimes(2);
      expect(prisma.adminEvent.deleteMany).toHaveBeenCalledTimes(2);
    });

    it('should handle no realms with events enabled', async () => {
      prisma.realm.findMany.mockResolvedValue([]);

      await service.cleanupExpiredEvents();

      expect(prisma.loginEvent.deleteMany).not.toHaveBeenCalled();
      expect(prisma.adminEvent.deleteMany).not.toHaveBeenCalled();
    });

    it('should handle zero deleted events silently', async () => {
      prisma.realm.findMany.mockResolvedValue([
        {
          id: 'realm-1',
          eventsExpiration: 86400,
          loginEventRetentionDays: 1,
          adminEventRetentionDays: 1,
        },
      ]);
      prisma.loginEvent.deleteMany.mockResolvedValue({ count: 0 });
      prisma.adminEvent.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.cleanupExpiredEvents()).resolves.toBeUndefined();
    });
  });
});
