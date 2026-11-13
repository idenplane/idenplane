import { Injectable } from '@nestjs/common';
import type { Client, Prisma, RealmSigningKey } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CacheService } from './cache.service.js';
import type { UserGrants } from '../auth/user-grants.js';

/** The user columns a token or an introspection response can carry. */
const USER_PROFILE_SELECT = {
  id: true,
  realmId: true,
  username: true,
  email: true,
  emailVerified: true,
  firstName: true,
  lastName: true,
  enabled: true,
  federationLink: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export type UserProfile = Prisma.UserGetPayload<{
  select: typeof USER_PROFILE_SELECT;
}>;

/**
 * The lookups every token, introspection and verification request makes,
 * served from the in-process cache (CacheService) and kept current by the
 * database's own change announcements: a disabled client, a rotated secret
 * or a new signing key is seen by the next request on every process.
 *
 * In-process only, never Redis: a client row holds its secret hash and a
 * signing key its private key.
 */
@Injectable()
export class CachedLookupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /** A realm's client by its client_id, or null. */
  async client(realmId: string, clientId: string): Promise<Client | null> {
    const cached = this.cache.getLocalClientRow<Client>(realmId, clientId);
    if (cached) return cached;
    const client = await this.prisma.client.findUnique({
      where: { realmId_clientId: { realmId, clientId } },
    });
    if (client) this.cache.setLocalClientRow(realmId, clientId, client);
    return client;
  }

  /**
   * The realm's signing key for new tokens and for verifying them: the
   * newest active one, or null if the realm has none.
   */
  async activeSigningKey(realmId: string): Promise<RealmSigningKey | null> {
    const cached = this.cache.getLocalSigningKey<RealmSigningKey>(realmId);
    if (cached) return cached;
    const key = await this.prisma.realmSigningKey.findFirst({
      where: { realmId, active: true },
      orderBy: { createdAt: 'desc' },
    });
    if (key) this.cache.setLocalSigningKey(realmId, key);
    return key;
  }

  /**
   * A user's profile as tokens and introspection see it (no credentials),
   * or null if there is no such user. Kept current by the database: a
   * disabled or renamed user is seen by the next request on every process.
   */
  async userProfile(userId: string): Promise<UserProfile | null> {
    return this.cache.localUser(userId, () =>
      this.prisma.user.findUnique({
        where: { id: userId },
        select: USER_PROFILE_SELECT,
      }),
    );
  }

  /**
   * What a user is granted, computed by `load` on a miss: their roles,
   * direct and through groups, and their attribute claims. Dropped whenever
   * any of those rows change.
   */
  userGrants(
    userId: string,
    load: () => Promise<UserGrants>,
  ): Promise<UserGrants> {
    return this.cache.localUserGrants(userId, load);
  }

  /**
   * Whether the session `sessionId` still exists (logout, revocation and
   * the session cap delete it). Kept current by the database: an ended
   * session is seen by the next request on every process.
   */
  async sessionExists(sessionId: string): Promise<boolean> {
    const found = await this.cache.localSession(sessionId, () =>
      this.prisma.session.findUnique({
        where: { id: sessionId },
        select: { id: true },
      }),
    );
    return found !== null;
  }

  /** A realm's protocol mappers for a set of scopes, read by `load` on a miss. */
  scopeMappers<T extends object>(
    realmId: string,
    scopeNames: string[],
    load: () => Promise<T>,
  ): Promise<T> {
    return this.cache.localScopeMappers(realmId, scopeNames, load);
  }
}
