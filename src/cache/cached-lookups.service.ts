import { Injectable } from '@nestjs/common';
import type { Client, RealmSigningKey } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CacheService } from './cache.service.js';

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
}
