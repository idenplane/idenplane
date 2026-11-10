import { TokenBlacklistService } from './token-blacklist.service.js';
import type { CacheEvent } from '../cache/cache-bus.service.js';

const createMockRedisService = () => ({
  isAvailable: jest.fn().mockReturnValue(false),
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  exists: jest.fn().mockResolvedValue(false),
  del: jest.fn().mockResolvedValue(undefined),
});

const createMockPrismaService = () => ({
  revokedToken: {
    upsert: jest.fn().mockResolvedValue({}),
    findUnique: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
});

describe('TokenBlacklistService', () => {
  let service: TokenBlacklistService;

  beforeEach(async () => {
    service = new TokenBlacklistService(
      createMockRedisService() as any,
      createMockPrismaService() as any,
    );
    await service.onModuleInit();
  });

  afterEach(() => {
    // Clean up the interval to prevent leaking timers
    service.onModuleDestroy();
  });

  // ─── blacklistToken ─────────────────────────────────────────

  describe('blacklistToken', () => {
    it('should add token to blacklist and isBlacklisted returns true', async () => {
      const exp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

      await service.blacklistToken('jti-1', exp);

      expect(await service.isBlacklisted('jti-1')).toBe(true);
    });

    it('should handle multiple tokens', async () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;

      await service.blacklistToken('jti-1', exp);
      await service.blacklistToken('jti-2', exp);

      expect(await service.isBlacklisted('jti-1')).toBe(true);
      expect(await service.isBlacklisted('jti-2')).toBe(true);
    });
  });

  // ─── isBlacklisted ──────────────────────────────────────────

  describe('isBlacklisted', () => {
    it('should return false for an unknown jti', async () => {
      expect(await service.isBlacklisted('unknown-jti')).toBe(false);
    });

    it('should return true for a blacklisted jti even if expired', async () => {
      // Note: isBlacklisted only checks presence in the Map.
      // Expired entries are removed by cleanup(), not by isBlacklisted().
      const expiredExp = Math.floor(Date.now() / 1000) - 100;

      // blacklistToken skips already-expired tokens (ttl <= 0), so we
      // directly populate the internal memory fallback to simulate a token
      // that was added before it expired.
      (service as any).memoryFallback.set('expired-jti', expiredExp);

      expect(await service.isBlacklisted('expired-jti')).toBe(true);
    });
  });

  // ─── cleanup ────────────────────────────────────────────────

  describe('cleanup (private, tested via timer)', () => {
    it('should remove expired entries and keep non-expired ones', async () => {
      jest.useFakeTimers();

      // Create a fresh service so its interval uses fake timers
      const timedService = new TokenBlacklistService(
        createMockRedisService() as any,
        createMockPrismaService() as any,
      );
      await timedService.onModuleInit();

      const expiredExp = Math.floor(Date.now() / 1000) - 100; // already expired
      const validExp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

      // Directly populate memory fallback since blacklistToken skips expired tokens
      (timedService as any).memoryFallback.set('expired-jti', expiredExp);
      // Add a valid token through normal path
      (timedService as any).memoryFallback.set('valid-jti', validExp);

      expect(await timedService.isBlacklisted('expired-jti')).toBe(true);
      expect(await timedService.isBlacklisted('valid-jti')).toBe(true);

      // Advance time to trigger the cleanup interval (60 seconds)
      jest.advanceTimersByTime(60_000);

      // Allow the async cleanup to flush
      await Promise.resolve();

      expect(await timedService.isBlacklisted('expired-jti')).toBe(false);
      expect(await timedService.isBlacklisted('valid-jti')).toBe(true);

      timedService.onModuleDestroy();
      jest.useRealTimers();
    });
  });

  // ─── onModuleDestroy ────────────────────────────────────────

  describe('onModuleDestroy', () => {
    it('should clear the cleanup interval', () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      service.onModuleDestroy();

      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });
  });
});

describe('TokenBlacklistService with the announcement channel', () => {
  const makeBus = () => {
    const events: Array<(e: CacheEvent) => void> = [];
    const resets: Array<() => void> = [];
    const bus = {
      connected: false,
      isConnected: () => bus.connected,
      onEvent: (h: (e: CacheEvent) => void) => events.push(h),
      onReset: (h: () => void) => resets.push(h),
      emit: (e: CacheEvent) => events.forEach((h) => h(e)),
      /** What CacheBusService does on a (re)connect. */
      connect: () => {
        resets.forEach((h) => h());
        bus.connected = true;
      },
      drop: () => {
        bus.connected = false;
        resets.forEach((h) => h());
      },
    };
    return bus;
  };
  const settle = () => new Promise((r) => setImmediate(r));
  const later = Math.floor(Date.now() / 1000) + 3600;

  let prisma: ReturnType<typeof createMockPrismaService>;
  let bus: ReturnType<typeof makeBus>;
  let service: TokenBlacklistService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    bus = makeBus();
    service = new TokenBlacklistService(
      createMockRedisService() as any,
      prisma as any,
      bus as any,
    );
  });

  afterEach(() => service.onModuleDestroy());

  it('answers from memory once loaded, without asking the database', async () => {
    prisma.revokedToken.findMany.mockResolvedValue([
      { jti: 'gone', expiresAt: new Date(later * 1000) },
    ]);
    bus.connect();
    await settle();
    await settle();
    expect(await service.isBlacklisted('gone')).toBe(true);
    expect(await service.isBlacklisted('fine')).toBe(false);
    expect(prisma.revokedToken.findUnique).not.toHaveBeenCalled();
  });

  it('adds ids the database announces, including during the load', async () => {
    let finish!: (rows: unknown[]) => void;
    prisma.revokedToken.findMany.mockReturnValue(
      new Promise((resolve) => (finish = resolve)),
    );
    bus.connect();
    await settle();
    bus.emit({ t: 'revoked', jti: 'during', exp: later });
    finish([]);
    await settle();
    bus.emit({ t: 'revoked', jti: 'after', exp: later });
    expect(await service.isBlacklisted('during')).toBe(true);
    expect(await service.isBlacklisted('after')).toBe(true);
    expect(prisma.revokedToken.findUnique).not.toHaveBeenCalled();
  });

  it('asks the database before the load and while the channel is down', async () => {
    expect(await service.isBlacklisted('x')).toBe(false);
    expect(prisma.revokedToken.findUnique).toHaveBeenCalledTimes(1);

    bus.connect();
    await settle();
    await settle();
    bus.drop();
    prisma.revokedToken.findUnique.mockResolvedValue({
      jti: 'y',
      expiresAt: new Date(later * 1000),
    });
    expect(await service.isBlacklisted('y')).toBe(true);
    expect(prisma.revokedToken.findUnique).toHaveBeenCalledTimes(2);
  });

  it('sees its own revocation at once', async () => {
    bus.connect();
    await settle();
    await settle();
    await service.blacklistToken('mine', later);
    expect(await service.isBlacklisted('mine')).toBe(true);
    expect(prisma.revokedToken.findUnique).not.toHaveBeenCalled();
  });

  it('stays on the database if the load fails', async () => {
    prisma.revokedToken.findMany.mockRejectedValue(new Error('down'));
    bus.connect();
    await settle();
    await settle();
    await service.isBlacklisted('z');
    expect(prisma.revokedToken.findUnique).toHaveBeenCalledTimes(1);
  });
});
