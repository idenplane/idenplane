/**
 * This service provides statistical data for consent management.
 * It includes metrics like consent counts by category, history events, and pending actions.
 */
import { Injectable } from '@nestjs/common';
import type { Realm } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface ConsentStats {
  totalConsents: number;
  activeUsersWithConsents24h: number;
  activeUsersWithConsents7d: number;
  activeUsersWithConsents30d: number;
  consentsGranted24h: number;
  consentsRevoked24h: number;
  consentsUpdated24h: number;
  consentsByCategory: CategoryConsentCount[];
  pendingDeletions: number;
  pendingDeletionsGracePeriod: number;
  consentsRequiringReConsent: number;
}

export interface CategoryConsentCount {
  categoryId: string;
  categoryKey: string;
  categoryDisplayName: string;
  consentCount: number;
  requiredConsentCount: number;
  optionalConsentCount: number;
}

const CONSENT_GRANTED_TYPES = ['granted'];
const CONSENT_REVOKED_TYPES = ['revoked'];
const CONSENT_UPDATED_TYPES = ['updated'];

@Injectable()
export class ConsentStatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getRealmConsentStats(realm: Realm): Promise<ConsentStats> {
    const now = new Date();

    const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const cutoff7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const cutoff30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalConsents,
      activeUsersWithConsents24h,
      activeUsersWithConsents7d,
      activeUsersWithConsents30d,
      consentsGranted24h,
      consentsRevoked24h,
      consentsUpdated24h,
      consentsByCategory,
      pendingDeletions,
      pendingDeletionsGracePeriod,
    ] = await Promise.all([
      // Total active consents for this realm's users
      this.prisma.userConsent.count({
        where: {
          user: { realmId: realm.id },
        },
      }),

      // Distinct users with consent events in the last 24h
      this.prisma.userConsentHistory
        .groupBy({
          by: ['userId'],
          where: {
            user: { realmId: realm.id },
            createdAt: { gte: cutoff24h },
          },
        })
        .then((rows) => rows.length),

      // Distinct users with consent events in the last 7d
      this.prisma.userConsentHistory
        .groupBy({
          by: ['userId'],
          where: {
            user: { realmId: realm.id },
            createdAt: { gte: cutoff7d },
          },
        })
        .then((rows) => rows.length),

      // Distinct users with consent events in the last 30d
      this.prisma.userConsentHistory
        .groupBy({
          by: ['userId'],
          where: {
            user: { realmId: realm.id },
            createdAt: { gte: cutoff30d },
          },
        })
        .then((rows) => rows.length),

      // Consents granted in the last 24h
      this.prisma.userConsentHistory.count({
        where: {
          user: { realmId: realm.id },
          action: { in: CONSENT_GRANTED_TYPES },
          createdAt: { gte: cutoff24h },
        },
      }),

      // Consents revoked in the last 24h
      this.prisma.userConsentHistory.count({
        where: {
          user: { realmId: realm.id },
          action: { in: CONSENT_REVOKED_TYPES },
          createdAt: { gte: cutoff24h },
        },
      }),

      // Consents updated in the last 24h
      this.prisma.userConsentHistory.count({
        where: {
          user: { realmId: realm.id },
          action: { in: CONSENT_UPDATED_TYPES },
          createdAt: { gte: cutoff24h },
        },
      }),

      // Consents by category
      this.getConsentsByCategory(realm.id),

      // Pending deletions count
      this.prisma.pendingDeletion.count({
        where: {
          user: { realmId: realm.id },
          status: 'pending',
        },
      }),

      // Pending deletions within grace period (next 7 days)
      this.prisma.pendingDeletion.count({
        where: {
          user: { realmId: realm.id },
          status: 'pending',
          scheduledAt: { lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    return {
      totalConsents,
      activeUsersWithConsents24h,
      activeUsersWithConsents7d,
      activeUsersWithConsents30d,
      consentsGranted24h,
      consentsRevoked24h,
      consentsUpdated24h,
      consentsByCategory,
      pendingDeletions,
      pendingDeletionsGracePeriod,
      consentsRequiringReConsent: 0, // Computed separately if needed
    };
  }

  /**
   * Get consent counts grouped by consent category.
   */
  private async getConsentsByCategory(
    realmId: string,
  ): Promise<CategoryConsentCount[]> {
    const categories = await this.prisma.consentCategory.findMany({
      where: { realmId, enabled: true },
      include: {
        policies: {
          where: { isActive: true },
        },
      },
    });

    if (categories.length === 0) {
      return [];
    }

    const categoryCounts: CategoryConsentCount[] = [];

    for (const category of categories) {
      // Count users who have granted consent covering this category
      // This requires checking the metadata or scopes in history
      const historyWithCategory = await this.prisma.userConsentHistory.findMany({
        where: {
          user: { realmId },
          action: 'granted',
          metadata: {
            path: ['categoryKey'],
            equals: category.key,
          },
        },
        distinct: ['userId'],
      });

      // For now, count active consents and determine required vs optional
      const isRequired = category.required;

      categoryCounts.push({
        categoryId: category.id,
        categoryKey: category.key,
        categoryDisplayName: category.displayName,
        consentCount: historyWithCategory.length,
        requiredConsentCount: isRequired ? historyWithCategory.length : 0,
        optionalConsentCount: isRequired ? 0 : historyWithCategory.length,
      });
    }

    return categoryCounts;
  }

  /**
   * Get detailed statistics for a specific consent category.
   */
  async getCategoryStats(
    realm: Realm,
    categoryKey: string,
  ): Promise<{
    totalUsers: number;
    consentedUsers24h: number;
    consentedUsers7d: number;
    consentedUsers30d: number;
    revokedUsers24h: number;
    updatedUsers24h: number;
  }> {
    const now = new Date();

    const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const cutoff7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const cutoff30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const category = await this.prisma.consentCategory.findFirst({
      where: { realmId: realm.id, key: categoryKey },
    });

    if (!category) {
      return {
        totalUsers: 0,
        consentedUsers24h: 0,
        consentedUsers7d: 0,
        consentedUsers30d: 0,
        revokedUsers24h: 0,
        updatedUsers24h: 0,
      };
    }

    const [
      historyWithCategory,
      consentedUsers24h,
      consentedUsers7d,
      consentedUsers30d,
      revokedUsers24h,
      updatedUsers24h,
    ] = await Promise.all([
      // All distinct users who ever consented to this category
      this.prisma.userConsentHistory.findMany({
        where: {
          user: { realmId: realm.id },
          action: 'granted',
          metadata: {
            path: ['categoryKey'],
            equals: category.key,
          },
        },
        distinct: ['userId'],
      }),

      // Users who consented to this category in last 24h
      this.prisma.userConsentHistory
        .groupBy({
          by: ['userId'],
          where: {
            user: { realmId: realm.id },
            action: 'granted',
            createdAt: { gte: cutoff24h },
            metadata: {
              path: ['categoryKey'],
              equals: category.key,
            },
          },
        })
        .then((rows) => rows.length),

      // Users who consented to this category in last 7d
      this.prisma.userConsentHistory
        .groupBy({
          by: ['userId'],
          where: {
            user: { realmId: realm.id },
            action: 'granted',
            createdAt: { gte: cutoff7d },
            metadata: {
              path: ['categoryKey'],
              equals: category.key,
            },
          },
        })
        .then((rows) => rows.length),

      // Users who consented to this category in last 30d
      this.prisma.userConsentHistory
        .groupBy({
          by: ['userId'],
          where: {
            user: { realmId: realm.id },
            action: 'granted',
            createdAt: { gte: cutoff30d },
            metadata: {
              path: ['categoryKey'],
              equals: category.key,
            },
          },
        })
        .then((rows) => rows.length),

      // Users who revoked consent to this category in last 24h
      this.prisma.userConsentHistory
        .groupBy({
          by: ['userId'],
          where: {
            user: { realmId: realm.id },
            action: 'revoked',
            createdAt: { gte: cutoff24h },
            metadata: {
              path: ['categoryKey'],
              equals: category.key,
            },
          },
        })
        .then((rows) => rows.length),

      // Users who updated consent to this category in last 24h
      this.prisma.userConsentHistory
        .groupBy({
          by: ['userId'],
          where: {
            user: { realmId: realm.id },
            action: 'updated',
            createdAt: { gte: cutoff24h },
            metadata: {
              path: ['categoryKey'],
              equals: category.key,
            },
          },
        })
        .then((rows) => rows.length),
    ]);

    return {
      totalUsers: historyWithCategory.length,
      consentedUsers24h,
      consentedUsers7d,
      consentedUsers30d,
      revokedUsers24h,
      updatedUsers24h,
    };
  }
}
