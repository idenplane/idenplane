import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CacheService } from '../cache/cache.service.js';
import { CacheBusService } from '../cache/cache-bus.service.js';

/**
 * CorsOriginService
 *
 * The set of origins the CORS middleware allows: every enabled client's
 * webOrigins. The middleware's origin callback is synchronous, so the set
 * lives in this process and is reloaded in the background, never emptied:
 *
 *  - loaded before the server accepts requests (`preloadCache`);
 *  - reloaded when the database announces any change to a client
 *    (CacheBusService), from whichever process or tool made it, and when that
 *    announcement channel reconnects;
 *  - reloaded when it is older than LOCAL_TTL_MS, a backstop for when the
 *    channel is down or off. The current set is served until the new one is
 *    ready.
 *
 * An earlier version let the set expire and never reloaded it, so five
 * minutes after boot, or right after any client edit, every client origin
 * was denied.
 */
@Injectable()
export class CorsOriginService {
  private readonly logger = new Logger(CorsOriginService.name);

  /** In-process set of concrete allowed origins (wildcard '*' is never stored). */
  private localOrigins: Set<string> | null = null;
  /** Epoch ms after which the set is reloaded on its next use. */
  private localCacheExpiry = 0;
  /** Backstop TTL in ms (5 minutes). */
  private readonly LOCAL_TTL_MS = 5 * 60 * 1000;
  private reloading: Promise<Set<string>> | null = null;
  private reloadAgain = false;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    bus: CacheBusService,
  ) {
    // No reload may start once the database client is closing: it would
    // reopen the pool. One already running is waited for.
    prisma.onBeforeDisconnect(async () => {
      this.stopped = true;
      await this.reloading?.catch(() => {});
    });
    bus.onEvent((event) => {
      if (event.t === 'client') void this.reload();
    });
    bus.onReset(() => {
      if (this.localOrigins !== null) void this.reload();
    });
  }

  /**
   * Returns true if the given origin is permitted by at least one enabled client.
   * The empty / undefined origin (same-origin, server-to-server) must be handled
   * by the caller — this method always expects a non-empty string.
   *
   * The bare wildcard '*' is never accepted as an allowed origin, even if a
   * client record in the database still contains it (e.g. data that pre-dates
   * the creation-time validation added in issue #320).  It is silently filtered
   * out during {@link loadFromDatabase} and a warning is emitted instead.
   */
  async isOriginAllowed(origin: string): Promise<boolean> {
    const origins = this.localOrigins ?? (await this.reload());
    if (Date.now() >= this.localCacheExpiry) void this.reload();
    return origins.has(origin);
  }

  /** Reload the set in the background; the current one is served meanwhile. */
  invalidateLocalCache(): void {
    void this.reload();
    this.logger.debug('In-process CORS origin set reload requested');
  }

  /**
   * The allowed origins, for the synchronous CORS check: null only before
   * the first load. A set past its TTL is still returned, and reloaded.
   */
  getCachedOrigins(): Set<string> | null {
    if (this.localOrigins !== null && Date.now() >= this.localCacheExpiry) {
      void this.reload();
    }
    return this.localOrigins;
  }

  /**
   * Preload the origin cache asynchronously. Called at startup to ensure
   * the cache is ready before the first CORS check.
   */
  async preloadCache(): Promise<void> {
    await this.reload();
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * One load at a time. A change announced during a load may not be in its
   * result, so it queues exactly one more.
   */
  private reload(): Promise<Set<string>> {
    if (this.stopped) return Promise.resolve(this.localOrigins ?? new Set());
    if (this.reloading) {
      this.reloadAgain = true;
      return this.reloading;
    }
    this.reloading = this.loadFromDatabase().finally(() => {
      this.reloading = null;
      if (this.reloadAgain) {
        this.reloadAgain = false;
        void this.reload();
      }
    });
    return this.reloading;
  }

  private async loadFromDatabase(): Promise<Set<string>> {
    this.logger.debug('CORS origin cache miss — loading from database');

    try {
      const clients = await this.prisma.client.findMany({
        where: { enabled: true },
        select: { webOrigins: true },
      });

      const origins = new Set<string>();

      // Always allow the server's own origin so the embedded admin console
      // can make API calls without CORS issues on fresh installs.
      const baseUrl = process.env['BASE_URL'];
      if (baseUrl) {
        try {
          const { origin } = new URL(baseUrl);
          origins.add(origin);
        } catch {
          /* invalid BASE_URL — skip */
        }
      }
      // Also allow localhost origins for development (never in production)
      if (process.env['NODE_ENV'] !== 'production') {
        const port = process.env['PORT'] ?? '3000';
        origins.add(`http://localhost:${port}`);
        origins.add(`http://127.0.0.1:${port}`);
      }

      for (const client of clients) {
        for (const o of client.webOrigins) {
          if (o === '*') {
            // A wildcard origin stored in the database means the client was
            // created before the #320 validation was introduced.  Honouring it
            // would bypass CORS protection for every request origin, so we
            // skip it here and emit a warning so operators can remediate.
            this.logger.warn(
              'A client webOrigins entry contains the wildcard "*". ' +
                'This origin is being ignored for CORS checks. ' +
                'Update the client to use explicit origins to silence this warning.',
            );
            continue;
          }
          origins.add(o);
        }
      }

      const originArray = Array.from(origins);

      // Populate both cache levels
      await this.cache.cacheCorsOrigins(originArray);

      this.localOrigins = origins;
      this.localCacheExpiry = Date.now() + this.LOCAL_TTL_MS;

      return origins;
    } catch (err) {
      this.logger.error(
        `Failed to load CORS origins from database: ${(err as Error).message}`,
      );
      // Keep serving the current set; with none yet, deny (empty set).
      this.localCacheExpiry = Date.now() + 10_000;
      return this.localOrigins ?? new Set<string>();
    }
  }
}
