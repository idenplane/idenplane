import { Test, TestingModule } from '@nestjs/testing';
import { CorsOriginService } from './cors-origin.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CacheService } from '../cache/cache.service.js';
import {
  CacheBusService,
  type CacheEvent,
} from '../cache/cache-bus.service.js';

const rows = (webOriginsList: string[][]) =>
  webOriginsList.map((webOrigins) => ({ webOrigins }));

const makeMockPrisma = (webOriginsList: string[][] = []) => ({
  client: {
    findMany: jest.fn().mockResolvedValue(rows(webOriginsList)),
  },
  onBeforeDisconnect: jest.fn(),
});

const makeMockCache = () => ({
  getCachedCorsOrigins: jest.fn().mockResolvedValue(null),
  cacheCorsOrigins: jest.fn().mockResolvedValue(undefined),
  invalidateCorsOrigins: jest.fn().mockResolvedValue(undefined),
});

/** A bus whose events and resets the test fires by hand. */
const makeMockBus = () => {
  const events: Array<(e: CacheEvent) => void> = [];
  const resets: Array<() => void> = [];
  return {
    onEvent: jest.fn((h: (e: CacheEvent) => void) => events.push(h)),
    onReset: jest.fn((h: () => void) => resets.push(h)),
    isConnected: jest.fn().mockReturnValue(true),
    emit: (e: CacheEvent) => events.forEach((h) => h(e)),
    reset: () => resets.forEach((h) => h()),
  };
};

/** Lets queued background reloads run. */
const settle = () => new Promise((r) => setImmediate(r));

describe('CorsOriginService', () => {
  let service: CorsOriginService;
  let prisma: ReturnType<typeof makeMockPrisma>;
  let cache: ReturnType<typeof makeMockCache>;
  let bus: ReturnType<typeof makeMockBus>;

  async function build(webOriginsList: string[][] = []) {
    prisma = makeMockPrisma(webOriginsList);
    cache = makeMockCache();
    bus = makeMockBus();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CorsOriginService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cache },
        { provide: CacheBusService, useValue: bus },
      ],
    }).compile();

    service = module.get<CorsOriginService>(CorsOriginService);
  }

  afterEach(() => jest.useRealTimers());

  describe('loading', () => {
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

    it('is null for the synchronous check only before the first load', async () => {
      expect(service.getCachedOrigins()).toBeNull();
      await service.preloadCache();
      expect(service.getCachedOrigins()?.has('https://app.example.com')).toBe(
        true,
      );
    });

    it('does not hit the DB on a second call within TTL', async () => {
      await service.isOriginAllowed('https://app.example.com');
      await service.isOriginAllowed('https://app.example.com');
      expect(prisma.client.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('after the TTL', () => {
    beforeEach(() => build([['https://app.example.com']]));

    // The set used to expire to null and never reload, which denied every
    // client origin five minutes after boot.
    it('keeps answering the synchronous check, and reloads in the background', async () => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
      await service.preloadCache();
      jest.setSystemTime(Date.now() + 6 * 60 * 1000);
      prisma.client.findMany.mockResolvedValue(
        rows([['https://app.example.com', 'https://new.example.com']]),
      );

      const stale = service.getCachedOrigins();
      expect(stale?.has('https://app.example.com')).toBe(true);
      await settle();

      expect(prisma.client.findMany).toHaveBeenCalledTimes(2);
      expect(service.getCachedOrigins()?.has('https://new.example.com')).toBe(
        true,
      );
    });
  });

  describe('announced changes', () => {
    beforeEach(() => build([['https://app.example.com']]));

    it('reloads when the database announces a client change', async () => {
      await service.preloadCache();
      prisma.client.findMany.mockResolvedValue(rows([]));

      bus.emit({ t: 'client', realmId: 'r', id: 'c', clientIds: ['app'] });
      await settle();

      expect(service.getCachedOrigins()?.has('https://app.example.com')).toBe(
        false,
      );
    });

    it('ignores changes to other tables', async () => {
      await service.preloadCache();
      bus.emit({ t: 'keys', realmId: 'r' });
      await settle();
      expect(prisma.client.findMany).toHaveBeenCalledTimes(1);
    });

    it('reloads when the announcement channel reconnects', async () => {
      await service.preloadCache();
      bus.reset();
      await settle();
      expect(prisma.client.findMany).toHaveBeenCalledTimes(2);
    });

    it('queues one more load for a change announced during a load', async () => {
      await service.preloadCache();
      let finish!: (v: unknown) => void;
      prisma.client.findMany.mockReturnValueOnce(
        new Promise((r) => (finish = r)),
      );
      prisma.client.findMany.mockResolvedValue(
        rows([['https://after.example.com']]),
      );

      service.invalidateLocalCache();
      bus.emit({ t: 'client', realmId: 'r', id: 'c', clientIds: ['app'] });
      finish(rows([['https://during.example.com']]));
      await settle();
      await settle();

      expect(prisma.client.findMany).toHaveBeenCalledTimes(3);
      expect(service.getCachedOrigins()?.has('https://after.example.com')).toBe(
        true,
      );
    });
  });

  // Even when a client record in the database contains '*' as a webOrigin
  // (legacy data that pre-dates the creation-time validation, #320), the
  // service must NOT honour it.
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

  describe('when the database throws', () => {
    it('denies every origin (deny-safe) before any load succeeded', async () => {
      await build();
      prisma.client.findMany.mockRejectedValue(new Error('connection lost'));
      expect(await service.isOriginAllowed('https://app.example.com')).toBe(
        false,
      );
    });

    it('keeps serving the last good set when a reload fails', async () => {
      await build([['https://app.example.com']]);
      await service.preloadCache();
      prisma.client.findMany.mockRejectedValue(new Error('connection lost'));

      service.invalidateLocalCache();
      await settle();

      expect(service.getCachedOrigins()?.has('https://app.example.com')).toBe(
        true,
      );
    });
  });
});
