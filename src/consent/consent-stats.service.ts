/**
 * Statistical data for consent management.
 *
 * Two views are produced:
 *  - realm-wide stats (totals, active-user and action windows, per-category
 *    breakdown, pending deletions) — for the Consent Statistics dashboard;
 *  - per-category stats (grant/revoke totals, grant and active-user windows) —
 *    for a single consent category's detail page.
 *
 * The link between a consent event and its GDPR consent categories is the
 * `categoryKeys` array stored in `UserConsentHistory.metadata` (the live grant
 * path tags every grant via ConsentService.resolveCategoryKeys). Aggregations
 * below filter history on that JSON path with `array_contains`. No metric is
 * faked or hard-coded.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, Realm } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

/** A single row of the realm's per-category consent breakdown. */
export interface CategoryConsentCount {
  categoryId: string;
  categoryKey: string;
  categoryName: string;
  required: boolean;
  /** Count of `granted` history events tagged with this category. */
  totalGrants: number;
  /** Distinct users who have granted this category. */
  distinctUsers: number;
}

/** Realm-wide consent statistics (Consent Statistics dashboard). */
export interface ConsentStats {
  totalConsents: number;
  activeUsersWithConsents24h: number;
  activeUsersWithConsents7d: number;
  activeUsersWithConsents30d: number;
  /** All consent history actions (grant/revoke/update) within the window. */
  consentActionsLast24h: number;
  consentActionsLast7d: number;
  consentActionsLast30d: number;
  /** Per-type breakdown for the last 24h (richer detail for the dashboard). */
  consentsGranted24h: number;
  consentsRevoked24h: number;
  consentsUpdated24h: number;
  consentsByCategory: CategoryConsentCount[];
  pendingDeletions: number;
  pendingDeletionsGracePeriod: number;
}

/** Detailed statistics for a single consent category. */
export interface CategoryStats {
  categoryId: string;
  categoryKey: string;
  categoryName: string;
  totalGrants: number;
  totalRevokes: number;
  grants24h: number;
  grants7d: number;
  grants30d: number;
  activeUsers24h: number;
  activeUsers7d: number;
  activeUsers30d: number;
}

@Injectable()
export class ConsentStatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Cutoff timestamps for the standard 24h / 7d / 30d windows. */
  private windows(now = new Date()) {
    return {
      cutoff24h: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      cutoff7d: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      cutoff30d: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
    };
  }

  /**
   * Prisma JSON-path filter matching history whose `metadata.categoryKeys`
   * array contains the given category key.
   */
  private categoryKeyFilter(key: string): Prisma.JsonFilter {
    return { path: ['categoryKeys'], array_contains: key };
  }

  /** Count distinct users in a history query. */
  private async countDistinctUsers(
    where: Prisma.UserConsentHistoryWhereInput,
  ): Promise<number> {
    const rows = await this.prisma.userConsentHistory.groupBy({
      by: ['userId'],
      where,
    });
    return rows.length;
  }

  async getRealmConsentStats(realm: Realm): Promise<ConsentStats> {
    const now = new Date();
    const { cutoff24h, cutoff7d, cutoff30d } = this.windows(now);
    const realmScope = { user: { realmId: realm.id } };

    const [
      totalConsents,
      activeUsersWithConsents24h,
      activeUsersWithConsents7d,
      activeUsersWithConsents30d,
      consentActionsLast24h,
      consentActionsLast7d,
      consentActionsLast30d,
      consentsGranted24h,
      consentsRevoked24h,
      consentsUpdated24h,
      consentsByCategory,
      pendingDeletions,
      pendingDeletionsGracePeriod,
    ] = await Promise.all([
      this.prisma.userConsent.count({ where: realmScope }),

      this.countDistinctUsers({ ...realmScope, createdAt: { gte: cutoff24h } }),
      this.countDistinctUsers({ ...realmScope, createdAt: { gte: cutoff7d } }),
      this.countDistinctUsers({ ...realmScope, createdAt: { gte: cutoff30d } }),

      this.prisma.userConsentHistory.count({
        where: { ...realmScope, createdAt: { gte: cutoff24h } },
      }),
      this.prisma.userConsentHistory.count({
        where: { ...realmScope, createdAt: { gte: cutoff7d } },
      }),
      this.prisma.userConsentHistory.count({
        where: { ...realmScope, createdAt: { gte: cutoff30d } },
      }),

      this.prisma.userConsentHistory.count({
        where: {
          ...realmScope,
          action: 'granted',
          createdAt: { gte: cutoff24h },
        },
      }),
      this.prisma.userConsentHistory.count({
        where: {
          ...realmScope,
          action: 'revoked',
          createdAt: { gte: cutoff24h },
        },
      }),
      this.prisma.userConsentHistory.count({
        where: {
          ...realmScope,
          action: 'updated',
          createdAt: { gte: cutoff24h },
        },
      }),

      this.getConsentsByCategory(realm.id),

      this.prisma.pendingDeletion.count({
        where: { user: { realmId: realm.id }, status: 'pending' },
      }),
      this.prisma.pendingDeletion.count({
        where: {
          user: { realmId: realm.id },
          status: 'pending',
          scheduledAt: {
            lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
          },
        },
      }),
    ]);

    return {
      totalConsents,
      activeUsersWithConsents24h,
      activeUsersWithConsents7d,
      activeUsersWithConsents30d,
      consentActionsLast24h,
      consentActionsLast7d,
      consentActionsLast30d,
      consentsGranted24h,
      consentsRevoked24h,
      consentsUpdated24h,
      consentsByCategory,
      pendingDeletions,
      pendingDeletionsGracePeriod,
    };
  }

  /** Per-category breakdown of granted consents for a realm. */
  private async getConsentsByCategory(
    realmId: string,
  ): Promise<CategoryConsentCount[]> {
    const categories = await this.prisma.consentCategory.findMany({
      where: { realmId, enabled: true },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    if (categories.length === 0) return [];

    return Promise.all(
      categories.map(async (category) => {
        const grantedScope = {
          user: { realmId },
          action: 'granted',
          metadata: this.categoryKeyFilter(category.key),
        } satisfies Prisma.UserConsentHistoryWhereInput;

        const [totalGrants, distinctUsers] = await Promise.all([
          this.prisma.userConsentHistory.count({ where: grantedScope }),
          this.countDistinctUsers(grantedScope),
        ]);

        return {
          categoryId: category.id,
          categoryKey: category.key,
          categoryName: category.displayName,
          required: category.required,
          totalGrants,
          distinctUsers,
        };
      }),
    );
  }

  /**
   * Detailed statistics for a single consent category (by id, realm-scoped).
   */
  async getCategoryStats(
    realm: Realm,
    categoryId: string,
  ): Promise<CategoryStats> {
    const category = await this.prisma.consentCategory.findUnique({
      where: { id: categoryId },
    });
    if (!category || category.realmId !== realm.id) {
      throw new NotFoundException(`Consent category '${categoryId}' not found`);
    }

    const { cutoff24h, cutoff7d, cutoff30d } = this.windows();
    const keyFilter = this.categoryKeyFilter(category.key);
    const base = {
      user: { realmId: realm.id },
      metadata: keyFilter,
    } satisfies Prisma.UserConsentHistoryWhereInput;
    const granted = { ...base, action: 'granted' };

    const [
      totalGrants,
      totalRevokes,
      grants24h,
      grants7d,
      grants30d,
      activeUsers24h,
      activeUsers7d,
      activeUsers30d,
    ] = await Promise.all([
      this.prisma.userConsentHistory.count({ where: granted }),
      this.prisma.userConsentHistory.count({
        where: { ...base, action: 'revoked' },
      }),
      this.prisma.userConsentHistory.count({
        where: { ...granted, createdAt: { gte: cutoff24h } },
      }),
      this.prisma.userConsentHistory.count({
        where: { ...granted, createdAt: { gte: cutoff7d } },
      }),
      this.prisma.userConsentHistory.count({
        where: { ...granted, createdAt: { gte: cutoff30d } },
      }),
      this.countDistinctUsers({ ...base, createdAt: { gte: cutoff24h } }),
      this.countDistinctUsers({ ...base, createdAt: { gte: cutoff7d } }),
      this.countDistinctUsers({ ...base, createdAt: { gte: cutoff30d } }),
    ]);

    return {
      categoryId: category.id,
      categoryKey: category.key,
      categoryName: category.displayName,
      totalGrants,
      totalRevokes,
      grants24h,
      grants7d,
      grants30d,
      activeUsers24h,
      activeUsers7d,
      activeUsers30d,
    };
  }
}
