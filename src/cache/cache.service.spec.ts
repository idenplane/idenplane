import { Test, TestingModule } from '@nestjs/testing';
import { CacheService } from './cache.service.js';
import { RedisService } from '../redis/redis.service.js';
import { MetricsService } from '../metrics/metrics.service.js';

const makeMockRedis = (available = true) => ({
  isAvailable: jest.fn().mockReturnValue(available),
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  exists: jest.fn().mockResolvedValue(false),
  delPattern: jest.fn().mockResolvedValue(undefined),
  ping: jest.fn().mockResolvedValue(true),
});

const makeMockMetrics = () => ({
  cacheOperationsTotal: { inc: jest.fn() },
});

describe('CacheService', () => {
  let service: CacheService;
  let redis: ReturnType<typeof makeMockRedis>;
  let metrics: ReturnType<typeof makeMockMetrics>;

  beforeEach(async () => {
    redis = makeMockRedis();
    metrics = makeMockMetrics();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheService,
        { provide: RedisService, useValue: redis },
        { provide: MetricsService, useValue: metrics },
      ],
    }).compile();

    service = module.get<CacheService>(CacheService);
  });

  // ─── Realm config ──────────────────────────────────────────────────────

  describe('realm config', () => {
    it('cacheRealmConfig stores JSON in Redis with TTL', async () => {
      const config = { id: 'r1', name: 'master' };
      await service.cacheRealmConfig('r1', config);
      expect(redis.set).toHaveBeenCalledWith(
        'realm:config:r1',
        JSON.stringify(config),
        300,
      );
    });

    it('cacheRealmConfig respects custom TTL', async () => {
      await service.cacheRealmConfig('r1', {}, 60);
      expect(redis.set).toHaveBeenCalledWith('realm:config:r1', '{}', 60);
    });

    it('getCachedRealmConfig returns null on cache miss', async () => {
      redis.get.mockResolvedValue(null);
      const result = await service.getCachedRealmConfig('r1');
      expect(result).toBeNull();
      expect(metrics.cacheOperationsTotal.inc).toHaveBeenCalledWith({
        operation: 'miss',
        cache: 'realm_config',
      });
    });

    it('getCachedRealmConfig returns parsed object on cache hit', async () => {
      const config = { id: 'r1', name: 'master' };
      redis.get.mockResolvedValue(JSON.stringify(config));
      const result = await service.getCachedRealmConfig('r1');
      expect(result).toEqual(config);
      expect(metrics.cacheOperationsTotal.inc).toHaveBeenCalledWith({
        operation: 'hit',
        cache: 'realm_config',
      });
    });

    it('invalidateRealmCache deletes realm and JWKS keys', async () => {
      await service.invalidateRealmCache('r1', 'master');
      expect(redis.del).toHaveBeenCalledWith('realm:config:r1');
      expect(redis.del).toHaveBeenCalledWith('realm:jwks:r1');
      expect(redis.del).toHaveBeenCalledWith('realm:name:master');
    });

    it('invalidateRealmCache without name skips name key', async () => {
      await service.invalidateRealmCache('r1');
      expect(redis.del).not.toHaveBeenCalledWith('realm:name:master');
    });
  });

  // ─── Realm by name ────────────────────────────────────────────────────

  describe('realm by name', () => {
    it('caches realm config by name', async () => {
      await service.cacheRealmByName('master', { id: 'r1' });
      expect(redis.set).toHaveBeenCalledWith(
        'realm:name:master',
        JSON.stringify({ id: 'r1' }),
        300,
      );
    });

    it('getCachedRealmByName returns null on miss', async () => {
      redis.get.mockResolvedValue(null);
      expect(await service.getCachedRealmByName('master')).toBeNull();
    });

    it('getCachedRealmByName returns parsed object on hit', async () => {
      redis.get.mockResolvedValue(JSON.stringify({ id: 'r1' }));
      expect(await service.getCachedRealmByName('master')).toEqual({
        id: 'r1',
      });
    });
  });

  // ─── Client config ────────────────────────────────────────────────────

  describe('client config', () => {
    it('cacheClientConfig stores JSON', async () => {
      await service.cacheClientConfig('c1', { clientId: 'myapp' });
      expect(redis.set).toHaveBeenCalledWith(
        'client:config:c1',
        JSON.stringify({ clientId: 'myapp' }),
        300,
      );
    });

    it('getCachedClientConfig returns null on miss', async () => {
      redis.get.mockResolvedValue(null);
      expect(await service.getCachedClientConfig('c1')).toBeNull();
    });

    it('getCachedClientConfig returns parsed on hit', async () => {
      redis.get.mockResolvedValue(JSON.stringify({ clientId: 'myapp' }));
      expect(await service.getCachedClientConfig('c1')).toEqual({
        clientId: 'myapp',
      });
    });

    it('invalidateClientCache deletes key', async () => {
      await service.invalidateClientCache('c1');
      expect(redis.del).toHaveBeenCalledWith('client:config:c1');
    });
  });

  // ─── JWKS ────────────────────────────────────────────────────────────

  describe('JWKS', () => {
    it('cacheJWKS stores with 600s TTL', async () => {
      const jwks = { keys: [] };
      await service.cacheJWKS('r1', jwks);
      expect(redis.set).toHaveBeenCalledWith(
        'realm:jwks:r1',
        JSON.stringify(jwks),
        600,
      );
    });

    it('getCachedJWKS returns null on miss', async () => {
      redis.get.mockResolvedValue(null);
      expect(await service.getCachedJWKS('r1')).toBeNull();
    });

    it('getCachedJWKS returns parsed on hit', async () => {
      redis.get.mockResolvedValue(JSON.stringify({ keys: [{ kid: 'k1' }] }));
      expect(await service.getCachedJWKS('r1')).toEqual({
        keys: [{ kid: 'k1' }],
      });
    });
  });

  // ─── CORS allowed origins ─────────────────────────────────────────────

  describe('CORS allowed origins', () => {
    it('cacheCorsOrigins stores JSON with default 300 s TTL', async () => {
      const origins = ['https://app.example.com', '*'];
      await service.cacheCorsOrigins(origins);
      expect(redis.set).toHaveBeenCalledWith(
        'cors:allowed-origins',
        JSON.stringify(origins),
        300,
      );
    });

    it('cacheCorsOrigins respects a custom TTL', async () => {
      await service.cacheCorsOrigins(['https://a.com'], 60);
      expect(redis.set).toHaveBeenCalledWith(
        'cors:allowed-origins',
        JSON.stringify(['https://a.com']),
        60,
      );
    });

    it('getCachedCorsOrigins returns null on cache miss', async () => {
      redis.get.mockResolvedValue(null);
      const result = await service.getCachedCorsOrigins();
      expect(result).toBeNull();
      expect(metrics.cacheOperationsTotal.inc).toHaveBeenCalledWith({
        operation: 'miss',
        cache: 'cors_origins',
      });
    });

    it('getCachedCorsOrigins returns the parsed array on cache hit', async () => {
      const origins = ['https://app.example.com'];
      redis.get.mockResolvedValue(JSON.stringify(origins));
      const result = await service.getCachedCorsOrigins();
      expect(result).toEqual(origins);
      expect(metrics.cacheOperationsTotal.inc).toHaveBeenCalledWith({
        operation: 'hit',
        cache: 'cors_origins',
      });
    });

    it('invalidateCorsOrigins deletes the cors:allowed-origins key', async () => {
      await service.invalidateCorsOrigins();
      expect(redis.del).toHaveBeenCalledWith('cors:allowed-origins');
    });
  });

  // ─── No-op when Redis unavailable ────────────────────────────────────

  describe('when Redis is unavailable', () => {
    beforeEach(() => {
      redis.isAvailable.mockReturnValue(false);
    });

    it('cacheRealmConfig does nothing', async () => {
      await service.cacheRealmConfig('r1', {});
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('getCachedRealmConfig returns null without hitting Redis', async () => {
      expect(await service.getCachedRealmConfig('r1')).toBeNull();
      expect(redis.get).not.toHaveBeenCalled();
    });

    it('invalidateRealmCache does nothing', async () => {
      await service.invalidateRealmCache('r1', 'master');
      expect(redis.del).not.toHaveBeenCalled();
    });
  });

  // ─── Corrupted cache value ────────────────────────────────────────────

  it('returns null on invalid JSON without throwing', async () => {
    redis.get.mockResolvedValue('not-json{{{');
    expect(await service.getCachedRealmConfig('r1')).toBeNull();
  });
});
