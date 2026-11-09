import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { RedisService } from '../redis/redis.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CacheBusService } from '../cache/cache-bus.service.js';

const BLACKLIST_PREFIX = 'token:blacklist:';
/**
 * Above this many unexpired revoked ids the in-process copy is not kept,
 * and lookups go to Redis and the database as they would without it.
 */
const MAX_LOCAL_REVOKED = 1_000_000;

@Injectable()
export class TokenBlacklistService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TokenBlacklistService.name);
  /** In-memory fallback used only when Redis is unavailable. */
  private readonly memoryFallback = new Map<string, number>();
  private cleanupInterval: ReturnType<typeof setInterval> | undefined;
  /**
   * Every unexpired revoked token id (jti → expiry, in seconds), copied
   * from the database and kept current by its announcements (CacheBusService).
   * Almost no token presented is revoked, so without it nearly every
   * introspection would end with a database query that finds nothing.
   *
   * It answers on its own only while it is complete: the copy has been
   * loaded since the announcement connection last (re)connected, and that
   * connection is still up. Announcements that arrive during the load are
   * added as they come, so nothing revoked in between is missed.
   */
  private readonly localRevoked = new Map<string, number>();
  private localComplete = false;
  private localGeneration = 0;

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    @Optional() private readonly bus?: CacheBusService,
  ) {
    bus?.onReset(() => this.reloadLocal());
    bus?.onEvent((event) => {
      if (event.t !== 'revoked') return;
      if (this.localRevoked.size >= MAX_LOCAL_REVOKED) {
        this.localComplete = false;
        return;
      }
      this.localRevoked.set(event.jti, event.exp);
    });
  }

  /** Starts a fresh copy of the revoked ids after a (re)connect. */
  private reloadLocal(): void {
    const generation = ++this.localGeneration;
    this.localComplete = false;
    this.localRevoked.clear();
    // A reset runs just before the connection is marked up; one that runs
    // because it went down leaves the copy incomplete until the next.
    setImmediate(() => {
      if (generation !== this.localGeneration || !this.bus?.isConnected()) {
        return;
      }
      void this.prisma.revokedToken
        .findMany({
          where: { expiresAt: { gt: new Date() } },
          select: { jti: true, expiresAt: true },
          take: MAX_LOCAL_REVOKED + 1,
        })
        .then((rows) => {
          if (generation !== this.localGeneration) return;
          if (rows.length > MAX_LOCAL_REVOKED) {
            this.logger.warn(
              'Too many revoked tokens to keep in memory; checking each in the database',
            );
            return;
          }
          for (const row of rows) {
            this.localRevoked.set(
              row.jti,
              Math.floor(row.expiresAt.getTime() / 1000),
            );
          }
          this.localComplete = true;
        })
        .catch((err: Error) => {
          this.logger.warn(
            `Could not load revoked tokens into memory: ${err.message}`,
          );
        });
    });
  }

  async onModuleInit() {
    // Periodically clean up expired tokens from DB and memory fallback
    this.cleanupInterval = setInterval(() => {
      void this.cleanup();
    }, 60_000);

    // On startup, load persisted revoked tokens into Redis (if Redis is up)
    await this.rehydrateFromDatabase();
  }

  onModuleDestroy() {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
  }

  async blacklistToken(jti: string, exp: number): Promise<void> {
    const ttl = exp - Math.floor(Date.now() / 1000);
    if (ttl <= 0) return; // Already expired, no need to blacklist

    // 1. Persist to database for durability across restarts
    try {
      await this.prisma.revokedToken.upsert({
        where: { jti },
        create: { jti, expiresAt: new Date(exp * 1000) },
        update: {},
      });
      // Seen here at once, before the database's announcement arrives.
      this.localRevoked.set(jti, exp);
    } catch (err) {
      this.logger.warn(
        `Failed to persist revoked token to DB: ${(err as Error).message}`,
      );
    }

    // 2. Store in Redis for fast cross-instance lookup
    if (this.redis.isAvailable()) {
      try {
        await this.redis.set(`${BLACKLIST_PREFIX}${jti}`, '1', ttl);
        return;
      } catch (err) {
        this.logger.warn(
          `Failed to blacklist token in Redis: ${(err as Error).message}`,
        );
      }
    }

    // 3. In-memory fallback
    this.memoryFallback.set(jti, exp);
  }

  async isBlacklisted(jti: string): Promise<boolean> {
    // 1. Check Redis first (fastest, shared across instances)
    if (this.redis.isAvailable()) {
      try {
        const exists = await this.redis.exists(`${BLACKLIST_PREFIX}${jti}`);
        if (exists) return true;
      } catch {
        // Fall through to other checks
      }
    }

    // 2. Check in-memory fallback
    if (this.memoryFallback.has(jti)) return true;

    // 3. The in-process copy of the database's list, when it is complete,
    //    answers for the database.
    if (this.localComplete && this.bus?.isConnected()) {
      return this.localRevoked.has(jti);
    }

    // 4. Check database as last resort
    try {
      const record = await this.prisma.revokedToken.findUnique({
        where: { jti },
      });
      if (record) {
        // Re-populate Redis/memory if found in DB
        const ttl =
          Math.floor(record.expiresAt.getTime() / 1000) -
          Math.floor(Date.now() / 1000);
        if (ttl > 0 && this.redis.isAvailable()) {
          await this.redis
            .set(`${BLACKLIST_PREFIX}${jti}`, '1', ttl)
            .catch(() => {});
        }
        return true;
      }
    } catch (err) {
      this.logger.warn(
        `Failed to check DB for revoked token: ${(err as Error).message}`,
      );
    }

    return false;
  }

  private async rehydrateFromDatabase(): Promise<void> {
    if (!this.redis.isAvailable()) return;
    try {
      const now = new Date();
      const tokens = await this.prisma.revokedToken.findMany({
        where: { expiresAt: { gt: now } },
      });
      for (const token of tokens) {
        const ttl =
          Math.floor(token.expiresAt.getTime() / 1000) -
          Math.floor(now.getTime() / 1000);
        if (ttl > 0) {
          await this.redis
            .set(`${BLACKLIST_PREFIX}${token.jti}`, '1', ttl)
            .catch(() => {});
        }
      }
      if (tokens.length > 0) {
        this.logger.log(
          `Rehydrated ${tokens.length} revoked tokens from database into Redis`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Failed to rehydrate blacklist from DB: ${(err as Error).message}`,
      );
    }
  }

  private async cleanup(): Promise<void> {
    // Clean memory fallback
    const now = Math.floor(Date.now() / 1000);
    for (const [jti, exp] of this.memoryFallback) {
      if (exp < now) this.memoryFallback.delete(jti);
    }
    for (const [jti, exp] of this.localRevoked) {
      if (exp < now) this.localRevoked.delete(jti);
    }

    // Clean expired entries from database
    try {
      const { count } = await this.prisma.revokedToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      if (count > 0) {
        this.logger.debug(
          `Cleaned up ${count} expired revoked tokens from database`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Failed to clean expired tokens from DB: ${(err as Error).message}`,
      );
    }
  }
}
