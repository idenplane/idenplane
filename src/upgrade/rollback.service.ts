import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { DatabaseBackupService } from './database-backup.service';

export interface RollbackResult {
  success: boolean;
  rollbackVersion?: string;
  previousVersion?: string;
  backupRestored?: boolean;
  backupPath?: string;
  duration?: number;
  error?: string;
  timestamp: Date;
}

export interface RollbackCapability {
  canRollback: boolean;
  lastSuccessfulUpgrade?: {
    id: string;
    fromVersion: string;
    toVersion: string;
    backupId?: string;
    completedAt: Date;
  };
  reason?: string;
}

export interface UpgradeAuditEntry {
  id: string;
  fromVersion: string;
  toVersion: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  backupId: string | null;
  errorMessage: string | null;
  checksPassed: Record<string, unknown> | null;
}

/**
 * RollbackService
 *
 * Handles failed upgrade recovery by restoring the database from a backup
 * and recording the rollback operation in the audit log. This service
 * provides capabilities to detect when a rollback is needed and execute
 * the rollback process safely.
 */
@Injectable()
export class RollbackService {
  private readonly logger = new Logger(RollbackService.name);
  private readonly prisma: PrismaClient;

  constructor(private readonly databaseBackupService: DatabaseBackupService) {
    this.prisma = new PrismaClient();
  }

  /**
   * Check if a rollback is possible and retrieve the last successful upgrade.
   *
   * @returns RollbackCapability indicating whether rollback is possible
   */
  async checkRollbackCapability(): Promise<RollbackCapability> {
    try {
      // Find the most recent successful upgrade with a backup
      const lastSuccessful = await this.prisma.upgradeAuditLog.findFirst({
        where: {
          status: 'COMPLETED',
          backupId: {
            not: null,
          },
        },
        orderBy: {
          completedAt: 'desc',
        },
      });

      if (!lastSuccessful) {
        return {
          canRollback: false,
          reason: 'No successful upgrade with a backup found',
        };
      }

      return {
        canRollback: true,
        lastSuccessfulUpgrade: {
          id: lastSuccessful.id,
          fromVersion: lastSuccessful.fromVersion,
          toVersion: lastSuccessful.toVersion,
          backupId: lastSuccessful.backupId ?? undefined,
          completedAt: lastSuccessful.completedAt!,
        },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to check rollback capability: ${errorMessage}`);
      return {
        canRollback: false,
        reason: `Database error: ${errorMessage}`,
      };
    }
  }

  /**
   * Execute a rollback to the previous version.
   *
   * @param upgradeId The ID of the upgrade to roll back (optional, defaults to most recent)
   * @returns RollbackResult with the outcome of the rollback operation
   */
  async executeRollback(upgradeId?: string): Promise<RollbackResult> {
    const startTime = Date.now();
    const timestamp = new Date();

    this.logger.log('Starting upgrade rollback process');

    try {
      // Find the upgrade to roll back
      const upgrade = upgradeId
        ? await this.prisma.upgradeAuditLog.findUnique({
            where: { id: upgradeId },
          })
        : await this.prisma.upgradeAuditLog.findFirst({
            where: {
              status: 'COMPLETED',
            },
            orderBy: {
              completedAt: 'desc',
            },
          });

      if (!upgrade) {
        return {
          success: false,
          timestamp,
          error: 'No upgrade found to roll back',
        };
      }

      if (!upgrade.backupId) {
        return {
          success: false,
          timestamp,
          error: 'Upgrade does not have an associated backup for rollback',
        };
      }

      // Find the backup file
      const backups = this.databaseBackupService.listBackups();
      const backup = backups.find(
        (b) =>
          b.filename.includes(upgrade.backupId!) || b.path === upgrade.backupId,
      );

      if (!backup) {
        return {
          success: false,
          timestamp,
          error: `Backup file not found: ${upgrade.backupId}`,
        };
      }

      // Verify backup is valid
      if (!this.databaseBackupService.verifyBackup(backup.path)) {
        return {
          success: false,
          timestamp,
          error: `Backup file is invalid or corrupted: ${backup.path}`,
        };
      }

      // Execute the restore
      this.logger.log(`Restoring database from backup: ${backup.filename}`);
      const restoreResult = await this.databaseBackupService.restoreBackup(
        backup.path,
      );

      if (!restoreResult.success) {
        // Record failed rollback attempt
        await this.recordRollbackAttempt(upgrade, false, restoreResult.error);

        return {
          success: false,
          rollbackVersion: upgrade.toVersion,
          previousVersion: upgrade.fromVersion,
          duration: Date.now() - startTime,
          error: restoreResult.error,
          timestamp,
        };
      }

      // Record successful rollback
      const rollbackEntry = await this.recordRollbackAttempt(
        upgrade,
        true,
        undefined,
        backup.path,
      );

      const duration = Date.now() - startTime;

      this.logger.log(
        `Rollback completed successfully in ${(duration / 1000).toFixed(1)}s: ` +
          `${upgrade.toVersion} -> ${upgrade.fromVersion}`,
      );

      return {
        success: true,
        rollbackVersion: upgrade.fromVersion,
        previousVersion: upgrade.toVersion,
        backupRestored: true,
        backupPath: backup.path,
        duration,
        timestamp,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const duration = Date.now() - startTime;

      this.logger.error(`Rollback failed after ${duration}ms: ${errorMessage}`);

      return {
        success: false,
        duration,
        error: errorMessage,
        timestamp,
      };
    }
  }

  /**
   * Get the upgrade history for audit purposes.
   *
   * @param limit Maximum number of entries to return (default: 10)
   * @returns Array of upgrade audit entries
   */
  async getUpgradeHistory(limit = 10): Promise<UpgradeAuditEntry[]> {
    try {
      const entries = await this.prisma.upgradeAuditLog.findMany({
        orderBy: {
          startedAt: 'desc',
        },
        take: limit,
      });

      return entries.map((entry) => {
        const details = (entry.details ?? {}) as Record<string, unknown>;
        return {
          id: entry.id,
          fromVersion: entry.fromVersion,
          toVersion: entry.toVersion,
          status: entry.status,
          startedAt: entry.startedAt,
          completedAt: entry.completedAt,
          backupId: entry.backupId,
          errorMessage: (details.errorMessage as string | null) ?? null,
          checksPassed:
            (details.checksPassed as Record<string, unknown> | null) ?? null,
        };
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to retrieve upgrade history: ${errorMessage}`);
      return [];
    }
  }

  /**
   * Get the status of the most recent upgrade.
   *
   * @returns The most recent upgrade audit entry or null
   */
  async getLatestUpgradeStatus(): Promise<UpgradeAuditEntry | null> {
    try {
      const entry = await this.prisma.upgradeAuditLog.findFirst({
        orderBy: {
          startedAt: 'desc',
        },
      });

      if (!entry) {
        return null;
      }

      const details = (entry.details ?? {}) as Record<string, unknown>;
      return {
        id: entry.id,
        fromVersion: entry.fromVersion,
        toVersion: entry.toVersion,
        status: entry.status,
        startedAt: entry.startedAt,
        completedAt: entry.completedAt,
        backupId: entry.backupId,
        errorMessage: (details.errorMessage as string | null) ?? null,
        checksPassed:
          (details.checksPassed as Record<string, unknown> | null) ?? null,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to get latest upgrade status: ${errorMessage}`);
      return null;
    }
  }

  /**
   * Record a rollback attempt in the audit log.
   *
   * @param originalUpgrade The original upgrade being rolled back
   * @param success Whether the rollback was successful
   * @param error Error message if rollback failed
   * @param backupPath Path to the backup used for rollback
   * @returns The created audit log entry
   */
  private async recordRollbackAttempt(
    originalUpgrade: {
      id: string;
      fromVersion: string;
      toVersion: string;
      startedAt?: Date;
    },
    success: boolean,
    error?: string,
    backupPath?: string,
  ): Promise<{ id: string }> {
    const now = new Date();

    return await this.prisma.upgradeAuditLog.create({
      data: {
        fromVersion: originalUpgrade.toVersion,
        toVersion: originalUpgrade.fromVersion,
        status: success ? 'ROLLBACK_COMPLETED' : 'ROLLBACK_FAILED',
        startedAt: originalUpgrade.startedAt ?? now,
        completedAt: now,
        initiatedBy: 'ROLLBACK_SERVICE',
        backupId: backupPath ?? null,
        rollbackTriggered: true,
        details: {
          rollbackFromVersion: originalUpgrade.toVersion,
          errorMessage: error ?? null,
        },
      },
    });
  }

  /**
   * Clean up Prisma client connections.
   */
  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
