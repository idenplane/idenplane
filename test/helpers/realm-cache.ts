import type { CacheService } from '../../src/cache/cache.service';

/**
 * Tests that change a realm with Prisma directly skip what the admin API
 * does after a realm update: drop the cached realm. The running app learns
 * of the change from a database notification, asynchronously, so a request
 * sent right after the write could still be served from the old realm (the
 * SAML resume and per-client rate-limit e2e tests failed that way on CI).
 *
 * createTestApp registers the app's CacheService here, and helpers that
 * write a realm call {@link forgetCachedRealm} afterwards, so the next
 * request reads the realm from the database.
 */
let current: CacheService | undefined;

export function useRealmCacheOf(cache: CacheService | undefined): void {
  current = cache;
}

export async function forgetCachedRealm(realm: {
  id: string;
  name: string;
}): Promise<void> {
  await current?.invalidateRealmCache(realm.id, realm.name);
}
