import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { RedisService } from '../redis/redis.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const BLACKLIST_PREFIX = 'token:blacklist:';

@Injectable()
export class TokenBlacklistService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TokenBlacklistService.name);
  /** In-memory fallback used only when Redis is unavailable. */
  private readonly memoryFallback = new Map<string, number>();
  private cleanupInterval: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    // Periodically clean up expired tokens from DB and memory fallback
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);

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

    // 3. Check database as last resort
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
