import { BruteForceService } from './brute-force.service.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';
import type { Realm, User } from '@prisma/client';

describe('BruteForceService', () => {
  let service: BruteForceService;
  let prisma: MockPrismaService;

  const mockRealm: Realm = {
    id: 'realm-1',
    name: 'test-realm',
    bruteForceEnabled: true,
    maxLoginFailures: 3,
    lockoutDuration: 300,
    failureResetTime: 600,
    permanentLockoutAfter: 0,
  } as Realm;

  const disabledRealm: Realm = {
    ...mockRealm,
    bruteForceEnabled: false,
  };

  const mockUser: User = {
    id: 'user-1',
    realmId: 'realm-1',
    username: 'alice',
    lockedUntil: null,
  } as User;

  beforeEach(() => {
    prisma = createMockPrismaService();

    // Make $transaction call its callback with prisma as the transaction object
    (prisma.$transaction as jest.Mock).mockImplementation(
      async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
    );

    // Add missing Prisma model mocks used by BruteForceService
    (prisma as any).totpFailureTracking = {
      create: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    (prisma as any).webAuthnFailureTracking = {
      create: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    };

    service = new BruteForceService(prisma as any);
  });

  // ─── checkLocked ────────────────────────────────────────────

  describe('checkLocked', () => {
    it('should return false when brute force is disabled', () => {
      const result = service.checkLocked(disabledRealm, mockUser);

      expect(result).toEqual({ locked: false });
    });

    it('should return false when user has no lockedUntil', () => {
      const result = service.checkLocked(mockRealm, mockUser);

      expect(result).toEqual({ locked: false });
    });

    it('should return true with lockedUntil when lock is in the future', () => {
      const futureDate = new Date(Date.now() + 60_000);
      const lockedUser = { ...mockUser, lockedUntil: futureDate } as User;

      const result = service.checkLocked(mockRealm, lockedUser);

      expect(result).toEqual({ locked: true, lockedUntil: futureDate });
    });

    it('should return false when lockedUntil is in the past', () => {
      const pastDate = new Date(Date.now() - 60_000);
      const expiredUser = { ...mockUser, lockedUntil: pastDate } as User;

      const result = service.checkLocked(mockRealm, expiredUser);

      expect(result).toEqual({ locked: false });
    });
  });

  // ─── recordFailure ──────────────────────────────────────────

  describe('recordFailure', () => {
    it('should do nothing when brute force is disabled', async () => {
      await service.recordFailure(disabledRealm, 'user-1', '10.0.0.1');

      expect(prisma.loginFailure.create).not.toHaveBeenCalled();
    });

    it('should create a failure record', async () => {
      prisma.loginFailure.create.mockResolvedValue({});
      prisma.loginFailure.count.mockResolvedValue(1);

      await service.recordFailure(mockRealm, 'user-1', '10.0.0.1');

      expect(prisma.loginFailure.create).toHaveBeenCalledWith({
        data: {
          realmId: 'realm-1',
          userId: 'user-1',
          ipAddress: '10.0.0.1',
        },
      });
    });

    it('should pass null for ipAddress when not provided', async () => {
      prisma.loginFailure.create.mockResolvedValue({});
      prisma.loginFailure.count.mockResolvedValue(1);

      await service.recordFailure(mockRealm, 'user-1');

      expect(prisma.loginFailure.create).toHaveBeenCalledWith({
        data: {
          realmId: 'realm-1',
          userId: 'user-1',
          ipAddress: null,
        },
      });
    });

    it('should lock user when failure count reaches maxLoginFailures', async () => {
      prisma.loginFailure.create.mockResolvedValue({});
      prisma.loginFailure.count.mockResolvedValue(3); // equals maxLoginFailures
      prisma.user.update.mockResolvedValue({});

      await service.recordFailure(mockRealm, 'user-1', '10.0.0.1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { lockedUntil: expect.any(Date) },
      });

      // Verify the lockout duration is approximately lockoutDuration seconds from now
      const updateCall = prisma.user.update.mock.calls[0][0];
      const lockedUntil = updateCall.data.lockedUntil as Date;
      const expectedTime = Date.now() + 300 * 1000;
      expect(Math.abs(lockedUntil.getTime() - expectedTime)).toBeLessThan(1000);
    });

    it('should not lock user when failure count is below threshold', async () => {
      prisma.loginFailure.create.mockResolvedValue({});
      prisma.loginFailure.count.mockResolvedValue(2); // below maxLoginFailures of 3

      await service.recordFailure(mockRealm, 'user-1', '10.0.0.1');

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('should permanently lock user when permanentLockoutAfter > 0 and threshold is reached', async () => {
      const realmWithPermanent: Realm = {
        ...mockRealm,
        permanentLockoutAfter: 2,
      };

      prisma.loginFailure.create.mockResolvedValue({});
      // First count: recent failures >= maxLoginFailures
      prisma.loginFailure.count
        .mockResolvedValueOnce(3)
        // Second count: total failures (2 lockouts * 3 = 6 total)
        .mockResolvedValueOnce(6);
      prisma.user.update.mockResolvedValue({});

      await service.recordFailure(realmWithPermanent, 'user-1', '10.0.0.1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          lockedUntil: new Date('2099-12-31T23:59:59Z'),
          // Permanently locked accounts are also disabled (security hardening).
          enabled: false,
        },
      });
    });
  });

  // ─── resetFailures ──────────────────────────────────────────

  describe('resetFailures', () => {
    it('should delete failures and set lockedUntil to null', async () => {
      prisma.loginFailure.deleteMany.mockResolvedValue({ count: 5 });
      prisma.user.update.mockResolvedValue({});

      await service.resetFailures('realm-1', 'user-1');

      expect(prisma.loginFailure.deleteMany).toHaveBeenCalledWith({
        where: { realmId: 'realm-1', userId: 'user-1' },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { lockedUntil: null },
      });
    });
  });

  // ─── unlockUser ─────────────────────────────────────────────

  describe('unlockUser', () => {
    it('should set lockedUntil to null and re-enable the account', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        realmId: 'realm-1',
      });
      prisma.user.update.mockResolvedValue({});
      prisma.loginFailure.deleteMany.mockResolvedValue({ count: 0 });

      await service.unlockUser('realm-1', 'user-1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1', realmId: 'realm-1' },
        data: { lockedUntil: null, enabled: true },
      });
    });

    it('should throw NotFoundException for user in wrong realm', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.unlockUser('realm-1', 'user-from-other-realm'),
      ).rejects.toThrow('User not found');
    });
  });

  // ─── getLockedUsers ─────────────────────────────────────────

  describe('getLockedUsers', () => {
    it('should query users with lockedUntil in the future', async () => {
      const lockedUsers = [
        {
          id: 'user-1',
          username: 'alice',
          email: 'alice@test.com',
          lockedUntil: new Date(),
        },
      ];
      prisma.user.findMany.mockResolvedValue(lockedUsers);

      const result = await service.getLockedUsers('realm-1');

      expect(result).toEqual(lockedUsers);
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          realmId: 'realm-1',
          lockedUntil: { gt: expect.any(Date) },
        },
        select: {
          id: true,
          username: true,
          email: true,
          lockedUntil: true,
        },
      });
    });

    it('should return empty array when no users are locked', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.getLockedUsers('realm-1');

      expect(result).toEqual([]);
    });
  });

  // ─── cleanupOldFailures ─────────────────────────────────────

  describe('cleanupOldFailures', () => {
    it('should delete failure records older than 24 hours', async () => {
      prisma.loginFailure.deleteMany.mockResolvedValue({ count: 10 });
      (prisma as any).totpFailureTracking.deleteMany.mockResolvedValue({ count: 0 });
      (prisma as any).webAuthnFailureTracking.deleteMany.mockResolvedValue({ count: 0 });

      await service.cleanupOldFailures();

      expect(prisma.loginFailure.deleteMany).toHaveBeenCalledWith({
        where: {
          failedAt: { lt: expect.any(Date) },
        },
      });

      // Verify the cutoff is approximately 24 hours ago
      const deleteCall = prisma.loginFailure.deleteMany.mock.calls[0][0];
      const cutoff = deleteCall.where.failedAt.lt as Date;
      const expected = Date.now() - 24 * 60 * 60 * 1000;
      expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(1000);
    });

    it('should handle zero deleted records gracefully', async () => {
      prisma.loginFailure.deleteMany.mockResolvedValue({ count: 0 });
      (prisma as any).totpFailureTracking.deleteMany.mockResolvedValue({ count: 0 });
      (prisma as any).webAuthnFailureTracking.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.cleanupOldFailures()).resolves.toBeUndefined();
    });
  });
});
