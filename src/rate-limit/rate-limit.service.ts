import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { CacheService } from '../cache/cache.service.js';
import type { Realm } from '@prisma/client';
import type { RateLimitResult } from './rate-limit.dto.js';

const RL_PREFIX = 'rl:';
/** Failure budgets share the counters, under their own key space. */
const FAILURE_PREFIX = 'fail:';
/** The database-backed counter has a one-statement form on PostgreSQL. */
const isPostgres = () =>
  /^postgres(ql)?:\/\//i.test(process.env['DATABASE_URL'] ?? '');

interface CounterRow {
  minuteCount: number;
  minuteWindowStart: Date;
  hourCount: number;
  hourWindowStart: Date;
}

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly cache: CacheService,
  ) {}

  /**
   * The realm's rate-limit settings, from the realm cache that every guarded
   * request already warms (RealmGuard), instead of one query per check.
   */
  private async realmSettings(realmId: string): Promise<Realm | null> {
    const cached = await this.cache.getCachedRealmConfig<Realm>(realmId);
    if (cached) return cached;
    const realm = await this.prisma.realm.findUnique({
      where: { id: realmId },
    });
    if (realm) await this.cache.cacheRealmConfig(realmId, realm);
    return realm;
  }

  async checkClientLimit(
    clientId: string,
    realmId: string,
  ): Promise<RateLimitResult> {
    const realm = await this.realmSettings(realmId);

    if (!realm || !realm.rateLimitEnabled) {
      return { allowed: true, limit: 0, remaining: 0, resetAt: 0 };
    }

    return this.check(
      `client:${realmId}:${clientId}`,
      realm.clientRateLimitPerMinute,
      realm.clientRateLimitPerHour,
    );
  }

  async checkUserLimit(
    userId: string,
    realmId: string,
  ): Promise<RateLimitResult> {
    const realm = await this.realmSettings(realmId);

    if (!realm || !realm.rateLimitEnabled) {
      return { allowed: true, limit: 0, remaining: 0, resetAt: 0 };
    }

    return this.check(
      `user:${realmId}:${userId}`,
      realm.userRateLimitPerMinute,
      realm.userRateLimitPerHour,
    );
  }

  /**
   * IP-based rate limit for the admin login endpoint.
   * Uses fixed conservative limits (5 req/min, 50 req/hour) with a
   * dedicated key namespace — no realm DB lookup required.
   */
  async checkAdminIpLimit(ip: string): Promise<RateLimitResult> {
    // Production defaults preserved (5/min, 50/hour); overridable via env so
    // test/CI harnesses are not throttled. Non-numeric/absent env => default.
    const perMinute = this.envInt('ADMIN_IP_RL_PER_MINUTE', 5);
    const perHour = this.envInt('ADMIN_IP_RL_PER_HOUR', 50);
    return this.check(`admin:ip:${ip}`, perMinute, perHour);
  }

  async checkAdminApiKeyLimit(ip: string): Promise<RateLimitResult> {
    // Defaults sized for real admin-console use: the console authenticates with
    // an admin API key and a single page (e.g. the realm overview) legitimately
    // issues a burst of parallel requests. The previous 15/min default throttled
    // the console into 429 cascades on a normal page load. 60/min + 1000/hour
    // still bounds brute-force/abuse while leaving headroom for interactive use.
    // Overridable via env so test/CI harnesses are not throttled; non-numeric or
    // absent env => default.
    const perMinute = this.envInt('ADMIN_API_KEY_RL_PER_MINUTE', 60);
    const perHour = this.envInt('ADMIN_API_KEY_RL_PER_HOUR', 1000);
    return this.check(`admin:apikey:${ip}`, perMinute, perHour);
  }

  private envInt(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined) return fallback;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  async checkIpLimit(ip: string, realmId: string): Promise<RateLimitResult> {
    const realm = await this.realmSettings(realmId);

    if (!realm || !realm.rateLimitEnabled) {
      return { allowed: true, limit: 0, remaining: 0, resetAt: 0 };
    }

    return this.check(
      `ip:${realmId}:${ip}`,
      realm.ipRateLimitPerMinute,
      realm.ipRateLimitPerHour,
    );
  }

  /**
   * A failure budget: whether `key` has already had `limitPerMinute`
   * failures in the current minute window. Unlike the request limits it
   * counts nothing itself; call {@link recordFailure} when an attempt fails.
   * Shared across instances through Redis, or the database without it.
   */
  async failureBudget(
    key: string,
    limitPerMinute: number,
  ): Promise<{ exhausted: boolean; retryAfter: number }> {
    const now = Date.now();
    const nowSeconds = Math.floor(now / 1000);
    if (this.redis.isAvailable()) {
      try {
        const minuteWindow = Math.floor(nowSeconds / 60);
        const raw = await this.redis.get(
          `${RL_PREFIX}m:${FAILURE_PREFIX}${key}:${minuteWindow}`,
        );
        const count = raw ? parseInt(raw, 10) : 0;
        return {
          exhausted: count >= limitPerMinute,
          retryAfter: Math.max(1, (minuteWindow + 1) * 60 - nowSeconds),
        };
      } catch (err) {
        this.logger.warn(
          `Redis failure-budget read failed, falling back to database: ${(err as Error).message}`,
        );
      }
    }
    const entry = await this.prisma.rateLimitEntry.findUnique({
      where: { key: `${FAILURE_PREFIX}${key}` },
      select: { minuteCount: true, minuteWindowStart: true },
    });
    const windowEnd = entry ? entry.minuteWindowStart.getTime() + 60_000 : 0;
    const count = entry && windowEnd > now ? entry.minuteCount : 0;
    return {
      exhausted: count >= limitPerMinute,
      retryAfter: Math.max(1, Math.ceil((windowEnd - now) / 1000)),
    };
  }

  /** Counts one failure against {@link failureBudget}. */
  async recordFailure(key: string): Promise<void> {
    if (this.redis.isAvailable()) {
      try {
        const minuteWindow = Math.floor(Date.now() / 60_000);
        await this.redis.incr(
          `${RL_PREFIX}m:${FAILURE_PREFIX}${key}:${minuteWindow}`,
          120,
        );
        return;
      } catch (err) {
        this.logger.warn(
          `Redis failure count failed, falling back to database: ${(err as Error).message}`,
        );
      }
    }
    const fullKey = `${FAILURE_PREFIX}${key}`;
    const at = new Date();
    if (isPostgres()) await this.countPostgres(fullKey, at);
    else await this.countPortable(fullKey, at);
  }

  computeHeaders(result: RateLimitResult): Record<string, string> {
    // When rate limiting is disabled the service returns limit=0, remaining=0,
    // resetAt=0.  Emitting headers with those sentinel values would mislead
    // clients into believing a limit is in effect.  Return an empty object so
    // the guard (and any caller) skips header injection entirely.
    if (result.limit === 0 && result.resetAt === 0) {
      return {};
    }

    const headers: Record<string, string> = {
      'X-RateLimit-Limit': String(result.limit),
      'X-RateLimit-Remaining': String(Math.max(0, result.remaining)),
      'X-RateLimit-Reset': String(result.resetAt),
    };

    if (!result.allowed && result.retryAfter !== undefined) {
      headers['Retry-After'] = String(result.retryAfter);
    }

    return headers;
  }

  private async check(
    key: string,
    limitPerMinute: number,
    limitPerHour: number,
  ): Promise<RateLimitResult> {
    // Use Redis when available for shared state across instances
    if (this.redis.isAvailable()) {
      try {
        return await this.checkWithRedis(key, limitPerMinute, limitPerHour);
      } catch (err) {
        this.logger.warn(
          `Redis rate limit check failed, falling back to database: ${(err as Error).message}`,
        );
      }
    }

    // Fallback to database (shared across instances) when Redis is unavailable
    return this.checkWithDatabase(key, limitPerMinute, limitPerHour);
  }

  /**
   * Redis-based rate limiting using simple INCR + EXPIRE (fixed window).
   * Shared across all instances.
   */
  private async checkWithRedis(
    key: string,
    limitPerMinute: number,
    limitPerHour: number,
  ): Promise<RateLimitResult> {
    const now = Math.floor(Date.now() / 1000);
    const minuteWindow = Math.floor(now / 60);
    const hourWindow = Math.floor(now / 3600);

    const minuteKey = `${RL_PREFIX}m:${key}:${minuteWindow}`;
    const hourKey = `${RL_PREFIX}h:${key}:${hourWindow}`;

    // Increment both counters atomically
    const minuteCountStr = await this.redisIncr(minuteKey, 120); // 2 min TTL for minute window
    const hourCountStr = await this.redisIncr(hourKey, 7200); // 2 hour TTL for hour window

    const minuteCount = parseInt(minuteCountStr, 10);
    const hourCount = parseInt(hourCountStr, 10);

    const minuteResetAt = (minuteWindow + 1) * 60;
    const hourResetAt = (hourWindow + 1) * 3600;

    // Don't count rejected requests: undo this request's increments so a retry
    // storm cannot keep inflating the counter and extend the lockout window.
    if (minuteCount > limitPerMinute || hourCount > limitPerHour) {
      await this.redis.decr(minuteKey).catch(() => undefined);
      await this.redis.decr(hourKey).catch(() => undefined);
    }

    // Check minute limit
    if (minuteCount > limitPerMinute) {
      const retryAfter = minuteResetAt - now;
      return {
        allowed: false,
        limit: limitPerMinute,
        remaining: 0,
        resetAt: minuteResetAt,
        retryAfter: Math.max(1, retryAfter),
      };
    }

    // Check hour limit
    if (hourCount > limitPerHour) {
      const retryAfter = hourResetAt - now;
      return {
        allowed: false,
        limit: limitPerHour,
        remaining: 0,
        resetAt: hourResetAt,
        retryAfter: Math.max(1, retryAfter),
      };
    }

    return {
      allowed: true,
      limit: limitPerMinute,
      remaining: limitPerMinute - minuteCount,
      resetAt: minuteResetAt,
    };
  }

  /**
   * Atomically increment a Redis key using native INCR (no TOCTOU race).
   */
  private async redisIncr(key: string, ttl: number): Promise<string> {
    const count = await this.redis.incr(key, ttl);
    return String(count);
  }

  /**
   * Database-based rate limiting (shared across instances, no Redis).
   *
   * One atomic step per request counts it and, when a window has run out,
   * starts a new one. On PostgreSQL that is a single statement. Elsewhere
   * each window is first restarted by a conditional update that only one
   * concurrent request can win, then counted; either way no request
   * counted in the new window can be wiped by another one's restart.
   */
  private async checkWithDatabase(
    key: string,
    limitPerMinute: number,
    limitPerHour: number,
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const minuteWindowMs = 60_000;
    const hourWindowMs = 3_600_000;

    const entry = isPostgres()
      ? await this.countPostgres(key, new Date(now))
      : await this.countPortable(key, new Date(now));

    const { minuteCount, hourCount, minuteWindowStart, hourWindowStart } =
      entry;
    const minuteResetAt = Math.ceil(
      (minuteWindowStart.getTime() + minuteWindowMs) / 1000,
    );
    const hourResetAt = Math.ceil(
      (hourWindowStart.getTime() + hourWindowMs) / 1000,
    );

    // Don't count rejected requests: undo this request's increment so a retry
    // storm cannot keep inflating the counter and extend the lockout window.
    if (minuteCount > limitPerMinute || hourCount > limitPerHour) {
      // Only in the windows this request was counted in: if another
      // request has since started new ones, there is nothing to undo.
      await this.prisma.rateLimitEntry
        .updateMany({
          where: { key, minuteWindowStart, hourWindowStart },
          data: { minuteCount: { decrement: 1 }, hourCount: { decrement: 1 } },
        })
        .catch(() => {});
    }

    if (minuteCount > limitPerMinute) {
      const retryAfter = minuteResetAt - Math.floor(now / 1000);
      return {
        allowed: false,
        limit: limitPerMinute,
        remaining: 0,
        resetAt: minuteResetAt,
        retryAfter: Math.max(1, retryAfter),
      };
    }

    if (hourCount > limitPerHour) {
      const retryAfter = hourResetAt - Math.floor(now / 1000);
      return {
        allowed: false,
        limit: limitPerHour,
        remaining: 0,
        resetAt: hourResetAt,
        retryAfter: Math.max(1, retryAfter),
      };
    }

    return {
      allowed: true,
      limit: limitPerMinute,
      remaining: Math.max(0, limitPerMinute - minuteCount),
      resetAt: minuteResetAt,
    };
  }

  /** Counts one request, restarting expired windows, in one statement. */
  private async countPostgres(key: string, at: Date): Promise<CounterRow> {
    const now = at.toISOString();
    const rows = await this.prisma.$queryRaw<CounterRow[]>`
      WITH t AS (SELECT (${now}::timestamptz AT TIME ZONE 'UTC') AS now)
      INSERT INTO rate_limit_entries AS e
        (id, key, minute_count, minute_window_start, hour_count, hour_window_start, updated_at)
      SELECT gen_random_uuid()::text, ${key}, 1, t.now, 1, t.now, t.now FROM t
      ON CONFLICT (key) DO UPDATE SET
        minute_count = CASE WHEN e.minute_window_start <= EXCLUDED.updated_at - interval '1 minute'
                            THEN 1 ELSE e.minute_count + 1 END,
        minute_window_start = CASE WHEN e.minute_window_start <= EXCLUDED.updated_at - interval '1 minute'
                                   THEN EXCLUDED.updated_at ELSE e.minute_window_start END,
        hour_count = CASE WHEN e.hour_window_start <= EXCLUDED.updated_at - interval '1 hour'
                          THEN 1 ELSE e.hour_count + 1 END,
        hour_window_start = CASE WHEN e.hour_window_start <= EXCLUDED.updated_at - interval '1 hour'
                                 THEN EXCLUDED.updated_at ELSE e.hour_window_start END,
        updated_at = EXCLUDED.updated_at
      RETURNING minute_count AS "minuteCount", minute_window_start AS "minuteWindowStart",
                hour_count AS "hourCount", hour_window_start AS "hourWindowStart"
    `;
    return rows[0];
  }

  /**
   * The same on databases without that statement: restart each expired
   * window with a conditional update (the window start is in the
   * condition, so of concurrent requests only one restarts it), then count.
   */
  private async countPortable(key: string, at: Date): Promise<CounterRow> {
    await this.prisma.rateLimitEntry.updateMany({
      where: {
        key,
        minuteWindowStart: { lte: new Date(at.getTime() - 60_000) },
      },
      data: { minuteCount: 0, minuteWindowStart: at },
    });
    await this.prisma.rateLimitEntry.updateMany({
      where: {
        key,
        hourWindowStart: { lte: new Date(at.getTime() - 3_600_000) },
      },
      data: { hourCount: 0, hourWindowStart: at },
    });
    return this.prisma.rateLimitEntry.upsert({
      where: { key },
      create: {
        key,
        minuteCount: 1,
        minuteWindowStart: at,
        hourCount: 1,
        hourWindowStart: at,
      },
      update: {
        minuteCount: { increment: 1 },
        hourCount: { increment: 1 },
      },
    });
  }

  @Interval(600_000)
  async cleanupExpiredDbEntries(): Promise<void> {
    try {
      const hourAgo = new Date(Date.now() - 3_600_000);
      const result = await this.prisma.rateLimitEntry.deleteMany({
        where: {
          OR: [
            { minuteWindowStart: { lt: hourAgo } },
            { hourWindowStart: { lt: hourAgo } },
          ],
        },
      });
      if (result.count > 0) {
        this.logger.debug(
          `Cleaned up ${result.count} expired rate limit DB entries`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Failed to cleanup expired rate limit entries: ${(err as Error).message}`,
      );
    }
  }
}
