import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service.js';

export interface RedisSessionData {
  id: string;
  userId: string;
  realmId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
  expiresAt: string;
  [key: string]: unknown;
}

const SESSION_KEY = (sessionId: string) => `session:${sessionId}`;
const USER_SESSIONS_KEY = (realmId: string, userId: string) =>
  `sessions:${realmId}:${userId}`;

/**
 * Redis-backed session store.
 *
 * When `SESSION_STORE=redis` and Redis is available, sessions are persisted
 * to Redis instead of (or in addition to) PostgreSQL. Each session is stored
 * as a JSON string with an expiry matching the session's `expiresAt` field.
 *
 * Falls back gracefully — if Redis is unavailable the caller should continue
 * to use the database session path.
 *
 * ### Race-condition fix (Issue #369)
 *
 * The previous implementation maintained the per-user session index as a
 * JSON-encoded array stored in a plain Redis string key. Every `set()` call
 * issued a GET, modified the array in application memory, then issued a SET —
 * a classic read-modify-write pattern. Two concurrent logins for the same
 * user could both read the same stale list and whichever writer finished last
 * would silently discard the other session id, causing that session to become
 * unreachable via `getUserSessions()`.
 *
 * The fix replaces the JSON-array approach with a Redis **Set** key whose
 * members are individual session ids. Redis Set commands (SADD, SREM,
 * SMEMBERS) are each a single atomic operation that the Redis server
 * serialises — no application-level read-modify-write is ever needed, and
 * concurrent callers can never clobber each other's entries.
 */
@Injectable()
export class RedisSessionService {
  private readonly logger = new Logger(RedisSessionService.name);
  private readonly enabled: boolean;

  constructor(private readonly redis: RedisService) {
    this.enabled = (process.env['SESSION_STORE'] ?? 'database') === 'redis';
    if (this.enabled) {
      this.logger.log('Redis session store enabled (SESSION_STORE=redis)');
    }
  }

  /** Returns true when the Redis session store is active and connected. */
  isActive(): boolean {
    return this.enabled && this.redis.isAvailable();
  }

  async set(session: RedisSessionData): Promise<void> {
    if (!this.isActive()) return;

    const expiresAt = new Date(session.expiresAt);
    const ttl = Math.max(
      1,
      Math.floor((expiresAt.getTime() - Date.now()) / 1000),
    );

    // Persist the session payload as a JSON string with TTL.
    await this.redis.set(SESSION_KEY(session.id), JSON.stringify(session), ttl);

    // ── Atomic index update ────────────────────────────────────────────────
    // SADD is a single atomic command: it adds the session id to the Set only
    // if it is not already present, without any read step.  Concurrent callers
    // never race because the Redis server serialises SADD operations.
    //
    // After SADD we refresh the TTL with EXPIRE so the index does not outlive
    // all of its member sessions.  Using the maximum plausible TTL (same as the
    // session being written) is a safe conservative choice: stale ids left in
    // the set after a session expires are filtered out in getUserSessions().
    const setKey = USER_SESSIONS_KEY(session.realmId, session.userId);
    try {
      await this.redis.sadd(setKey, session.id);
      await this.redis.expire(setKey, ttl);
    } catch (err: unknown) {
      this.logger.warn(
        `Could not update session index for user ${session.userId}: ${(err as Error).message}`,
      );
    }
  }

  async get(sessionId: string): Promise<RedisSessionData | null> {
    if (!this.isActive()) return null;

    const raw = await this.redis.get(SESSION_KEY(sessionId));
    if (!raw) return null;

    try {
      const data = JSON.parse(raw) as RedisSessionData;
      if (new Date(data.expiresAt) <= new Date()) {
        await this.delete(sessionId);
        return null;
      }
      return data;
    } catch (err) {
      this.logger.warn(
        `Failed to parse session ${sessionId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  async delete(sessionId: string): Promise<void> {
    if (!this.isActive()) return;
    await this.redis.del(SESSION_KEY(sessionId));
  }

  async getUserSessions(
    realmId: string,
    userId: string,
  ): Promise<RedisSessionData[]> {
    if (!this.isActive()) return [];

    // SMEMBERS is a single atomic read — no race possible.
    const setKey = USER_SESSIONS_KEY(realmId, userId);
    const ids = await this.redis.smembers(setKey);
    if (ids.length === 0) return [];

    const sessions = await Promise.all(ids.map((id) => this.get(id)));
    return sessions.filter((s): s is RedisSessionData => s !== null);
  }

  async deleteAllUserSessions(realmId: string, userId: string): Promise<void> {
    if (!this.isActive()) return;

    const setKey = USER_SESSIONS_KEY(realmId, userId);
    // SMEMBERS is atomic; deletions are best-effort and can overlap safely.
    const ids = await this.redis.smembers(setKey);
    await Promise.all(ids.map((id) => this.redis.del(SESSION_KEY(id))));
    await this.redis.del(setKey);
  }
}
