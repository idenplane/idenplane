import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { LeaderService } from '../cache/leader.service.js';
import { monthOf } from './usage-period.js';
import {
  loadUsageRetention,
  retentionCutoff,
  type UsageRetentionMonths,
} from './usage-retention.config.js';

/** Rows deleted per statement: each is its own short transaction. */
export const USAGE_PRUNE_BATCH = 5000;

/**
 * Deletes monthly activity older than USAGE_ACTIVITY_RETENTION_MONTHS, so the
 * ids of deleted users are not kept for ever.
 *
 * - Hourly, on the leader only (one process across all replicas). A month
 *   turns over once, so most ticks find nothing: a single primary-key range
 *   lookup that returns no row.
 * - In batches of USAGE_PRUNE_BATCH rows by primary key range, each its own
 *   statement, so no lock is held for long and replicas keep writing.
 * - It first moves `usage_tracking.pruned_before` forward (never back), so
 *   the usage report can tell a pruned month from one with no activity,
 *   even half-way through a prune or after the setting is raised.
 */
@Injectable()
export class UsageRetentionService {
  private readonly logger = new Logger(UsageRetentionService.name);
  /** Whole months kept before the current one; null: never prune. */
  readonly retentionMonths: UsageRetentionMonths = loadUsageRetention();

  constructor(
    private readonly prisma: PrismaService,
    private readonly leader: LeaderService,
  ) {}

  /** The first month kept now; null when nothing is pruned. */
  cutoff(now = new Date()): Date | null {
    return retentionCutoff(this.retentionMonths, monthOf(now).start);
  }

  @Interval(3_600_000) // every hour
  async pruneOnSchedule(): Promise<void> {
    if (!this.leader.isLeader()) return;
    try {
      await this.prune();
    } catch (err) {
      this.logger.warn(
        `Pruning monthly activity failed; retried next hour: ${(err as Error).message}`,
      );
    }
  }

  /** Deletes every month before the cutoff. Returns the rows deleted. */
  async prune(now = new Date()): Promise<number> {
    const cutoff = this.cutoff(now);
    if (cutoff === null) return 0;

    // Mark first: a month being pruned already reads as pruned.
    await this.prisma.$executeRaw`
      UPDATE "usage_tracking"
         SET "pruned_before" = GREATEST(COALESCE("pruned_before", ${cutoff}::date), ${cutoff}::date)
       WHERE "id" = 1`;

    let total = 0;
    for (;;) {
      const deleted = await this.prisma.$executeRaw`
        DELETE FROM "user_monthly_activity"
         WHERE ("month", "realm_id", "user_id") IN (
           SELECT "month", "realm_id", "user_id"
             FROM "user_monthly_activity"
            WHERE "month" < ${cutoff}::date
            LIMIT ${USAGE_PRUNE_BATCH})`;
      total += deleted;
      if (deleted < USAGE_PRUNE_BATCH) break;
    }
    if (total > 0) {
      this.logger.log(
        `Pruned ${total} monthly activity row(s) before ${cutoff.toISOString().slice(0, 7)} (USAGE_ACTIVITY_RETENTION_MONTHS=${this.retentionMonths})`,
      );
    }
    return total;
  }
}
