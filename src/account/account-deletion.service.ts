import { Injectable, NotFoundException, ConflictException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface DeletionStatus {
  requestedAt: Date;
  scheduledAt: Date;
  gracePeriodDays: number;
  status: 'pending' | 'processing' | 'completed' | 'cancelled';
  exportStatus: string | null;
  daysRemaining: number;
}

export interface PendingDeletionInfo {
  id: string;
  userId: string;
  username: string;
  email: string | null;
  requestedAt: Date;
  scheduledAt: Date;
  gracePeriodDays: number;
  status: string;
  exportStatus: string | null;
}

export interface ProcessDeletionResult {
  processedCount: number;
  errors: string[];
}

@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Request account deletion with a grace period.
   * User can still log in during the grace period.
   */
  async requestDeletion(
    userId: string,
    gracePeriodDays: number = 14,
    ipAddress?: string,
  ): Promise<DeletionStatus> {
    // Check if user exists
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, pendingDeletion: true },
    });

    if (!user) {
      throw new NotFoundException(`User with ID '${userId}' not found`);
    }

    // Check if there's already a pending deletion
    if (user.pendingDeletion) {
      if (user.pendingDeletion.status === 'pending') {
        throw new ConflictException('Account deletion is already pending');
      }
      if (user.pendingDeletion.status === 'processing') {
        throw new ConflictException('Account deletion is currently being processed');
      }
    }

    const now = new Date();
    const scheduledAt = new Date(now.getTime() + gracePeriodDays * 24 * 60 * 60 * 1000);
    const daysRemaining = Math.ceil((scheduledAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

    const deletion = await this.prisma.pendingDeletion.upsert({
      where: { userId },
      create: {
        userId,
        scheduledAt,
        gracePeriodDays,
        status: 'pending',
        ipAddress,
      },
      update: {
        scheduledAt,
        gracePeriodDays,
        status: 'pending',
        cancelledAt: null,
        cancelledBy: null,
        completedAt: null,
        exportStatus: null,
        exportRequestedAt: null,
        exportGeneratedAt: null,
        exportUrl: null,
        ipAddress,
      },
    });

    return {
      requestedAt: deletion.requestedAt,
      scheduledAt: deletion.scheduledAt,
      gracePeriodDays: deletion.gracePeriodDays,
      status: deletion.status as 'pending',
      exportStatus: deletion.exportStatus,
      daysRemaining,
    };
  }

  /**
   * Cancel a pending account deletion.
   */
  async cancelDeletion(userId: string, cancelledBy?: string): Promise<void> {
    const deletion = await this.prisma.pendingDeletion.findUnique({
      where: { userId },
    });

    if (!deletion) {
      throw new NotFoundException('No pending deletion found for this user');
    }

    if (deletion.status !== 'pending') {
      throw new BadRequestException(`Cannot cancel deletion with status '${deletion.status}'`);
    }

    await this.prisma.pendingDeletion.update({
      where: { userId },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelledBy,
      },
    });
  }

  /**
   * Get deletion status for a user.
   */
  async getDeletionStatus(userId: string): Promise<DeletionStatus | null> {
    const deletion = await this.prisma.pendingDeletion.findUnique({
      where: { userId },
    });

    if (!deletion) {
      return null;
    }

    const now = new Date();
    const daysRemaining = Math.ceil(
      (deletion.scheduledAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
    );

    return {
      requestedAt: deletion.requestedAt,
      scheduledAt: deletion.scheduledAt,
      gracePeriodDays: deletion.gracePeriodDays,
      status: deletion.status as DeletionStatus['status'],
      exportStatus: deletion.exportStatus,
      daysRemaining: Math.max(0, daysRemaining),
    };
  }

  /**
   * Request data export during grace period.
   */
  async requestDataExport(userId: string): Promise<{ exportStatus: string; exportRequestedAt: Date | null }> {
    const deletion = await this.prisma.pendingDeletion.findUnique({
      where: { userId },
    });

    if (!deletion) {
      throw new NotFoundException('No pending deletion found for this user');
    }

    if (deletion.status !== 'pending') {
      throw new BadRequestException(`Cannot request export for deletion with status '${deletion.status}'`);
    }

    const updated = await this.prisma.pendingDeletion.update({
      where: { userId },
      data: {
        exportStatus: 'requested',
        exportRequestedAt: new Date(),
      },
    });

    return {
      exportStatus: updated.exportStatus!,
      exportRequestedAt: updated.exportRequestedAt,
    };
  }

  /**
   * Get pending deletions for a realm (admin use).
   */
  async getPendingDeletionsForRealm(realmId: string, options?: { status?: string; limit?: number; offset?: number }): Promise<PendingDeletionInfo[]> {
    const where: Record<string, unknown> = {
      user: { realmId },
    };

    if (options?.status) {
      where['status'] = options.status;
    }

    const deletions = await this.prisma.pendingDeletion.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
      },
      orderBy: { requestedAt: 'desc' },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
    });

    return deletions.map(d => ({
      id: d.id,
      userId: d.user.id,
      username: d.user.username,
      email: d.user.email,
      requestedAt: d.requestedAt,
      scheduledAt: d.scheduledAt,
      gracePeriodDays: d.gracePeriodDays,
      status: d.status,
      exportStatus: d.exportStatus,
    }));
  }

  /**
   * Process scheduled deletions (called by a scheduled job/cron).
   * This deletes users whose grace period has expired.
   */
  async processScheduledDeletions(batchSize: number = 10): Promise<ProcessDeletionResult> {
    const now = new Date();
    const result: ProcessDeletionResult = { processedCount: 0, errors: [] };

    // Find all pending deletions that have passed their scheduled time
    const pendingDeletions = await this.prisma.pendingDeletion.findMany({
      where: {
        status: 'pending',
        scheduledAt: { lte: now },
      },
      take: batchSize,
      orderBy: { scheduledAt: 'asc' },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            realmId: true,
          },
        },
      },
    });

    if (pendingDeletions.length === 0) {
      return result;
    }

    this.logger.log(`Processing ${pendingDeletions.length} scheduled account deletions`);

    for (const deletion of pendingDeletions) {
      try {
        // Update status to processing
        await this.prisma.pendingDeletion.update({
          where: { id: deletion.id },
          data: { status: 'processing' },
        });

        // Delete the user (this will cascade to related records due to FK constraints)
        await this.prisma.user.delete({
          where: { id: deletion.userId },
        });

        // Mark as completed
        await this.prisma.pendingDeletion.update({
          where: { id: deletion.id },
          data: {
            status: 'completed',
            completedAt: new Date(),
          },
        });

        result.processedCount++;
        this.logger.log(`Successfully deleted user '${deletion.user.username}' (${deletion.userId})`);
      } catch (error) {
        const errorMessage = `Failed to delete user '${deletion.user.username}' (${deletion.userId}): ${(error as Error).message}`;
        result.errors.push(errorMessage);
        this.logger.error(errorMessage);

        // Revert status to pending so it can be retried
        await this.prisma.pendingDeletion.update({
          where: { id: deletion.id },
          data: { status: 'pending' },
        }).catch(() => {
          // Ignore errors during revert
        });
      }
    }

    return result;
  }

  /**
   * Get deletion statistics for a realm.
   */
  async getDeletionStats(realmId: string): Promise<{
    pending: number;
    processing: number;
    completed: number;
    cancelled: number;
    total: number;
  }> {
    const counts = await this.prisma.pendingDeletion.groupBy({
      by: ['status'],
      where: {
        user: { realmId },
      },
    });

    const stats = {
      pending: 0,
      processing: 0,
      completed: 0,
      cancelled: 0,
      total: 0,
    };

    for (const count of counts) {
      if (count.status in stats) {
        (stats as Record<string, number>)[count.status] = count.count;
        stats.total += count.count;
      }
    }

    return stats;
  }
}