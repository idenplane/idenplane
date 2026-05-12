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

describe('RateLimitService', () => {
  let service: RateLimitService;
  let prisma: MockPrismaService;

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

  // ─── cleanupExpiredEntries ─────────────────────────────────

  describe('cleanupExpiredEntries', () => {
    it('should not throw when called with an empty store', () => {
      expect(() => service.cleanupExpiredEntries()).not.toThrow();
    });

    it('should remove entries older than 1 hour', async () => {
      prisma.realm.findUnique.mockResolvedValue(rateLimitEnabledRealm);

      // Add an entry
      await service.checkClientLimit(clientId, realmId);

      // Access internal store to manipulate timestamps
      const store = (service as any).memoryStore as Map<string, any>;
      const key = `client:${realmId}:${clientId}`;
      const entry = store.get(key)!;

      // Set both windows to 2 hours ago
      const twoHoursAgo = Date.now() - 2 * 3_600_000;
      entry.minute.windowStart = twoHoursAgo;
      entry.hour.windowStart = twoHoursAgo;

      expect(store.size).toBe(1);
      service.cleanupExpiredEntries();
      expect(store.size).toBe(0);
    });
  });
});
