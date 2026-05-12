import { Test, TestingModule } from '@nestjs/testing';
import { CorsOriginService } from './cors-origin.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CacheService } from '../cache/cache.service.js';

const makeMockPrisma = (webOriginsList: string[][] = []) => ({
  client: {
    findMany: jest
      .fn()
      .mockResolvedValue(webOriginsList.map((webOrigins) => ({ webOrigins }))),
  },
});

const makeMockCache = (cachedOrigins: string[] | null = null) => ({
  getCachedCorsOrigins: jest.fn().mockResolvedValue(cachedOrigins),
  cacheCorsOrigins: jest.fn().mockResolvedValue(undefined),
  invalidateCorsOrigins: jest.fn().mockResolvedValue(undefined),
});

describe('CorsOriginService', () => {
  let service: CorsOriginService;
  let prisma: ReturnType<typeof makeMockPrisma>;
  let cache: ReturnType<typeof makeMockCache>;

  async function build(
    webOriginsList: string[][] = [],
    cachedOrigins: string[] | null = null,
  ) {
    prisma = makeMockPrisma(webOriginsList);
    cache = makeMockCache(cachedOrigins);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CorsOriginService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();

    service = module.get<CorsOriginService>(CorsOriginService);
  }

  // ─── Cache miss → DB load ─────────────────────────────────────────────

  describe('when Redis has no cached value', () => {
    beforeEach(() =>
      build([['https://app.example.com', 'https://admin.example.com']]),
    );

    it('loads origins from the database on first call', async () => {
      expect(await service.isOriginAllowed('https://app.example.com')).toBe(
        true,
      );
      expect(prisma.client.findMany).toHaveBeenCalledTimes(1);
    });

    it('denies an origin not in any client webOrigins', async () => {
      expect(await service.isOriginAllowed('https://evil.com')).toBe(false);
    });

    it('persists the loaded origins to Redis', async () => {
      await service.isOriginAllowed('https://app.example.com');
      expect(cache.cacheCorsOrigins).toHaveBeenCalledWith(
        expect.arrayContaining([
          'https://app.example.com',
          'https://admin.example.com',
        ]),
      );
    });
  });

  // ─── Redis cache hit ──────────────────────────────────────────────────

  describe('when Redis has a cached value', () => {
    beforeEach(() => build([], ['https://cached.example.com']));

    it('uses the cached value without hitting the database', async () => {
      expect(await service.isOriginAllowed('https://cached.example.com')).toBe(
        true,
      );
      expect(prisma.client.findMany).not.toHaveBeenCalled();
    });

    it('denies origins not in the Redis cache', async () => {
      expect(await service.isOriginAllowed('https://other.com')).toBe(false);
    });
  });

  // ─── In-process cache (second call) ──────────────────────────────────

  describe('in-process caching', () => {
    beforeEach(() => build([['https://app.example.com']]));

    it('does not hit Redis or the DB on a second call within TTL', async () => {
      await service.isOriginAllowed('https://app.example.com');
      await service.isOriginAllowed('https://app.example.com');

      // Redis + DB each called only once despite two isOriginAllowed calls
      expect(cache.getCachedCorsOrigins).toHaveBeenCalledTimes(1);
      expect(prisma.client.findMany).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Wildcard rejection (#320) ────────────────────────────────────────
  //
  // Even when a client record in the database contains '*' as a webOrigin
  // (legacy data that pre-dates the creation-time validation), the service
  // must NOT honour it.  The wildcard is filtered out at load time and a
  // warning is emitted; all origin checks must return false in this case.

  describe('wildcard origin in database (legacy data)', () => {
    beforeEach(() => build([['*']]));

    it('does NOT allow any origin when the only webOrigin stored is "*"', async () => {
      expect(
        await service.isOriginAllowed('https://anything.example.com'),
      ).toBe(false);
    });

    it('does NOT allow the literal "*" origin string', async () => {
      expect(await service.isOriginAllowed('*')).toBe(false);
    });
  });

  describe('wildcard mixed with concrete origins (legacy data)', () => {
    beforeEach(() => build([['*', 'https://app.example.com']]));

    it('allows the concrete origin', async () => {
      expect(await service.isOriginAllowed('https://app.example.com')).toBe(
        true,
      );
    });

    it('does NOT allow an arbitrary origin just because "*" is present', async () => {
      expect(await service.isOriginAllowed('https://evil.com')).toBe(false);
    });
  });

  // ─── invalidateLocalCache ─────────────────────────────────────────────

  describe('invalidateLocalCache', () => {
    beforeEach(() => build([['https://app.example.com']]));

    it('forces a DB reload on the next call after invalidation', async () => {
      // Populate in-process cache
      await service.isOriginAllowed('https://app.example.com');
      expect(prisma.client.findMany).toHaveBeenCalledTimes(1);

      service.invalidateLocalCache();

      // After invalidation the cache is gone — Redis returns null again
      cache.getCachedCorsOrigins.mockResolvedValue(null);

      await service.isOriginAllowed('https://app.example.com');
      expect(prisma.client.findMany).toHaveBeenCalledTimes(2);
    });
  });

  // ─── DB error handling ────────────────────────────────────────────────

  describe('when the database throws', () => {
    beforeEach(async () => {
      await build();
      prisma.client.findMany.mockRejectedValue(new Error('connection lost'));
    });

    it('returns false for any origin (deny-safe) without throwing', async () => {
      expect(await service.isOriginAllowed('https://app.example.com')).toBe(
        false,
      );
    });
  });
});
