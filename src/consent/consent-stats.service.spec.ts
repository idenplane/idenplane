import { NotFoundException } from '@nestjs/common';
import type { Realm } from '@prisma/client';
import { ConsentStatisticsService } from './consent-stats.service.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';

describe('ConsentStatisticsService', () => {
  let service: ConsentStatisticsService;
  let prisma: MockPrismaService;

  const realm = { id: 'realm-1', name: 'test' } as Realm;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new ConsentStatisticsService(prisma as any);
  });

  describe('getRealmConsentStats', () => {
    it('aggregates totals, action windows, per-type 24h and category breakdown', async () => {
      // count() is used for: totalConsents, 3 action windows, 3 per-type 24h,
      // 2 pending-deletion counts, and per-category totalGrants.
      prisma.userConsent.count.mockResolvedValue(42);

      // distinct-user windows use groupBy().length
      prisma.userConsentHistory.groupBy
        .mockResolvedValueOnce([{ userId: 'u1' }, { userId: 'u2' }]) // active 24h
        .mockResolvedValueOnce([{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }]) // active 7d
        .mockResolvedValueOnce([
          { userId: 'u1' },
          { userId: 'u2' },
          { userId: 'u3' },
          { userId: 'u4' },
        ]) // active 30d
        .mockResolvedValue([{ userId: 'u1' }]); // per-category distinctUsers

      prisma.userConsentHistory.count
        .mockResolvedValueOnce(10) // actions 24h
        .mockResolvedValueOnce(25) // actions 7d
        .mockResolvedValueOnce(60) // actions 30d
        .mockResolvedValueOnce(7) // granted 24h
        .mockResolvedValueOnce(2) // revoked 24h
        .mockResolvedValueOnce(1) // updated 24h
        .mockResolvedValue(5); // per-category totalGrants

      prisma.consentCategory.findMany.mockResolvedValue([
        { id: 'c1', key: 'marketing', displayName: 'Marketing', required: false },
      ]);

      prisma.pendingDeletion.count
        .mockResolvedValueOnce(3) // pendingDeletions
        .mockResolvedValueOnce(1); // within grace period

      const stats = await service.getRealmConsentStats(realm);

      expect(stats.totalConsents).toBe(42);
      expect(stats.activeUsersWithConsents24h).toBe(2);
      expect(stats.activeUsersWithConsents7d).toBe(3);
      expect(stats.activeUsersWithConsents30d).toBe(4);
      expect(stats.consentActionsLast24h).toBe(10);
      expect(stats.consentActionsLast7d).toBe(25);
      expect(stats.consentActionsLast30d).toBe(60);
      expect(stats.consentsGranted24h).toBe(7);
      expect(stats.consentsRevoked24h).toBe(2);
      expect(stats.consentsUpdated24h).toBe(1);
      expect(stats.pendingDeletions).toBe(3);
      expect(stats.pendingDeletionsGracePeriod).toBe(1);
      expect(stats.consentsByCategory).toEqual([
        {
          categoryId: 'c1',
          categoryKey: 'marketing',
          categoryName: 'Marketing',
          required: false,
          totalGrants: 5,
          distinctUsers: 1,
        },
      ]);
    });

    it('returns an empty category breakdown when no categories exist', async () => {
      prisma.userConsent.count.mockResolvedValue(0);
      prisma.userConsentHistory.groupBy.mockResolvedValue([]);
      prisma.userConsentHistory.count.mockResolvedValue(0);
      prisma.consentCategory.findMany.mockResolvedValue([]);
      prisma.pendingDeletion.count.mockResolvedValue(0);

      const stats = await service.getRealmConsentStats(realm);
      expect(stats.consentsByCategory).toEqual([]);
    });
  });

  describe('getCategoryStats', () => {
    it('throws NotFound for a category in another realm', async () => {
      prisma.consentCategory.findUnique.mockResolvedValue({
        id: 'c1',
        realmId: 'other-realm',
        key: 'marketing',
        displayName: 'Marketing',
      });
      await expect(service.getCategoryStats(realm, 'c1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns grant/revoke totals and grant + active-user windows', async () => {
      prisma.consentCategory.findUnique.mockResolvedValue({
        id: 'c1',
        realmId: 'realm-1',
        key: 'marketing',
        displayName: 'Marketing',
      });

      prisma.userConsentHistory.count
        .mockResolvedValueOnce(20) // totalGrants
        .mockResolvedValueOnce(4) // totalRevokes
        .mockResolvedValueOnce(3) // grants 24h
        .mockResolvedValueOnce(8) // grants 7d
        .mockResolvedValueOnce(15); // grants 30d

      prisma.userConsentHistory.groupBy
        .mockResolvedValueOnce([{ userId: 'u1' }, { userId: 'u2' }]) // active 24h
        .mockResolvedValueOnce([{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }]) // active 7d
        .mockResolvedValueOnce([
          { userId: 'u1' },
          { userId: 'u2' },
          { userId: 'u3' },
          { userId: 'u4' },
          { userId: 'u5' },
        ]); // active 30d

      const stats = await service.getCategoryStats(realm, 'c1');

      expect(stats).toEqual({
        categoryId: 'c1',
        categoryKey: 'marketing',
        categoryName: 'Marketing',
        totalGrants: 20,
        totalRevokes: 4,
        grants24h: 3,
        grants7d: 8,
        grants30d: 15,
        activeUsers24h: 2,
        activeUsers7d: 3,
        activeUsers30d: 5,
      });
    });
  });
});
