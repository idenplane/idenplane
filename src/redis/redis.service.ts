import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis, { type RedisOptions } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private _available = false;

  onModuleInit() {
    const redisUrl = process.env['REDIS_URL'];
    if (!redisUrl) {
      this.logger.log('REDIS_URL not set — Redis cache disabled');
      return;
    }

    const sentinelHosts = process.env['REDIS_SENTINEL_HOSTS'];
    const sentinelName = process.env['REDIS_SENTINEL_NAME'] ?? 'mymaster';

    let options: RedisOptions;

    if (sentinelHosts) {
      const sentinels = sentinelHosts.split(',').map((h) => {
        const [host, portStr] = h.trim().split(':');
        return { host, port: parseInt(portStr ?? '26379', 10) };
      });
      options = {
        sentinels,
        name: sentinelName,
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 3,
      };
      this.logger.log(
        `Connecting to Redis Sentinel (${sentinels.length} hosts, name: ${sentinelName})`,
      );
    } else {
      options = {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 3,
        retryStrategy: (times: number) => {
          if (times > 10) {
            this.logger.warn(
              'Redis: max reconnect attempts reached, giving up',
            );
            return null;
          }
          const delay = Math.min(times * 100, 3000);
          return delay;
        },
      };
      this.logger.log(`Connecting to Redis at ${redisUrl}`);
    }

    this.client = sentinelHosts
      ? new Redis(options)
      : new Redis(redisUrl, options);

    this.client.on('connect', () => {
      this._available = true;
      this.logger.log('Redis connected');
    });

    this.client.on('ready', () => {
      this._available = true;
    });

    this.client.on('error', (err: Error) => {
      this._available = false;
      this.logger.warn(`Redis error: ${err.message}`);
    });

    this.client.on('close', () => {
      this._available = false;
    });

    this.client.on('reconnecting', () => {
      this.logger.debug('Redis reconnecting...');
    });

    // Eagerly connect but don't throw if it fails
    this.client.connect().catch((err: Error) => {
      this.logger.warn(`Redis initial connection failed: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit().catch(() => {});
      this.client = null;
    }
  }

  isAvailable(): boolean {
    return this._available && this.client !== null;
  }

  async get(key: string): Promise<string | null> {
    if (!this.isAvailable()) return null;
    return this.client!.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (!this.isAvailable()) return;
    await this.client!.set(key, value, 'EX', ttlSeconds);
  }

  async del(key: string): Promise<void> {
    if (!this.isAvailable()) return;
    await this.client!.del(key);
  }

  async exists(key: string): Promise<boolean> {
    if (!this.isAvailable()) return false;
    const count = await this.client!.exists(key);
    return count > 0;
  }

  /**
   * Atomically increment a key by 1 and set TTL if the key is new.
   * Uses native Redis INCR (atomic, no race condition).
   * Returns the new count after increment.
   */
  async incr(key: string, ttlSeconds: number): Promise<number> {
    if (!this.isAvailable()) return 0;
    const count = await this.client!.incr(key);
    // Set TTL only on the first increment (when count becomes 1)
    if (count === 1) {
      await this.client!.expire(key, ttlSeconds);
    }
    return count;
  }

  /**
   * Atomically decrement a key by 1. Used to undo a rejected request's INCR so
   * throttled retries do not keep inflating the rate-limit counter.
   */
  async decr(key: string): Promise<number> {
    if (!this.isAvailable()) return 0;
    return this.client!.decr(key);
  }

  /** Delete all keys matching a glob pattern (uses SCAN to avoid blocking). */
  async delPattern(pattern: string): Promise<void> {
    if (!this.isAvailable()) return;
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.client!.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        await this.client!.del(...keys);
      }
    } while (cursor !== '0');
  }

  /** Ping Redis. Returns true on success. */
  async ping(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      const result = await this.client!.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * Get the raw Redis client for advanced operations.
   * Returns null if Redis is unavailable.
   */
  getClient(): Redis | null {
    if (!this.client || !this._available) {
      return null;
    }
    return this.client;
  }

  // ─── Atomic Set (SADD / SREM / SMEMBERS / EXPIRE) ───────────

  /**
   * Atomically add one or more members to a Redis Set.
   * Safe for concurrent callers — no read-modify-write needed.
   */
  async sadd(key: string, ...members: string[]): Promise<void> {
    if (!this.isAvailable()) return;
    await this.client!.sadd(key, ...members);
  }

  /**
   * Remove one or more members from a Redis Set.
   * No-ops silently if the member is not present.
   */
  async srem(key: string, ...members: string[]): Promise<void> {
    if (!this.isAvailable()) return;
    await this.client!.srem(key, ...members);
  }

  /**
   * Return all members of a Redis Set, or an empty array if the key
   * does not exist or Redis is unavailable.
   */
  async smembers(key: string): Promise<string[]> {
    if (!this.isAvailable()) return [];
    return this.client!.smembers(key);
  }

  /**
   * Set the TTL (in seconds) on an existing key.
   * Used to refresh expiry after a SADD without overwriting the value.
   */
  async expire(key: string, ttlSeconds: number): Promise<void> {
    if (!this.isAvailable()) return;
    await this.client!.expire(key, ttlSeconds);
  }
}
