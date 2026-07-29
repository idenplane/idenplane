import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { DatabaseBackupService } from './database-backup.service.js';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly databaseBackupService: DatabaseBackupService,
  ) {}

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
  /**
   * The pg_restore invocation an operator would run by hand, with the archive
   * this rollback would have used. Returned in the refusal so the 409 is
   * actionable rather than merely a "no".
   */
  private async buildManualRestoreHint(upgradeId?: string): Promise<string> {
    try {
      const upgrade = upgradeId
        ? await this.prisma.upgradeAuditLog.findUnique({
            where: { id: upgradeId },
          })
        : await this.prisma.upgradeAuditLog.findFirst({
            where: { status: 'COMPLETED' },
            orderBy: { completedAt: 'desc' },
          });

      const archive = upgrade?.backupPath ?? upgrade?.backupId;
      if (!archive) {
        return '  (no backup is recorded for that upgrade — nothing to restore)';
      }

      return (
        `  pg_restore --clean --if-exists --no-owner --no-privileges \\\n` +
        `    --single-transaction --exit-on-error \\\n` +
        `    -d "$DATABASE_URL" ${archive}`
      );
    } catch {
      return '  (could not determine the backup archive for that upgrade)';
    }
  }

  async executeRollback(upgradeId?: string): Promise<RollbackResult> {
    const startTime = Date.now();
    const timestamp = new Date();

    this.logger.log('Starting upgrade rollback process');

    // Restoring into the database this process is connected to is gated
    // separately from UPGRADE_API_ENABLED, because it is a strictly harder
    // operation than running migrations:
    //
    //   pg_restore --clean issues DROP TABLE for every object in the archive.
    //   Those DROPs need ACCESS EXCLUSIVE locks, which conflict with any query
    //   another replica is running. With more than one replica up, the restore
    //   blocks — and once it does get the lock, the other replicas are talking
    //   to a schema being dropped and recreated underneath them.
    //
    // Scaling to a single replica first is a deployment decision this service
    // cannot make or verify, so the default is to refuse and hand the operator
    // the exact command instead of half-performing it.
    if (process.env.UPGRADE_ALLOW_LIVE_RESTORE !== 'true') {
      const manual = await this.buildManualRestoreHint(upgradeId);
      this.logger.warn(
        'Rollback refused: UPGRADE_ALLOW_LIVE_RESTORE is not enabled',
      );
      return {
        success: false,
        timestamp,
        error:
          'Live database restore is disabled. Restoring over a running ' +
          'database requires exclusive locks that conflict with other ' +
          'replicas. Scale to a single instance, then either set ' +
          'UPGRADE_ALLOW_LIVE_RESTORE=true or run the restore manually:\n' +
          manual,
      };
    }

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
      const restoreResult = this.databaseBackupService.restoreBackup(
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
      await this.recordRollbackAttempt(upgrade, true, undefined, backup.path);

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
        // The rollback started now — it must not inherit the original upgrade's
        // startedAt. Copying it made the two rows tie on every
        // `orderBy: { startedAt: 'desc' }`, so getLatestUpgradeStatus() and
        // getUpgradeHistory() could return the failed upgrade *after* it had
        // been rolled back, reporting the rollback as though it never happened.
        startedAt: now,
        completedAt: now,
        initiatedBy: 'ROLLBACK_SERVICE',
        backupId: backupPath ?? null,
        rollbackTriggered: true,
        details: {
          rollbackFromVersion: originalUpgrade.toVersion,
          originalStartedAt: originalUpgrade.startedAt?.toISOString() ?? null,
          errorMessage: error ?? null,
        },
      },
    });
  }
}
