import { Test, TestingModule } from '@nestjs/testing';
import { CacheService } from './cache.service.js';
import { RedisService } from '../redis/redis.service.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { CacheBusService, type CacheEvent } from './cache-bus.service.js';

const makeMockRedis = (available = true) => ({
  isAvailable: jest.fn().mockReturnValue(available),
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  exists: jest.fn().mockResolvedValue(false),
  delPattern: jest.fn().mockResolvedValue(undefined),
  ping: jest.fn().mockResolvedValue(true),
});

/** A bus the test drives by hand; disconnected unless told otherwise. */
const makeMockBus = (connected = false) => {
  const events: Array<(e: CacheEvent) => void> = [];
  const resets: Array<() => void> = [];
  return {
    connected,
    isConnected: jest.fn(function (this: { connected: boolean }) {
      return this.connected;
    }),
    onEvent: jest.fn((h: (e: CacheEvent) => void) => events.push(h)),
    onReset: jest.fn((h: () => void) => resets.push(h)),
    emit: (e: CacheEvent) => events.forEach((h) => h(e)),
    reset: () => resets.forEach((h) => h()),
  };
};

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
        // Disconnected: these tests cover the Redis level alone.
        { provide: CacheBusService, useValue: makeMockBus(false) },
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
        60,
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

describe('CacheService in-process level', () => {
  let service: CacheService;
  let bus: ReturnType<typeof makeMockBus>;
  let redis: ReturnType<typeof makeMockRedis>;

  beforeEach(async () => {
    redis = makeMockRedis(false); // no Redis: the default deployment
    bus = makeMockBus(true);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheService,
        { provide: RedisService, useValue: redis },
        { provide: MetricsService, useValue: makeMockMetrics() },
        { provide: CacheBusService, useValue: bus },
      ],
    }).compile();
    service = module.get<CacheService>(CacheService);
  });

  afterEach(() => jest.useRealTimers());

  /** The cache-aside pattern every caller uses: miss, read, store. */
  const fill = async (name: string, realm: object) => {
    expect(await service.getCachedRealmByName(name)).toBeNull();
    await service.cacheRealmByName(name, realm);
  };

  it('serves a stored entry without Redis', async () => {
    await fill('master', { id: 'r1', name: 'master' });
    expect(await service.getCachedRealmByName('master')).toEqual({
      id: 'r1',
      name: 'master',
    });
  });

  it('detaches what it stores from the caller, and hands out a frozen object', async () => {
    const realm = { id: 'r1', name: 'master', enabled: true, tags: ['a'] };
    await fill('master', realm);
    realm.enabled = false; // the caller's object, not the cache's
    realm.tags.push('b');

    const hit = await service.getCachedRealmByName<typeof realm>('master');
    expect(hit).toEqual({
      id: 'r1',
      name: 'master',
      enabled: true,
      tags: ['a'],
    });
    // A reader cannot change what the next one reads: it would throw.
    expect(() => {
      hit!.enabled = false;
    }).toThrow(/read only|read-only/);
    // (Thrown from the main realm under jest's VM modules, so match the message.)
    expect(() => hit!.tags.push('c')).toThrow(/not extensible/);
    expect(
      (await service.getCachedRealmByName<typeof realm>('master'))!.enabled,
    ).toBe(true);
  });

  it('serves the same object to every reader, without copying', async () => {
    await fill('master', { id: 'r1' });
    const a = await service.getCachedRealmByName('master');
    const b = await service.getCachedRealmByName('master');
    expect(a).toBe(b);
  });

  it('keeps Dates as Dates', async () => {
    const createdAt = new Date('2026-01-02T03:04:05Z');
    await fill('master', { id: 'r1', createdAt });
    const hit = await service.getCachedRealmByName<{ createdAt: Date }>(
      'master',
    );
    // structuredClone builds the Date in the main realm, not jest's, so
    // instanceof would compare constructors from different realms.
    expect(Object.prototype.toString.call(hit!.createdAt)).toBe(
      '[object Date]',
    );
    expect(hit!.createdAt.getTime()).toBe(createdAt.getTime());
  });

  it('drops a realm under its old and new name, and its JWKS, when announced', async () => {
    await fill('old', { id: 'r1' });
    expect(await service.getCachedJWKS('r1')).toBeNull();
    await service.cacheJWKS('r1', { keys: [1] });

    bus.emit({ t: 'realm', id: 'r1', names: ['old', 'new'] });
    await Promise.resolve();

    expect(await service.getCachedRealmByName('old')).toBeNull();
    expect(await service.getCachedJWKS('r1')).toBeNull();
  });

  it('drops a client under its client_id and its database id when announced', async () => {
    for (const key of ['r1:app', 'r1:uuid-1']) {
      expect(await service.getCachedClientConfig(key)).toBeNull();
      await service.cacheClientConfig(key, { clientId: 'app' });
    }

    bus.emit({ t: 'client', realmId: 'r1', id: 'uuid-1', clientIds: ['app'] });
    await Promise.resolve();

    expect(await service.getCachedClientConfig('r1:app')).toBeNull();
    expect(await service.getCachedClientConfig('r1:uuid-1')).toBeNull();
  });

  it('drops the JWKS when signing keys change', async () => {
    expect(await service.getCachedJWKS('r1')).toBeNull();
    await service.cacheJWKS('r1', { keys: [1] });
    bus.emit({ t: 'keys', realmId: 'r1' });
    await Promise.resolve();
    expect(await service.getCachedJWKS('r1')).toBeNull();
  });

  it('does not store a row read before an invalidation that arrived meanwhile', async () => {
    expect(await service.getCachedRealmByName('master')).toBeNull();
    // ...the database is read, and before the result is stored, the row
    // changes and the change is announced:
    bus.emit({ t: 'realm', id: 'r1', names: ['master'] });
    await Promise.resolve();
    await service.cacheRealmByName('master', { id: 'r1', enabled: true });

    expect(await service.getCachedRealmByName('master')).toBeNull();
  });

  it('is not used while the announcement channel is down', async () => {
    await fill('master', { id: 'r1' });
    bus.connected = false;
    expect(await service.getCachedRealmByName('master')).toBeNull();
    await service.cacheRealmByName('master', { id: 'r1' });
    bus.connected = true;
    // Whatever was stored before the outage is gone after it (reset).
    bus.reset();
    expect(await service.getCachedRealmByName('master')).toBeNull();
  });

  it('expires entries after their TTL', async () => {
    jest.useFakeTimers();
    await fill('master', { id: 'r1' });
    jest.setSystemTime(Date.now() + 301_000);
    expect(await service.getCachedRealmByName('master')).toBeNull();
  });

  it('stores nothing for a key that was never looked up', async () => {
    await service.cacheRealmByName('master', { id: 'r1' });
    expect(await service.getCachedRealmByName('master')).toBeNull();
  });

  it('stays bounded, evicting the oldest entries', async () => {
    for (let i = 0; i < 10_001; i++) await fill(`realm-${i}`, { id: `${i}` });
    expect(await service.getCachedRealmByName('realm-0')).toBeNull();
    expect(await service.getCachedRealmByName('realm-10000')).toEqual({
      id: '10000',
    });
  });
});

describe('CacheService user claims', () => {
  let service: CacheService;
  let bus: ReturnType<typeof makeMockBus>;

  beforeEach(async () => {
    bus = makeMockBus(true);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheService,
        { provide: RedisService, useValue: makeMockRedis(false) },
        { provide: MetricsService, useValue: makeMockMetrics() },
        { provide: CacheBusService, useValue: bus },
      ],
    }).compile();
    service = module.get<CacheService>(CacheService);
  });

  const grantsOf = (userId: string, roles: string[]) =>
    service.localUserGrants(userId, () => Promise.resolve({ roles }));
  const loadsOf = () => {
    let loads = 0;
    const load = () => {
      loads++;
      return Promise.resolve({ roles: [`r${loads}`] });
    };
    return { load, count: () => loads };
  };

  it('loads a user grants once, then serves them from memory', async () => {
    const { load, count } = loadsOf();
    expect(await service.localUserGrants('u1', load)).toEqual({
      roles: ['r1'],
    });
    expect(await service.localUserGrants('u1', load)).toEqual({
      roles: ['r1'],
    });
    expect(count()).toBe(1);
  });

  it('drops a user when the database announces a change to them', async () => {
    await grantsOf('u1', ['old']);
    await grantsOf('u2', ['other']);
    bus.emit({ t: 'users', ids: ['u1'] });
    expect(await grantsOf('u1', ['new'])).toEqual({ roles: ['new'] });
    expect(await grantsOf('u2', ['changed'])).toEqual({ roles: ['other'] });
  });

  it('drops every user grants on a realm-wide change, and keeps profiles', async () => {
    await grantsOf('u1', ['old']);
    await service.localUser('u1', () => Promise.resolve({ name: 'a' }));
    bus.emit({ t: 'grants' });
    expect(await grantsOf('u1', ['new'])).toEqual({ roles: ['new'] });
    expect(
      await service.localUser('u1', () => Promise.resolve({ name: 'b' })),
    ).toEqual({ name: 'a' });
  });

  it('drops grants when a client is renamed, not when it is only updated', async () => {
    await grantsOf('u1', ['old']);
    bus.emit({ t: 'client', realmId: 'r', id: 'c', clientIds: ['app', 'app'] });
    expect(await grantsOf('u1', ['new'])).toEqual({ roles: ['old'] });
    bus.emit({
      t: 'client',
      realmId: 'r',
      id: 'c',
      clientIds: ['app', 'app2'],
    });
    expect(await grantsOf('u1', ['new'])).toEqual({ roles: ['new'] });
  });

  it('keys scope mappers by realm and by the set of scopes, in any order', async () => {
    const { load, count } = loadsOf();
    await service.localScopeMappers('r1', ['openid', 'email'], load);
    await service.localScopeMappers('r1', ['email', 'openid'], load);
    expect(count()).toBe(1);
    await service.localScopeMappers('r2', ['openid', 'email'], load);
    expect(count()).toBe(2);
    bus.emit({ t: 'scopes' });
    await service.localScopeMappers('r1', ['openid', 'email'], load);
    expect(count()).toBe(3);
  });

  it('does not keep a user that was not found', async () => {
    const load = jest.fn().mockResolvedValue(null);
    expect(await service.localUser('ghost', load)).toBeNull();
    expect(await service.localUser('ghost', load)).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not keep what was read while a change to it arrived', async () => {
    let finish!: (v: { roles: string[] }) => void;
    const slow = service.localUserGrants(
      'u1',
      () => new Promise((resolve) => (finish = resolve)),
    );
    bus.emit({ t: 'users', ids: ['u1'] });
    finish({ roles: ['stale'] });
    expect(await slow).toEqual({ roles: ['stale'] });
    expect(await grantsOf('u1', ['fresh'])).toEqual({ roles: ['fresh'] });
  });

  it('reads the database every time while the announcement channel is down', async () => {
    bus.connected = false;
    const { load, count } = loadsOf();
    await service.localUserGrants('u1', load);
    await service.localUserGrants('u1', load);
    expect(count()).toBe(2);
  });
});

describe('CacheService sessions', () => {
  let service: CacheService;
  let bus: ReturnType<typeof makeMockBus>;

  beforeEach(async () => {
    bus = makeMockBus(true);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheService,
        { provide: RedisService, useValue: makeMockRedis(false) },
        { provide: MetricsService, useValue: makeMockMetrics() },
        { provide: CacheBusService, useValue: bus },
      ],
    }).compile();
    service = module.get<CacheService>(CacheService);
  });

  it('keeps an existing session until the database says it ended', async () => {
    const load = jest.fn().mockResolvedValue({ id: 's1' });
    await service.localSession('s1', load);
    await service.localSession('s1', load);
    expect(load).toHaveBeenCalledTimes(1);
    bus.emit({ t: 'sessions', ids: ['s1'] });
    load.mockResolvedValue(null);
    expect(await service.localSession('s1', load)).toBeNull();
  });

  it('forgets every session when too many ended to list', async () => {
    const load = jest.fn().mockResolvedValue({ id: 's' });
    await service.localSession('a', load);
    await service.localSession('b', load);
    bus.emit({ t: 'sessions-all' });
    await service.localSession('a', load);
    await service.localSession('b', load);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('never remembers a session that was not there', async () => {
    const load = jest.fn().mockResolvedValue(null);
    await service.localSession('gone', load);
    await service.localSession('gone', load);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
