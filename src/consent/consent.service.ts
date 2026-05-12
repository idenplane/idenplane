import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';

export interface ConsentRequest {
  userId: string;
  clientId: string;
  clientName: string;
  realmName: string;
  scopes: string[];
  oauthParams: Record<string, string>;
}

export type ConsentAction = 'granted' | 'revoked' | 'updated';

export interface ConsentContext {
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export interface ConsentHistoryEntry {
  id: string;
  userId: string;
  clientId: string;
  action: ConsentAction;
  scopes: string[];
  policyVersion: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

@Injectable()
export class ConsentService {
  private readonly logger = new Logger(ConsentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Check if a user has already granted consent for the requested scopes.
   */
  async hasConsent(
    userId: string,
    clientId: string,
    requestedScopes: string[],
  ): Promise<boolean> {
    const consent = await this.prisma.userConsent.findUnique({
      where: { userId_clientId: { userId, clientId } },
    });

    if (!consent) return false;

    // Check that every requested scope is covered by the stored consent
    return requestedScopes.every((scope) => consent.scopes.includes(scope));
  }

  /**
   * Store a pending consent request in DB. Returns a token for retrieval.
   */
  async storeConsentRequest(data: ConsentRequest): Promise<string> {
    const token = this.crypto.generateSecret(16);
    const tokenHash = this.crypto.sha256(token);

    await this.prisma.pendingAction.create({
      data: {
        tokenHash,
        type: 'consent_request',
        data: data as unknown as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 min TTL
      },
    });

    return token;
  }

  /**
   * Retrieve and remove a pending consent request.
   */
  async getConsentRequest(token: string): Promise<ConsentRequest | undefined> {
    const tokenHash = this.crypto.sha256(token);

    const action = await this.prisma.pendingAction.findUnique({
      where: { tokenHash },
    });

    if (!action || action.type !== 'consent_request') return undefined;
    if (action.expiresAt < new Date()) {
      await this.prisma.pendingAction.delete({ where: { id: action.id } });
      return undefined;
    }

    // Consume the request (one-time use)
    await this.prisma.pendingAction.delete({ where: { id: action.id } });

    return action.data as unknown as ConsentRequest;
  }

  @Interval(120_000)
  async cleanupExpiredConsentRequests(): Promise<void> {
    const { count } = await this.prisma.pendingAction.deleteMany({
      where: { type: 'consent_request', expiresAt: { lt: new Date() } },
    });
    if (count > 0) {
      this.logger.debug(`Cleaned up ${count} expired consent requests`);
    }
  }

  /**
   * Record a consent action in the history table.
   */
  private async recordConsentHistory(
    userId: string,
    clientId: string,
    action: ConsentAction,
    scopes: string[],
    policyVersion?: string,
    context?: ConsentContext,
  ): Promise<void> {
    try {
      await this.prisma.userConsentHistory.create({
        data: {
          userId,
          clientId,
          action,
          scopes,
          policyVersion: policyVersion ?? null,
          ipAddress: context?.ipAddress ?? null,
          userAgent: context?.userAgent ?? null,
          metadata: context?.metadata
            ? (context.metadata as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to record consent history: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Grant consent with history tracking and versioning support.
   */
  async grantConsent(
    userId: string,
    clientId: string,
    scopes: string[],
    policyVersion?: string,
    context?: ConsentContext,
  ) {
    const existing = await this.prisma.userConsent.findUnique({
      where: { userId_clientId: { userId, clientId } },
    });

    const action = existing ? 'updated' : 'granted';

    const result = await this.prisma.userConsent.upsert({
      where: { userId_clientId: { userId, clientId } },
      create: { userId, clientId, scopes },
      update: { scopes },
    });

    await this.recordConsentHistory(
      userId,
      clientId,
      action,
      scopes,
      policyVersion,
      context,
    );

    return result;
  }

  /**
   * Revoke consent for a user-client pair with history tracking.
   */
  async revokeConsent(
    userId: string,
    clientId: string,
    context?: ConsentContext,
  ) {
    const existing = await this.prisma.userConsent.findUnique({
      where: { userId_clientId: { userId, clientId } },
    });

    await this.prisma.userConsent.deleteMany({
      where: { userId, clientId },
    });

    if (existing) {
      await this.recordConsentHistory(
        userId,
        clientId,
        'revoked',
        existing.scopes,
        undefined,
        context,
      );
    }
  }

  /**
   * Get consent history for a user-client pair.
   */
  async getConsentHistory(
    userId: string,
    clientId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<ConsentHistoryEntry[]> {
    return this.prisma.userConsentHistory.findMany({
      where: { userId, clientId },
      orderBy: { createdAt: 'desc' },
      skip: options?.offset ?? 0,
      take: options?.limit ?? 50,
    }) as Promise<ConsentHistoryEntry[]>;
  }

  /**
   * Get the latest policy version for a consent category.
   */
  async getLatestPolicyVersion(categoryKey: string): Promise<string | null> {
    const category = await this.prisma.consentCategory.findFirst({
      where: { key: categoryKey },
      include: {
        policies: {
          where: { isActive: true },
          orderBy: { publishedAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!category || category.policies.length === 0) {
      return null;
    }

    return category.policies[0].version;
  }

  /**
   * Check if a policy version change requires re-consent from the user.
   * Returns true if any previously-accepted scope has a newer active policy.
   */
  async requiresReConsent(
    userId: string,
    clientId: string,
    realmId: string,
  ): Promise<boolean> {
    const consent = await this.prisma.userConsent.findUnique({
      where: { userId_clientId: { userId, clientId } },
    });

    if (!consent) return false;

    // Get categories for this realm
    const categories = await this.prisma.consentCategory.findMany({
      where: { realmId, enabled: true },
      include: {
        policies: {
          where: { isActive: true },
          orderBy: { publishedAt: 'desc' },
          take: 1,
        },
      },
    });

    if (categories.length === 0) return false;

    // Get the most recent history entry for each category
    const historyEntries = await this.prisma.userConsentHistory.findMany({
      where: {
        userId,
        clientId,
        policyVersion: { not: null },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Build a map of category key -> last accepted version
    const lastAcceptedByCategory = new Map<string, string>();
    for (const entry of historyEntries) {
      const metadata = entry.metadata as { categoryKey?: string } | null;
      if (
        metadata?.categoryKey &&
        !lastAcceptedByCategory.has(metadata.categoryKey)
      ) {
        lastAcceptedByCategory.set(metadata.categoryKey, entry.policyVersion!);
      }
    }

    // Check if any active policy is newer than what the user accepted
    for (const category of categories) {
      if (category.policies.length === 0) continue;
      const activeVersion = category.policies[0].version;
      const lastAccepted = lastAcceptedByCategory.get(category.key);

      if (lastAccepted && activeVersion !== lastAccepted) {
        // Policy has changed since user's last consent
        return true;
      }
    }

    return false;
  }
}
