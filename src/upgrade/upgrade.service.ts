import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { execFileSync } from 'child_process';
import { PreUpgradeValidatorService } from './pre-upgrade-validator.service.js';
import {
  DatabaseBackupService,
  BackupResult,
} from './database-backup.service.js';
import { ConfigCompatibilityService } from './config-compatibility.service.js';
import { RollbackService } from './rollback.service.js';
import { UpgradeHealthService } from './upgrade-health.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { APP_VERSION } from '../versioning/app-version.js';

/**
 * Upgrade stage enumeration tracking progress through the upgrade workflow.
 */
export enum UpgradeStage {
  INITIALIZATION = 'INITIALIZATION',
  PRE_VALIDATION = 'PRE_VALIDATION',
  BACKUP = 'BACKUP',
  CONFIG_CHECK = 'CONFIG_CHECK',
  DATABASE_MIGRATION = 'DATABASE_MIGRATION',
  POST_HEALTH_CHECK = 'POST_HEALTH_CHECK',
  COMPLETION = 'COMPLETION',
  FAILED = 'FAILED',
  ROLLBACK = 'ROLLBACK',
}

/**
 * Result of a single upgrade stage execution.
 */
export interface UpgradeStageResult {
  stage: UpgradeStage;
  success: boolean;
  message: string;
  duration: number;
  details?: string;
}

/**
 * Result of a complete upgrade operation.
 */
export interface UpgradeResult {
  success: boolean;
  upgradeId?: string;
  fromVersion?: string;
  toVersion: string;
  stages: UpgradeStageResult[];
  backupResult?: BackupResult;
  rollbackTriggered: boolean;
  duration: number;
  error?: string;
}

/**
 * Current state of an upgrade operation (for progress tracking).
 */
export interface UpgradeState {
  upgradeId: string;
  stage: UpgradeStage;
  fromVersion: string;
  toVersion: string;
  startedAt: Date;
  stages: UpgradeStageResult[];
}

/**
 * UpgradeService
 *
 * Orchestrates the complete Idenplane upgrade flow, coordinating all
 * validation, backup, migration, and health-check services. This service
 * provides:
 *   - Sequential upgrade stages with progress tracking
 *   - Automatic rollback on failure (when possible)
 *   - Comprehensive audit logging to the upgrade_audit_log table
 *   - Dry-run mode for pre-flight validation without actual changes
 */
@Injectable()
export class UpgradeService {
  private readonly logger = new Logger(UpgradeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly preUpgradeValidator: PreUpgradeValidatorService,
    private readonly databaseBackupService: DatabaseBackupService,
    private readonly configCompatibility: ConfigCompatibilityService,
    private readonly rollbackService: RollbackService,
    private readonly upgradeHealthService: UpgradeHealthService,
  ) {}

  /**
   * Execute a complete upgrade to the target version.
   *
   * Stages:
   *  1. INITIALIZATION  - Initialize upgrade and record start
   *  2. PRE_VALIDATION  - Run pre-upgrade validation checks
   *  3. BACKUP          - Create database backup
   *  4. CONFIG_CHECK    - Verify configuration compatibility
   *  5. DATABASE_MIGRATION - Run Prisma migrations
   *  6. POST_HEALTH_CHECK - Verify system health after upgrade
   *  7. COMPLETION      - Record successful completion
   *
   * If any stage fails and PRE_VALIDATION passed, a rollback is attempted.
   *
   * @param toVersion Target version to upgrade to
   * @param options Optional parameters (dryRun, force, initiatedBy)
   * @returns UpgradeResult with the outcome of each stage
   */
  async upgrade(
    toVersion: string,
    options: {
      dryRun?: boolean;
      force?: boolean;
      initiatedBy?: string;
      note?: string;
      ipAddress?: string;
    } = {},
  ): Promise<UpgradeResult> {
    // Two guards against concurrent upgrades, because two processes running
    // `prisma migrate deploy` against one database is a corruption scenario,
    // not merely a race. docker-compose.cluster.yml runs two app replicas and
    // the Helm chart supports autoscaling, so this is a real configuration.
    //
    // A dry run writes nothing, so it is exempt.
    if (options.dryRun) {
      return this.runUpgrade(toVersion, options);
    }

    await this.assertNoUpgradeInProgress(toVersion);

    // finally, not a reset at each return site: runUpgrade has a dozen exit
    // paths and a missed one would wedge this instance until it restarts.
    try {
      return await this.runUpgrade(toVersion, options);
    } finally {
      this.inFlight = false;
    }
  }

  private async runUpgrade(
    toVersion: string,
    options: {
      dryRun?: boolean;
      force?: boolean;
      initiatedBy?: string;
      note?: string;
      ipAddress?: string;
    },
  ): Promise<UpgradeResult> {
    const startTime = Date.now();
    const {
      dryRun = false,
      force = false,
      initiatedBy = 'CLI',
      note,
      ipAddress,
    } = options;
    const upgradeId = this.generateUpgradeId();
    const stages: UpgradeStageResult[] = [];

    this.logger.log(
      `Starting upgrade to ${toVersion} (ID: ${upgradeId})${dryRun ? ' [DRY RUN]' : ''}`,
    );

    // Stage 1: Initialization
    const initResult = await this.executeStage(
      UpgradeStage.INITIALIZATION,
      () =>
        this.initializeUpgrade(upgradeId, toVersion, initiatedBy, dryRun, {
          note,
          ipAddress,
        }),
    );
    stages.push(initResult);

    if (!initResult.success) {
      return this.buildFailureResult(
        upgradeId,
        toVersion,
        stages,
        startTime,
        initResult.message,
      );
    }

    // Stage 2: Pre-upgrade validation
    const preValidationResult = await this.executeStage(
      UpgradeStage.PRE_VALIDATION,
      () => this.runPreValidation(toVersion, force),
    );
    stages.push(preValidationResult);

    if (!preValidationResult.success) {
      this.logger.error('Pre-upgrade validation failed. Aborting upgrade.');
      await this.recordUpgradeFailure(
        upgradeId,
        toVersion,
        stages,
        'Pre-upgrade validation failed',
      );
      return this.buildFailureResult(
        upgradeId,
        toVersion,
        stages,
        startTime,
        preValidationResult.message,
      );
    }

    // Stage 3: Database backup (skip in dry-run)
    let backupResult: BackupResult | undefined;
    if (!dryRun) {
      const backupStageResult = await this.executeStage(
        UpgradeStage.BACKUP,
        async () => {
          backupResult = this.databaseBackupService.createBackup(
            `pre-upgrade-${toVersion}`,
          );
          if (!backupResult.success) {
            throw new Error(`Backup failed: ${backupResult.error}`);
          }

          // Record the backup on the audit row NOW, not at completion.
          //
          // completeUpgrade() used to recover this by regexing its own log
          // message (/Backup created: (.+)/), which meant the row carried
          // backupId = null for the entire window in which an upgrade can
          // fail. attemptRollback() looks the row up and bails with "Upgrade
          // does not have an associated backup for rollback" when backupId is
          // null — so the automatic rollback was unreachable in exactly the
          // situation it exists for.
          await this.prisma.upgradeAuditLog.update({
            where: { id: upgradeId },
            data: {
              backupId: backupResult.backupPath,
              backupPath: backupResult.backupPath,
              backupSize: backupResult.backupSize,
            },
          });

          return {
            success: true,
            message: `Backup created: ${backupResult.backupPath}`,
            details: `Size: ${backupResult.backupSize}`,
          };
        },
      );
      stages.push(backupStageResult);

      if (!backupStageResult.success) {
        this.logger.error('Database backup failed. Aborting upgrade.');
        await this.recordUpgradeFailure(
          upgradeId,
          toVersion,
          stages,
          'Backup failed',
        );
        return this.buildFailureResult(
          upgradeId,
          toVersion,
          stages,
          startTime,
          backupStageResult.message,
        );
      }
    } else {
      stages.push({
        stage: UpgradeStage.BACKUP,
        success: true,
        message: 'Backup skipped (dry-run mode)',
        duration: 0,
      });
    }

    // Stage 4: Configuration compatibility check
    const configResult = await this.executeStage(
      UpgradeStage.CONFIG_CHECK,
      () => this.checkConfigCompatibility(toVersion),
    );
    stages.push(configResult);

    if (!configResult.success) {
      this.logger.error(
        'Configuration compatibility check failed. Aborting upgrade.',
      );
      await this.recordUpgradeFailure(
        upgradeId,
        toVersion,
        stages,
        'Configuration incompatibility',
      );
      return this.buildFailureResult(
        upgradeId,
        toVersion,
        stages,
        startTime,
        configResult.message,
      );
    }

    // Stage 5: Database migration (skip in dry-run)
    if (!dryRun) {
      const migrationResult = await this.executeStage(
        UpgradeStage.DATABASE_MIGRATION,
        () => this.runDatabaseMigration(toVersion),
      );
      stages.push(migrationResult);

      if (!migrationResult.success) {
        this.logger.error('Database migration failed.');
        // Attempt rollback if backup was created
        if (backupResult?.success) {
          const rollbackResult = await this.attemptRollback(
            upgradeId,
            toVersion,
            backupResult,
          );
          stages.push(rollbackResult);
        }
        await this.recordUpgradeFailure(
          upgradeId,
          toVersion,
          stages,
          'Database migration failed',
        );
        return this.buildFailureResult(
          upgradeId,
          toVersion,
          stages,
          startTime,
          migrationResult.message,
        );
      }
    } else {
      stages.push({
        stage: UpgradeStage.DATABASE_MIGRATION,
        success: true,
        message: 'Migration skipped (dry-run mode)',
        duration: 0,
      });
    }

    // Stage 6: Post-upgrade health check
    const healthResult = await this.executeStage(
      UpgradeStage.POST_HEALTH_CHECK,
      () => this.runPostHealthCheck(toVersion),
    );
    stages.push(healthResult);

    if (!healthResult.success) {
      this.logger.error('Post-upgrade health check failed.');
      // Attempt rollback if backup was created
      if (backupResult?.success) {
        const rollbackResult = await this.attemptRollback(
          upgradeId,
          toVersion,
          backupResult,
        );
        stages.push(rollbackResult);
      }
      await this.recordUpgradeFailure(
        upgradeId,
        toVersion,
        stages,
        'Post-upgrade health check failed',
      );
      return this.buildFailureResult(
        upgradeId,
        toVersion,
        stages,
        startTime,
        healthResult.message,
      );
    }

    // Stage 7: Completion
    const completionResult = await this.executeStage(
      UpgradeStage.COMPLETION,
      async () => {
        return this.completeUpgrade(upgradeId, toVersion, stages, initiatedBy);
      },
    );
    stages.push(completionResult);

    const duration = Date.now() - startTime;

    this.logger.log(
      `Upgrade completed successfully${dryRun ? ' (DRY RUN)' : ''}: ${toVersion} in ${(duration / 1000).toFixed(1)}s`,
    );

    return {
      success: true,
      upgradeId,
      toVersion,
      stages,
      backupResult,
      rollbackTriggered: false,
      duration,
    };
  }

  /**
   * Get the current upgrade state for a given upgrade ID.
   *
   * @param upgradeId The upgrade ID to look up
   * @returns UpgradeState or null if not found
   */
  async getUpgradeState(upgradeId: string): Promise<UpgradeState | null> {
    try {
      const entry = await this.prisma.upgradeAuditLog.findUnique({
        where: { id: upgradeId },
      });

      if (!entry) {
        return null;
      }

      // Determine current stage from status
      let stage = UpgradeStage.INITIALIZATION;
      if (entry.status === 'IN_PROGRESS') {
        stage = UpgradeStage.PRE_VALIDATION;
      } else if (entry.status === 'COMPLETED') {
        stage = UpgradeStage.COMPLETION;
      } else if (entry.status.startsWith('ROLLBACK')) {
        stage = UpgradeStage.ROLLBACK;
      } else if (entry.status === 'FAILED') {
        stage = UpgradeStage.FAILED;
      }

      return {
        upgradeId: entry.id,
        stage,
        fromVersion: entry.fromVersion,
        toVersion: entry.toVersion,
        startedAt: entry.startedAt,
        stages: [],
      };
    } catch (err) {
      this.logger.error('Failed to get upgrade state', err);
      return null;
    }
  }

  /**
   * Get the most recent upgrade status.
   *
   * @returns Most recent upgrade audit entry or null
   */
  async getLatestUpgradeStatus(): Promise<{
    id: string;
    fromVersion: string;
    toVersion: string;
    status: string;
    startedAt: Date;
    completedAt: Date | null;
  } | null> {
    try {
      const entry = await this.prisma.upgradeAuditLog.findFirst({
        orderBy: { startedAt: 'desc' },
      });

      if (!entry) {
        return null;
      }

      return {
        id: entry.id,
        fromVersion: entry.fromVersion,
        toVersion: entry.toVersion,
        status: entry.status,
        startedAt: entry.startedAt,
        completedAt: entry.completedAt,
      };
    } catch (err) {
      this.logger.error('Failed to get latest upgrade status', err);
      return null;
    }
  }

  /**
   * Execute a single upgrade stage with timing.
   */
  private async executeStage(
    stage: UpgradeStage,
    fn: () =>
      | Promise<{ success: boolean; message: string; details?: string }>
      | { success: boolean; message: string; details?: string },
  ): Promise<UpgradeStageResult> {
    const stageStartTime = Date.now();
    this.logger.log(`[${stage}] Starting stage`);

    try {
      const result = await fn();
      const duration = Date.now() - stageStartTime;

      this.logger.log(
        `[${stage}] ${result.success ? 'Completed' : 'Failed'}: ${result.message}`,
      );

      return {
        stage,
        success: result.success,
        message: result.message,
        duration,
        details: result.details,
      };
    } catch (err) {
      const duration = Date.now() - stageStartTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      this.logger.error(`[${stage}] Error: ${errorMessage}`);

      return {
        stage,
        success: false,
        message: errorMessage,
        duration,
      };
    }
  }

  /**
   * Refuse to start when another upgrade is already running.
   *
   * Two layers, because they fail differently:
   *
   *   1. An in-process flag catches a double-submit against this instance,
   *      which the database check cannot: the losing request may arrive before
   *      the winner's audit row is committed.
   *   2. An IN_PROGRESS audit row catches a second *instance* — the case that
   *      actually matters, since docker-compose.cluster.yml runs two replicas.
   *
   * Deliberately not pg_advisory_lock: a session-level advisory lock needs a
   * pinned connection, which the PrismaPg pool does not guarantee, and the
   * transaction-scoped variant would have to wrap the entire upgrade — which
   * would deadlock against `prisma migrate deploy`.
   *
   * The TTL exists because a process killed mid-upgrade leaves its row
   * IN_PROGRESS forever, and a stale row must not permanently wedge the
   * endpoint. It is bounded rather than absent so a genuinely running upgrade
   * is not overrun.
   */
  private static readonly IN_PROGRESS_TTL_MS = 2 * 60 * 60 * 1000;
  private inFlight = false;

  private async assertNoUpgradeInProgress(toVersion: string): Promise<void> {
    if (this.inFlight) {
      throw new ConflictException(
        'An upgrade is already running on this instance.',
      );
    }

    const cutoff = new Date(Date.now() - UpgradeService.IN_PROGRESS_TTL_MS);
    const running = await this.prisma.upgradeAuditLog.findFirst({
      where: { status: 'IN_PROGRESS', startedAt: { gte: cutoff } },
      orderBy: { startedAt: 'desc' },
    });

    if (running) {
      throw new ConflictException(
        `An upgrade to ${running.toVersion} started at ` +
          `${running.startedAt.toISOString()} is still in progress ` +
          `(id ${running.id}). Refusing to start an upgrade to ${toVersion} ` +
          'concurrently — two migrations against one database can corrupt it. ' +
          'If that upgrade is known to have died, mark its row FAILED.',
      );
    }

    this.inFlight = true;
  }

  /**
   * Initialize a new upgrade operation and record it in the audit log.
   */
  private async initializeUpgrade(
    upgradeId: string,
    toVersion: string,
    initiatedBy: string,
    dryRun: boolean,
    meta: { note?: string; ipAddress?: string } = {},
  ): Promise<{ success: boolean; message: string }> {
    try {
      const currentVersion = this.getCurrentVersion();

      await this.prisma.upgradeAuditLog.create({
        data: {
          id: upgradeId,
          fromVersion: currentVersion,
          toVersion,
          status: 'IN_PROGRESS',
          startedAt: new Date(),
          initiatedBy,
          // Schema column that has existed since the table was created and was
          // never written. Who ran an upgrade and from where is exactly what an
          // audit log of a destructive operation is for.
          ipAddress: meta.ipAddress ?? null,
          dryRun,
          details: {
            dryRun,
            initiatedBy,
            ...(meta.note ? { note: meta.note } : {}),
          },
        },
      });

      return {
        success: true,
        message: `Upgrade initialized: ${currentVersion} -> ${toVersion}`,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        message: `Failed to initialize upgrade: ${errorMessage}`,
      };
    }
  }

  /**
   * Run pre-upgrade validation checks.
   */
  private async runPreValidation(
    toVersion: string,
    force: boolean,
  ): Promise<{ success: boolean; message: string; details?: string }> {
    const validation = await this.preUpgradeValidator.validate(toVersion);

    if (!validation.canProceed && !force) {
      const failures = validation.checks.filter((c) => c.status === 'fail');
      const failureMessages = failures
        .map((f) => `${f.name}: ${f.message}`)
        .join('; ');
      return {
        success: false,
        message: `Pre-validation failed with ${failures.length} failure(s)`,
        details: failureMessages,
      };
    }

    const warnings = validation.checks.filter(
      (c) => c.status === 'warn',
    ).length;
    return {
      success: true,
      message: `Pre-validation passed (${validation.summary.passed} passed, ${warnings} warnings)`,
      details: `Validation can proceed: ${validation.canProceed}`,
    };
  }

  /**
   * Check configuration compatibility with the target version.
   */
  private async checkConfigCompatibility(
    toVersion: string,
  ): Promise<{ success: boolean; message: string; details?: string }> {
    const compatResult =
      await this.configCompatibility.checkCompatibility(toVersion);

    if (!compatResult.compatible) {
      const errors = compatResult.issues.filter((i) => i.type === 'error');
      const errorMessages = errors
        .map((e) => `${e.path}: ${e.message}`)
        .join('; ');
      return {
        success: false,
        message: `Configuration incompatible with ${toVersion}`,
        details: errorMessages,
      };
    }

    const warnings = compatResult.issues.filter(
      (i) => i.type === 'warning',
    ).length;
    return {
      success: true,
      message: `Configuration compatible with ${toVersion}`,
      details: `${warnings} warning(s) found`,
    };
  }

  /**
   * Run Prisma database migrations.
   */
  private runDatabaseMigration(toVersion: string): {
    success: boolean;
    message: string;
    details?: string;
  } {
    try {
      this.logger.log(`Running database migrations for ${toVersion}...`);

      // execFileSync, not execSync: no shell means no `2>&1` redirect to parse
      // and nothing interpretable in the argument vector. The explicit --schema
      // matters because prisma.config.ts is not present in the production image
      // (docker-entrypoint.sh generates a prisma.config.js at runtime, which
      // will not exist if the process was started any other way).
      // Run Prisma's CLI entrypoint with this process's own node binary rather
      // than going through `npx`. npx is a shell script on POSIX and npx.cmd on
      // Windows, and execFileSync deliberately does not use a shell — so the
      // bare name is ENOENT on Windows and the .cmd is EINVAL (Node refuses to
      // exec a batch file without a shell since CVE-2024-27980). Resolving the
      // entrypoint avoids the shell entirely on every platform and does not
      // depend on PATH. `prisma` is a regular dependency, so it survives the
      // `npm prune --omit=dev` in the production image.
      const output = execFileSync(
        process.execPath,
        [
          require.resolve('prisma/build/index.js'),
          'migrate',
          'deploy',
          '--schema',
          'prisma/schema.prisma',
        ],
        {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 10 * 60 * 1000,
          maxBuffer: 10 * 1024 * 1024,
        },
      );

      return {
        success: true,
        message: 'Database migrations applied successfully',
        details: output.trim().split('\n').slice(-3).join(' '),
      };
    } catch (err: unknown) {
      const output =
        err instanceof Error && 'stdout' in err
          ? String((err as NodeJS.ErrnoException & { stdout?: Buffer }).stdout)
          : String(err);

      return {
        success: false,
        message: 'Database migration failed',
        details: output.trim(),
      };
    }
  }

  /**
   * Run post-upgrade health checks.
   */
  private async runPostHealthCheck(
    toVersion: string,
  ): Promise<{ success: boolean; message: string; details?: string }> {
    const healthResult = await this.upgradeHealthService.checkHealth(toVersion);

    if (!healthResult.healthy) {
      const failures = healthResult.checks.filter((c) => c.status === 'fail');
      const failureMessages = failures
        .map((f) => `${f.name}: ${f.message}`)
        .join('; ');
      return {
        success: false,
        message: `Health check failed with ${failures.length} failure(s)`,
        details: failureMessages,
      };
    }

    return {
      success: true,
      message: 'All health checks passed',
      details: `${healthResult.summary.passed} passed, ${healthResult.summary.warnings} warnings`,
    };
  }

  /**
   * Record successful completion of upgrade.
   */
  private async completeUpgrade(
    upgradeId: string,
    toVersion: string,
    stages: UpgradeStageResult[],
    initiatedBy: string,
  ): Promise<{ success: boolean; message: string }> {
    void initiatedBy;
    try {
      const stageNames = stages.filter((s) => s.success).map((s) => s.stage);

      // backupId is deliberately not written here: the BACKUP stage persists it
      // the moment the archive exists, which is what makes it available to
      // attemptRollback() on the failure path. Re-deriving it from a log message
      // at completion (the previous behaviour) both duplicated the write and
      // made it useless, since an upgrade that fails never reaches completion.
      await this.prisma.upgradeAuditLog.update({
        where: { id: upgradeId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),

          details: {
            stepsCompleted: stageNames,
          },
        },
      });

      return {
        success: true,
        message: `Upgrade to ${toVersion} completed successfully`,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        message: `Failed to record completion: ${errorMessage}`,
      };
    }
  }

  private async attemptRollback(
    upgradeId: string,
    toVersion: string,
    backupResult: BackupResult,
  ): Promise<UpgradeStageResult> {
    void toVersion;
    void backupResult;
    const stageStartTime = Date.now();

    try {
      this.logger.log('Attempting rollback due to upgrade failure...');

      const rollbackResult =
        await this.rollbackService.executeRollback(upgradeId);

      if (rollbackResult.success) {
        return {
          stage: UpgradeStage.ROLLBACK,
          success: true,
          message: 'Rollback completed successfully',
          duration: Date.now() - stageStartTime,
          details: `Restored to ${rollbackResult.rollbackVersion}`,
        };
      }

      return {
        stage: UpgradeStage.ROLLBACK,
        success: false,
        message: `Rollback failed: ${rollbackResult.error}`,
        duration: Date.now() - stageStartTime,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        stage: UpgradeStage.ROLLBACK,
        success: false,
        message: `Rollback error: ${errorMessage}`,
        duration: Date.now() - stageStartTime,
      };
    }
  }

  /**
   * Record upgrade failure in the audit log.
   */
  private async recordUpgradeFailure(
    upgradeId: string,
    toVersion: string,
    stages: UpgradeStageResult[],
    reason: string,
  ): Promise<void> {
    try {
      const failedStages = stages.filter((s) => !s.success).map((s) => s.stage);
      const completedStages = stages
        .filter((s) => s.success)
        .map((s) => s.stage);

      await this.prisma.upgradeAuditLog.update({
        where: { id: upgradeId },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          details: {
            errorMessage: reason,
            stepsCompleted: completedStages,
            stepsFailed: failedStages,
          },
        },
      });
    } catch (err) {
      this.logger.error('Failed to record upgrade failure', err);
    }
  }

  /**
   * Build a failure result object.
   */
  private buildFailureResult(
    upgradeId: string,
    toVersion: string,
    stages: UpgradeStageResult[],
    startTime: number,
    errorMessage: string,
  ): UpgradeResult {
    return {
      success: false,
      upgradeId,
      toVersion,
      stages,
      rollbackTriggered: stages.some(
        (s) => s.stage === UpgradeStage.ROLLBACK && s.success,
      ),
      duration: Date.now() - startTime,
      error: errorMessage,
    };
  }

  /**
   * Get the current Idenplane version.
   *
   * Previously shelled out to `node -p "require("./package.json").version"`.
   * The shell stripped the inner quotes, so node evaluated
   * `require(./package.json).version` — a SyntaxError — and the catch returned
   * 'unknown' every single time. Every upgrade_audit_log.fromVersion written
   * before this fix therefore reads 'unknown'. APP_VERSION reads the same
   * package.json directly and is already used by the versioning module.
   */
  getCurrentVersion(): string {
    return APP_VERSION;
  }

  /**
   * Generate a unique upgrade ID.
   */
  private generateUpgradeId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `upg-${timestamp}-${random}`;
  }
}
