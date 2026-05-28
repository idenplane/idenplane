import { RateLimitService } from './rate-limit.service.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';

const createMockRedisService = () => ({
  isAvailable: jest.fn().mockReturnValue(false),
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  exists: jest.fn().mockResolvedValue(false),
  del: jest.fn().mockResolvedValue(undefined),
});

/**
 * Create a stateful upsert mock that accumulates minuteCount and hourCount
 * per key (simulating the DB upsert + increment behaviour).
 */
function createStatefulUpsertMock() {
  const store = new Map<
    string,
    {
      minuteCount: number;
      minuteWindowStart: Date;
      hourCount: number;
      hourWindowStart: Date;
    }
  >();

  const upsertFn = jest.fn().mockImplementation(
    (args: {
      where: { key: string };
      create: {
        key: string;
        minuteCount: number;
        minuteWindowStart: Date;
        hourCount: number;
        hourWindowStart: Date;
      };
      update: {
        minuteCount?: { increment: number };
        hourCount?: { increment: number };
      };
    }) => {
      const key = args.where.key;
      if (!store.has(key)) {
        store.set(key, { ...args.create });
      } else {
        const entry = store.get(key)!;
        if (args.update.minuteCount?.increment !== undefined) {
          entry.minuteCount += args.update.minuteCount.increment;
        }
        if (args.update.hourCount?.increment !== undefined) {
          entry.hourCount += args.update.hourCount.increment;
        }
      }
      return Promise.resolve({ ...store.get(key)! });
    },
  );

  // Expose store for manipulation in tests
  (upsertFn as any).__store = store;
  return upsertFn;
}

describe('RateLimitService', () => {
  let service: RateLimitService;
  let prisma: MockPrismaService;
  let upsertMock: ReturnType<typeof createStatefulUpsertMock>;

  const realmId = 'realm-1';
  const clientId = 'client-1';
  const userId = 'user-1';
  const ip = '192.168.1.1';

  const rateLimitEnabledRealm = {
    rateLimitEnabled: true,
    clientRateLimitPerMinute: 5,
    clientRateLimitPerHour: 100,
    userRateLimitPerMinute: 3,
    userRateLimitPerHour: 50,
    ipRateLimitPerMinute: 2,
    ipRateLimitPerHour: 20,
  };

  const rateLimitDisabledRealm = {
    rateLimitEnabled: false,
    clientRateLimitPerMinute: 5,
    clientRateLimitPerHour: 100,
    userRateLimitPerMinute: 3,
    userRateLimitPerHour: 50,
    ipRateLimitPerMinute: 2,
    ipRateLimitPerHour: 20,
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    upsertMock = createStatefulUpsertMock();
    prisma.rateLimitEntry.upsert = upsertMock;
    // Stateful update mock sharing the upsert store so rejection-compensation
    // (decrement) and window-reset writes are reflected in the same counters.
    prisma.rateLimitEntry.update = jest
      .fn()
      .mockImplementation((args: { where: { key: string }; data: any }) => {
        const store = (upsertMock as any).__store as Map<string, any>;
        const entry = store.get(args.where.key);
        if (entry) {
          const d = args.data;
          if (d.minuteCount?.decrement !== undefined)
            entry.minuteCount -= d.minuteCount.decrement;
          else if (typeof d.minuteCount === 'number')
            entry.minuteCount = d.minuteCount;
          if (d.hourCount?.decrement !== undefined)
            entry.hourCount -= d.hourCount.decrement;
          else if (typeof d.hourCount === 'number')
            entry.hourCount = d.hourCount;
          if (d.minuteWindowStart) entry.minuteWindowStart = d.minuteWindowStart;
          if (d.hourWindowStart) entry.hourWindowStart = d.hourWindowStart;
        }
        return Promise.resolve(entry ? { ...entry } : { key: args.where.key });
      });
    service = new RateLimitService(
      prisma as any,
      createMockRedisService() as any,
    );
  });

  // ─── checkClientLimit ───────────────────────────────────────

  describe('checkClientLimit', () => {
    it('should allow request when rate limiting is disabled', async () => {
      prisma.realm.findUnique.mockResolvedValue(rateLimitDisabledRealm);

      const result = await service.checkClientLimit(clientId, realmId);

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(0);
    });

    it('should return allowed when rate limit is not disabled and realm is null', async () => {
      prisma.realm.findUnique.mockResolvedValue(null);

      const result = await service.checkClientLimit(clientId, realmId);

      expect(result.allowed).toBe(true);
    });

    it('should allow requests within the per-minute limit', async () => {
      prisma.realm.findUnique.mockResolvedValue(rateLimitEnabledRealm);

      for (let i = 0; i < 5; i++) {
        const result = await service.checkClientLimit(clientId, realmId);
        expect(result.allowed).toBe(true);
      }
    });

    it('should block requests exceeding the per-minute limit', async () => {
      prisma.realm.findUnique.mockResolvedValue(rateLimitEnabledRealm);

      // Use up the 5 allowed per minute
      for (let i = 0; i < 5; i++) {
        await service.checkClientLimit(clientId, realmId);
      }

      // 6th request should be blocked
      const result = await service.checkClientLimit(clientId, realmId);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('does not inflate the counter when rejected requests retry (finding #7)', async () => {
      prisma.realm.findUnique.mockResolvedValue({
        ...rateLimitEnabledRealm,
        clientRateLimitPerMinute: 2,
      });

      // Exhaust the 2 allowed requests
      await service.checkClientLimit(clientId, realmId);
      await service.checkClientLimit(clientId, realmId);

      // Hammer with rejected retries — these must NOT keep incrementing
      for (let i = 0; i < 5; i++) {
        const r = await service.checkClientLimit(clientId, realmId);
        expect(r.allowed).toBe(false);
      }

      const store = (upsertMock as any).__store as Map<string, any>;
      const entry = [...store.values()][0];
      // Counter stays capped at the limit (2), not 2 + 5 rejected retries.
      expect(entry.minuteCount).toBe(2);
    });

    it('should track different clients independently', async () => {
      prisma.realm.findUnique.mockResolvedValue({
        ...rateLimitEnabledRealm,
        clientRateLimitPerMinute: 1,
      });

      // Exhaust client-1
      await service.checkClientLimit(clientId, realmId);
      const blocked = await service.checkClientLimit(clientId, realmId);
      expect(blocked.allowed).toBe(false);

      // client-2 should still be allowed
      const allowed = await service.checkClientLimit('client-2', realmId);
      expect(allowed.allowed).toBe(true);
    });

    it('should track different realms independently', async () => {
      prisma.realm.findUnique.mockResolvedValue({
        ...rateLimitEnabledRealm,
        clientRateLimitPerMinute: 1,
      });

      await service.checkClientLimit(clientId, realmId);
      const blocked = await service.checkClientLimit(clientId, realmId);
      expect(blocked.allowed).toBe(false);

      const allowed = await service.checkClientLimit(clientId, 'realm-2');
      expect(allowed.allowed).toBe(true);
    });

    it('should return correct remaining count', async () => {
      prisma.realm.findUnique.mockResolvedValue(rateLimitEnabledRealm);

      const first = await service.checkClientLimit(clientId, realmId);
      expect(first.remaining).toBe(4); // 5 - 1 = 4

      const second = await service.checkClientLimit(clientId, realmId);
      expect(second.remaining).toBe(3); // 5 - 2 = 3
    });

    it('should return limit equal to per-minute limit', async () => {
      prisma.realm.findUnique.mockResolvedValue(rateLimitEnabledRealm);

      const result = await service.checkClientLimit(clientId, realmId);
      expect(result.limit).toBe(5);
    });

    it('should return a future resetAt timestamp', async () => {
      prisma.realm.findUnique.mockResolvedValue(rateLimitEnabledRealm);
      const nowSeconds = Math.floor(Date.now() / 1000);

      const result = await service.checkClientLimit(clientId, realmId);
      expect(result.resetAt).toBeGreaterThan(nowSeconds);
    });
  });

  // ─── checkUserLimit ────────────────────────────────────────

  describe('checkUserLimit', () => {
    it('should allow request when rate limiting is disabled', async () => {
      prisma.realm.findUnique.mockResolvedValue(rateLimitDisabledRealm);

      const result = await service.checkUserLimit(userId, realmId);

      expect(result.allowed).toBe(true);
    });

    it('should allow requests within the per-minute limit', async () => {
      prisma.realm.findUnique.mockResolvedValue(rateLimitEnabledRealm);

      for (let i = 0; i < 3; i++) {
        const result = await service.checkUserLimit(userId, realmId);
        expect(result.allowed).toBe(true);
      }
    });

    it('should block requests exceeding the per-minute user limit', async () => {
      prisma.realm.findUnique.mockResolvedValue(rateLimitEnabledRealm);

      for (let i = 0; i < 3; i++) {
        await service.checkUserLimit(userId, realmId);
      }

      const result = await service.checkUserLimit(userId, realmId);
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeGreaterThan(0);
    });
  });

  // ─── checkIpLimit ──────────────────────────────────────────

  describe('checkIpLimit', () => {
    it('should allow request when rate limiting is disabled', async () => {
      prisma.realm.findUnique.mockResolvedValue(rateLimitDisabledRealm);

      const result = await service.checkIpLimit(ip, realmId);

      expect(result.allowed).toBe(true);
    });

    it('should allow requests within the per-minute IP limit', async () => {
      prisma.realm.findUnique.mockResolvedValue(rateLimitEnabledRealm);

      for (let i = 0; i < 2; i++) {
        const result = await service.checkIpLimit(ip, realmId);
        expect(result.allowed).toBe(true);
      }
    });

    it('should block requests exceeding the per-minute IP limit', async () => {
      prisma.realm.findUnique.mockResolvedValue(rateLimitEnabledRealm);

      for (let i = 0; i < 2; i++) {
        await service.checkIpLimit(ip, realmId);
      }

      const result = await service.checkIpLimit(ip, realmId);
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('should track different IPs independently', async () => {
      prisma.realm.findUnique.mockResolvedValue({
        ...rateLimitEnabledRealm,
        ipRateLimitPerMinute: 1,
      });

      await service.checkIpLimit(ip, realmId);
      const blocked = await service.checkIpLimit(ip, realmId);
      expect(blocked.allowed).toBe(false);

      const allowed = await service.checkIpLimit('10.0.0.1', realmId);
      expect(allowed.allowed).toBe(true);
    });
  });

  // ─── computeHeaders ────────────────────────────────────────

  describe('computeHeaders', () => {
    it('should return standard rate limit headers when allowed', () => {
      const result = {
        allowed: true,
        limit: 60,
        remaining: 55,
        resetAt: 1711234567,
      };

      const headers = service.computeHeaders(result);

      expect(headers['X-RateLimit-Limit']).toBe('60');
      expect(headers['X-RateLimit-Remaining']).toBe('55');
      expect(headers['X-RateLimit-Reset']).toBe('1711234567');
      expect(headers['Retry-After']).toBeUndefined();
    });

    it('should include Retry-After header when blocked', () => {
      const result = {
        allowed: false,
        limit: 60,
        remaining: 0,
        resetAt: 1711234567,
        retryAfter: 30,
      };

      const headers = service.computeHeaders(result);

      expect(headers['X-RateLimit-Limit']).toBe('60');
      expect(headers['X-RateLimit-Remaining']).toBe('0');
      expect(headers['Retry-After']).toBe('30');
    });

    it('should clamp remaining to 0 when negative', () => {
      const result = {
        allowed: false,
        limit: 5,
        remaining: -1,
        resetAt: 1711234567,
        retryAfter: 10,
      };

      const headers = service.computeHeaders(result);

      expect(headers['X-RateLimit-Remaining']).toBe('0');
    });
  });

  // ─── cleanupExpiredDbEntries ───────────────────────────────

  describe('cleanupExpiredDbEntries', () => {
    it('should not throw when called with no stale entries', async () => {
      prisma.rateLimitEntry.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.cleanupExpiredDbEntries()).resolves.not.toThrow();
    });

    it('should delete entries older than 1 hour', async () => {
      prisma.rateLimitEntry.deleteMany.mockResolvedValue({ count: 5 });

      await service.cleanupExpiredDbEntries();

      expect(prisma.rateLimitEntry.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ minuteWindowStart: expect.any(Object) }),
              expect.objectContaining({ hourWindowStart: expect.any(Object) }),
            ]),
          }),
        }),
      );
    });
  });
});
