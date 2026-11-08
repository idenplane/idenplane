import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { CacheBusService, type CacheEvent } from './cache-bus.service.js';

const KEY = {
  realm: (realmId: string) => `realm:config:${realmId}`,
  realmByName: (name: string) => `realm:name:${name}`,
  client: (clientId: string) => `client:config:${clientId}`,
  jwks: (realmId: string) => `realm:jwks:${realmId}`,
  corsOrigins: 'cors:allowed-origins',
} as const;

/** Bound on the in-process cache; realm names and client ids come from callers. */
const L1_MAX_ENTRIES = 10_000;

interface L1Entry {
  value: unknown;
  expiresAt: number;
}

/**
 * Realm, client, JWKS and CORS lookups, in two levels:
 *
 * 1. **In-process** (L1), in every process, on by default. Entries are
 *    dropped the moment the database announces that the row behind them
 *    changed (CacheBusService), whichever process or tool changed it. While
 *    that announcement channel is down the L1 is not used at all, and it
 *    starts empty again once the channel is back, so it can never serve a
 *    row the database has since changed for longer than a notification
 *    takes to arrive. The TTLs below are only a backstop.
 * 2. **Redis**, when configured: shared by replicas and kept across
 *    restarts. The same announcements delete its keys too.
 *
 * Values are copied in and out of the L1 (`structuredClone`, which keeps
 * Dates), so no caller can change what another one reads.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly l1 = new Map<string, L1Entry>();
  /**
   * Fill-race guard. A reader that missed, then read the database, must not
   * store its row if an invalidation arrived in between (its row may be the
   * one that was just replaced). Every invalidation bumps `epoch`; a fill is
   * kept only if the epoch is still the one recorded at the miss.
   */
  private epoch = 0;
  private readonly missEpoch = new Map<string, number>();

  constructor(
    private readonly redis: RedisService,
    private readonly metrics: MetricsService,
    private readonly bus: CacheBusService,
  ) {
    bus.onEvent((event) => void this.onEvent(event));
    bus.onReset(() => this.flushL1());
  }

  // ─── Realm ───────────────────────────────────────────────────────────────

  async cacheRealmConfig(
    realmId: string,
    config: object,
    ttl = 300,
  ): Promise<void> {
    await this.set(KEY.realm(realmId), config, ttl);
  }

  async getCachedRealmConfig<T = unknown>(realmId: string): Promise<T | null> {
    return this.getJson<T>(KEY.realm(realmId), 'realm_config');
  }

  async cacheRealmByName(
    name: string,
    config: object,
    ttl = 300,
  ): Promise<void> {
    await this.set(KEY.realmByName(name), config, ttl);
  }

  async getCachedRealmByName<T = unknown>(name: string): Promise<T | null> {
    return this.getJson<T>(KEY.realmByName(name), 'realm_by_name');
  }

  async invalidateRealmCache(
    realmId: string,
    realmName?: string,
  ): Promise<void> {
    await this.drop([
      KEY.realm(realmId),
      KEY.jwks(realmId),
      ...(realmName ? [KEY.realmByName(realmName)] : []),
    ]);
    this.logger.debug(`Invalidated cache for realm ${realmId}`);
  }

  // ─── Client ──────────────────────────────────────────────────────────────

  /** `clientId` is the cache key `${realmId}:${clientId}`. */
  async cacheClientConfig(
    clientId: string,
    config: object,
    ttl = 60,
  ): Promise<void> {
    await this.set(KEY.client(clientId), config, ttl);
  }

  async getCachedClientConfig<T = unknown>(
    clientId: string,
  ): Promise<T | null> {
    return this.getJson<T>(KEY.client(clientId), 'client_config');
  }

  async invalidateClientCache(clientId: string): Promise<void> {
    await this.drop([KEY.client(clientId)]);
    this.logger.debug(`Invalidated cache for client ${clientId}`);
  }

  // ─── JWKS ────────────────────────────────────────────────────────────────

  async cacheJWKS(realmId: string, jwks: object, ttl = 600): Promise<void> {
    await this.set(KEY.jwks(realmId), jwks, ttl);
  }

  async getCachedJWKS<T = unknown>(realmId: string): Promise<T | null> {
    return this.getJson<T>(KEY.jwks(realmId), 'jwks');
  }

  // ─── CORS allowed origins ────────────────────────────────────────────────

  /**
   * Persist the full set of allowed CORS origins to Redis. (The in-process
   * set lives in CorsOriginService, which reloads it on client changes.)
   */
  async cacheCorsOrigins(origins: string[], ttl = 300): Promise<void> {
    if (!this.redis.isAvailable()) return;
    await this.redis.set(KEY.corsOrigins, JSON.stringify(origins), ttl);
  }

  /** The Redis copy of the allowed CORS origins, or null. */
  async getCachedCorsOrigins(): Promise<string[] | null> {
    if (!this.redis.isAvailable()) return null;
    const value = this.parse<string[]>(
      KEY.corsOrigins,
      await this.redis.get(KEY.corsOrigins),
    );
    this.metrics.cacheOperationsTotal.inc({
      operation: value !== null ? 'hit' : 'miss',
      cache: 'cors_origins',
    });
    return value;
  }

  /** Remove the CORS origins cache entry so the next request re-fetches from the DB. */
  async invalidateCorsOrigins(): Promise<void> {
    if (!this.redis.isAvailable()) return;
    await this.redis.del(KEY.corsOrigins);
    this.logger.debug('Invalidated CORS allowed-origins cache');
  }

  // ─── Database announcements ──────────────────────────────────────────────

  private async onEvent(event: CacheEvent): Promise<void> {
    switch (event.t) {
      case 'realm':
        await this.drop([
          KEY.realm(event.id),
          KEY.jwks(event.id),
          ...event.names.map((n) => KEY.realmByName(n)),
        ]);
        break;
      case 'client':
        await this.drop([
          ...event.clientIds.map((c) => KEY.client(`${event.realmId}:${c}`)),
          KEY.client(`${event.realmId}:${event.id}`),
          KEY.corsOrigins,
        ]);
        break;
      case 'keys':
        await this.drop([KEY.jwks(event.realmId)]);
        break;
    }
  }

  // ─── Internal helpers ────────────────────────────────────────────────────

  private flushL1(): void {
    this.l1.clear();
    this.missEpoch.clear();
    this.epoch++;
  }

  /** Drops keys from both levels. Redis errors are logged, never thrown. */
  private async drop(keys: string[]): Promise<void> {
    this.epoch++;
    for (const key of keys) this.l1.delete(key);
    if (!this.redis.isAvailable()) return;
    try {
      await Promise.all(keys.map((k) => this.redis.del(k)));
    } catch (err) {
      this.logger.warn(`Cache invalidation in Redis failed: ${String(err)}`);
    }
  }

  private async set(key: string, value: object, ttl: number): Promise<void> {
    this.l1Set(key, value, ttl);
    if (!this.redis.isAvailable()) return;
    await this.redis.set(key, JSON.stringify(value), ttl);
  }

  private l1Set(key: string, value: unknown, ttl: number): void {
    const recorded = this.missEpoch.get(key);
    this.missEpoch.delete(key);
    if (!this.bus.isConnected() || recorded !== this.epoch) return;
    if (this.l1.size >= L1_MAX_ENTRIES) {
      // Oldest first: a Map iterates in insertion order.
      const oldest = this.l1.keys().next().value;
      if (oldest !== undefined) this.l1.delete(oldest);
    }
    this.l1.set(key, {
      value: structuredClone(value),
      expiresAt: Date.now() + ttl * 1000,
    });
  }

  private async getJson<T>(
    key: string,
    metricLabel: string,
  ): Promise<T | null> {
    if (this.bus.isConnected()) {
      const entry = this.l1.get(key);
      if (entry && entry.expiresAt > Date.now()) {
        this.metrics.cacheOperationsTotal.inc({
          operation: 'hit',
          cache: metricLabel,
        });
        return structuredClone(entry.value) as T;
      }
      if (entry) this.l1.delete(key);
      // Recorded before any slower lookup, so an invalidation that arrives
      // while Redis or the database is being read keeps the result out.
      if (this.missEpoch.size >= L1_MAX_ENTRIES) {
        this.missEpoch.clear();
        this.epoch++;
      }
      this.missEpoch.set(key, this.epoch);
    }

    if (!this.redis.isAvailable()) {
      this.metrics.cacheOperationsTotal.inc({
        operation: 'miss',
        cache: metricLabel,
      });
      return null;
    }

    const raw = await this.redis.get(key);
    const value = this.parse<T>(key, raw);
    this.metrics.cacheOperationsTotal.inc({
      operation: value !== null ? 'hit' : 'miss',
      cache: metricLabel,
    });
    // A Redis hit fills the L1 too, under the same fill-race guard.
    if (value !== null) this.l1Set(key, value, 60);
    return value;
  }

  private parse<T>(key: string, raw: string | null): T | null {
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch (err) {
      this.logger.warn(
        `Failed to parse cached value for key ${key}: ${(err as Error).message}`,
      );
      return null;
    }
  }
}
