import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { CacheService } from '../cache/cache.service.js';

/** The client fields a secret check needs. */
export interface ClientWithSecret {
  id: string;
  realmId: string;
  clientId: string;
  clientSecret: string | null;
}

/**
 * Checks a confidential client's presented secret: the one place every
 * client-authenticating endpoint goes through. Secrets stored as Argon2 by
 * versions before 0.5.2 are moved to the fast format the first time they are
 * presented, so nobody has to rotate anything.
 */
@Injectable()
export class ClientSecretService {
  private readonly logger = new Logger(ClientSecretService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly cache: CacheService,
  ) {}

  async verify(client: ClientWithSecret, presented: string): Promise<boolean> {
    if (!client.clientSecret) return false;
    const { valid, rehash } = await this.crypto.verifySecret(
      client.clientSecret,
      presented,
    );
    if (valid && rehash) await this.upgrade(client, rehash);
    return valid;
  }

  /**
   * Conditional on the row still holding the hash just verified: if an admin
   * regenerated the secret meanwhile, the old secret's hash must not be
   * written back over the new one. A failed upgrade is retried next time.
   */
  private async upgrade(client: ClientWithSecret, rehash: string) {
    try {
      const { count } = await this.prisma.client.updateMany({
        where: { id: client.id, clientSecret: client.clientSecret },
        data: { clientSecret: rehash },
      });
      if (count > 0) {
        await this.cache.invalidateClientCache(
          `${client.realmId}:${client.clientId}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Could not upgrade the secret hash of client ${client.clientId}: ${String(err)}`,
      );
    }
  }
}
