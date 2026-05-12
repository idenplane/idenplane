import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwkService } from '../crypto/jwk.service.js';
import type { Realm } from '@prisma/client';

@Injectable()
export class BackchannelLogoutService {
  private readonly logger = new Logger(BackchannelLogoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwkService: JwkService,
  ) {}

  sendLogoutTokens(realm: Realm, userId: string, sessionId: string): void {
    // Intentionally fire-and-forget: building and sending logout tokens to all
    // registered relying parties must not block the caller's token operation.
    // Each per-client promise already handles its own errors, so the
    // Promise.allSettled chain can never produce an unhandled rejection.
    void this.dispatchLogoutTokens(realm, userId, sessionId);
  }

  private async dispatchLogoutTokens(
    realm: Realm,
    userId: string,
    sessionId: string,
  ): Promise<void> {
    // Find all clients with backchannel logout URI
    const clients = await this.prisma.client.findMany({
      where: {
        realmId: realm.id,
        backchannelLogoutUri: { not: null },
      },
    });

    if (clients.length === 0) return;

    const signingKey = await this.prisma.realmSigningKey.findFirst({
      where: { realmId: realm.id, active: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!signingKey) {
      this.logger.warn('No active signing key found for backchannel logout');
      return;
    }

    const baseUrl = process.env['BASE_URL'] ?? 'http://localhost:3000';
    const issuer = `${baseUrl}/realms/${realm.name}`;

    const promises = clients.map(async (client) => {
      if (!client.backchannelLogoutUri) return;

      try {
        const payload: Record<string, unknown> = {
          iss: issuer,
          sub: userId,
          aud: client.clientId,
          events: { 'http://schemas.openid.net/event/backchannel-logout': {} },
        };

        if (client.backchannelLogoutSessionRequired) {
          payload['sid'] = sessionId;
        }

        const logoutToken = await this.jwkService.signJwt(
          payload,
          signingKey.privateKey,
          signingKey.kid,
          120, // 2 min validity
        );

        const response = await fetch(client.backchannelLogoutUri, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `logout_token=${logoutToken}`,
          signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
          this.logger.warn(
            `Backchannel logout to ${client.clientId} returned ${response.status}`,
          );
        }
      } catch (err: any) {
        this.logger.warn(
          `Backchannel logout to ${client.clientId} failed: ${err.message}`,
        );
      }
    });

    await Promise.allSettled(promises);
  }
}
