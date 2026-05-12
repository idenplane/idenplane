import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import type { RateLimitResult } from './rate-limit.dto.js';

const RL_PREFIX = 'rl:';

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async checkClientLimit(
    clientId: string,
    realmId: string,
  ): Promise<RateLimitResult> {
    const realm = await this.prisma.realm.findUnique({
      where: { id: realmId },
      select: {
        rateLimitEnabled: true,
        clientRateLimitPerMinute: true,
        clientRateLimitPerHour: true,
      },
    });

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
    const realm = await this.prisma.realm.findUnique({
      where: { id: realmId },
      select: {
        rateLimitEnabled: true,
        userRateLimitPerMinute: true,
        userRateLimitPerHour: true,
      },
    });

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
    const ADMIN_LIMIT_PER_MINUTE = 5;
    const ADMIN_LIMIT_PER_HOUR = 50;
    return this.check(
      `admin:ip:${ip}`,
      ADMIN_LIMIT_PER_MINUTE,
      ADMIN_LIMIT_PER_HOUR,
    );
  }

  async checkAdminApiKeyLimit(ip: string): Promise<RateLimitResult> {
    const ADMIN_API_KEY_LIMIT_PER_MINUTE = 15;
    const ADMIN_API_KEY_LIMIT_PER_HOUR = 100;
    return this.check(
      `admin:apikey:${ip}`,
      ADMIN_API_KEY_LIMIT_PER_MINUTE,
      ADMIN_API_KEY_LIMIT_PER_HOUR,
    );
  }

  async checkIpLimit(ip: string, realmId: string): Promise<RateLimitResult> {
    const realm = await this.prisma.realm.findUnique({
      where: { id: realmId },
      select: {
        rateLimitEnabled: true,
        ipRateLimitPerMinute: true,
        ipRateLimitPerHour: true,
      },
    });

    if (!realm || !realm.rateLimitEnabled) {
      return { allowed: true, limit: 0, remaining: 0, resetAt: 0 };
    }

    return this.check(
      `ip:${realmId}:${ip}`,
      realm.ipRateLimitPerMinute,
      realm.ipRateLimitPerHour,
    );
  }

  computeHeaders(result: RateLimitResult): Record<string, string> {
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
   * Database-based rate limiting fallback (cluster-safe).
   * Uses a dedicated table with a single upsert to atomically increment counters.
   * Works across all instances without Redis.
   */
  private async checkWithDatabase(
    key: string,
    limitPerMinute: number,
    limitPerHour: number,
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const minuteWindowMs = 60_000;
    const hourWindowMs = 3_600_000;

    const entry = await this.prisma.rateLimitEntry.upsert({
      where: { key },
      create: {
        key,
        minuteCount: 1,
        minuteWindowStart: new Date(now),
        hourCount: 1,
        hourWindowStart: new Date(now),
      },
      update: {
        minuteCount: { increment: 1 },
        hourCount: { increment: 1 },
      },
    });

    const entryMinuteWindowStart = entry.minuteWindowStart.getTime();
    const entryHourWindowStart = entry.hourWindowStart.getTime();

    let minuteCount = entry.minuteCount;
    let hourCount = entry.hourCount;

    if (now - entryMinuteWindowStart >= minuteWindowMs) {
      await this.prisma.rateLimitEntry.update({
        where: { key },
        data: {
          minuteCount: 1,
          minuteWindowStart: new Date(now),
        },
      });
      minuteCount = 1;
    }

    if (now - entryHourWindowStart >= hourWindowMs) {
      await this.prisma.rateLimitEntry.update({
        where: { key },
        data: {
          hourCount: 1,
          hourWindowStart: new Date(now),
        },
      });
      hourCount = 1;
    }

    const minuteResetAt = Math.ceil(
      (Math.max(entryMinuteWindowStart, now) + minuteWindowMs) / 1000,
    );
    const hourResetAt = Math.ceil(
      (Math.max(entryHourWindowStart, now) + hourWindowMs) / 1000,
    );

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
