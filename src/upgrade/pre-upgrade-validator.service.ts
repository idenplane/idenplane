import { Injectable, Logger } from '@nestjs/common';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service.js';
import { DatabaseBackupService } from './database-backup.service.js';

export interface PreUpgradeCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  details?: string;
}

export interface PreUpgradeValidationResult {
  canProceed: boolean;
  checks: PreUpgradeCheck[];
  summary: {
    passed: number;
    warnings: number;
    failures: number;
  };
}

/**
 * PreUpgradeValidatorService
 *
 * Runs a suite of pre-upgrade validation checks against the database and
 * runtime environment before an upgrade is attempted.  It validates:
 *   - Database connection and schema integrity
 *   - Pending Prisma migrations
 *   - Required disk space for backups
 *   - Database disk space
 *   - Locked sessions or transactions that could block migrations
 *   - Connection pool availability
 */
@Injectable()
export class PreUpgradeValidatorService {
  private readonly logger = new Logger(PreUpgradeValidatorService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly databaseBackupService: DatabaseBackupService,
  ) {}

  /**
   * Run all pre-upgrade validation checks.
   *
   * @param targetVersion The version being upgraded to (optional, for informational purposes)
   * @returns Validation result with pass/warn/fail status for each check
   */
  async validate(_targetVersion?: string): Promise<PreUpgradeValidationResult> {
    this.logger.log('Starting pre-upgrade validation checks...');

    const checks: PreUpgradeCheck[] = [];
    let passed = 0;
    let warnings = 0;
    let failures = 0;

    // 1. Database connection check
    const dbCheck = await this.checkDatabaseConnection();
    checks.push(dbCheck);
    if (dbCheck.status === 'pass') passed++;
    else if (dbCheck.status === 'warn') warnings++;
    else failures++;

    // 2. Pending migrations check
    const migrationCheck = this.checkPendingMigrations();
    checks.push(migrationCheck);
    if (migrationCheck.status === 'pass') passed++;
    else if (migrationCheck.status === 'warn') warnings++;
    else failures++;

    // 3. Disk space check
    const diskCheck = this.checkDiskSpace();
    checks.push(diskCheck);
    if (diskCheck.status === 'pass') passed++;
    else if (diskCheck.status === 'warn') warnings++;
    else failures++;

    // 4. Database size check
    const dbSizeCheck = await this.checkDatabaseSize();
    checks.push(dbSizeCheck);
    if (dbSizeCheck.status === 'pass') passed++;
    else if (dbSizeCheck.status === 'warn') warnings++;
    else failures++;

    // 5. Active connections check
    const connCheck = await this.checkActiveConnections();
    checks.push(connCheck);
    if (connCheck.status === 'pass') passed++;
    else if (connCheck.status === 'warn') warnings++;
    else failures++;

    // 6. Long-running transactions check
    const txCheck = await this.checkLongRunningTransactions();
    checks.push(txCheck);
    if (txCheck.status === 'pass') passed++;
    else if (txCheck.status === 'warn') warnings++;
    else failures++;

    // 7. Backup tooling — a hard failure, deliberately.
    //
    // Without pg_dump the upgrade would previously get all the way to the BACKUP
    // stage before discovering it cannot take one, and a failure any time after
    // DATABASE_MIGRATION would then have nothing to roll back to. Failing here
    // aborts before anything has been touched.
    const toolingCheck = this.checkBackupTooling();
    checks.push(toolingCheck);
    if (toolingCheck.status === 'pass') passed++;
    else if (toolingCheck.status === 'warn') warnings++;
    else failures++;

    // 8. Backup directory must be writable, for the same reason.
    const backupDirCheck = this.checkBackupDirectory();
    checks.push(backupDirCheck);
    if (backupDirCheck.status === 'pass') passed++;
    else if (backupDirCheck.status === 'warn') warnings++;
    else failures++;

    // 9. Client and server majors must match, or the restore silently is not
    //    one — see checkPgVersionMatch.
    const versionCheck = await this.checkPgVersionMatch();
    checks.push(versionCheck);
    if (versionCheck.status === 'pass') passed++;
    else if (versionCheck.status === 'warn') warnings++;
    else failures++;

    const canProceed = failures === 0;

    this.logger.log(
      `Pre-upgrade validation complete: ${passed} passed, ${warnings} warnings, ${failures} failures. ` +
        `Can proceed: ${canProceed}`,
    );

    return {
      canProceed,
      checks,
      summary: { passed, warnings, failures },
    };
  }

  /**
   * Check that the database connection is healthy.
   */
  private async checkDatabaseConnection(): Promise<PreUpgradeCheck> {
    try {
      await this.prisma.$connect();
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        name: 'database_connection',
        status: 'pass',
        message: 'Database connection is healthy',
      };
    } catch (err) {
      this.logger.error('Database connection check failed', err);
      return {
        name: 'database_connection',
        status: 'fail',
        message: 'Cannot connect to database',
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Check for pending Prisma migrations.
   */
  private checkPendingMigrations(): PreUpgradeCheck {
    try {
      const output = execSync('npx prisma migrate status 2>&1', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Exit code 0 means no pending migrations
      return {
        name: 'pending_migrations',
        status: 'pass',
        message: 'No pending migrations',
        details: output.trim(),
      };
    } catch (err: unknown) {
      // Exit code non-zero means there ARE pending migrations
      const output =
        err instanceof Error && 'stdout' in err
          ? String((err as NodeJS.ErrnoException & { stdout?: Buffer }).stdout)
          : String(err);

      // Parse pending migrations from output
      const pendingMigrations = this.parsePendingMigrations(output);

      if (pendingMigrations.length > 0) {
        return {
          name: 'pending_migrations',
          status: 'warn',
          message: `${pendingMigrations.length} pending migration(s) found`,
          details: pendingMigrations.join(', '),
        };
      }

      // If we can't parse pending migrations but got an error, treat as failure
      return {
        name: 'pending_migrations',
        status: 'fail',
        message: 'Unable to determine migration status',
        details: output.trim(),
      };
    }
  }

  /**
   * Parse pending migrations from Prisma migrate status output.
   */
  private parsePendingMigrations(output: string): string[] {
    const lines = output.split('\n');
    const pending: string[] = [];

    // Prisma lists pending migrations as bare names under a heading:
    //
    //   Following migration have not yet been applied:
    //   99990101000000_add_column
    //
    // Everything after that heading, up to the next blank line, is a migration
    // name. The previous implementation looked for a `[ ]` checkbox marker,
    // which Prisma does not emit — so it never matched, `pending` stayed empty,
    // and the caller fell through to its "cannot determine status" branch and
    // reported a hard FAILURE. That made canProceed false precisely when
    // migrations were pending, i.e. in the only situation an upgrade is ever
    // run: the operator's choice became "abandon" or "--force past every safety
    // check". Found by rehearsing an upgrade against a database with a genuine
    // pending migration.
    let inPendingList = false;
    for (const raw of lines) {
      const line = raw.trim();

      if (/have not yet been applied/i.test(line)) {
        inPendingList = true;
        continue;
      }

      if (inPendingList) {
        // The list ends at the first blank line or prose sentence.
        if (!line || /\s/.test(line)) {
          inPendingList = false;
          continue;
        }
        pending.push(line);
        continue;
      }

      // Kept for any Prisma version that does use a checkbox form.
      const notApplied = line.match(/\[\s*\]\s+(\S+)/);
      if (notApplied) {
        pending.push(notApplied[1]);
      }
    }

    return pending;
  }

  /**
   * Verify pg_dump / pg_restore are reachable, since the whole safety story of
   * an upgrade rests on being able to take a backup and put it back.
   */
  private checkBackupTooling(): PreUpgradeCheck {
    const { available, detail } = this.databaseBackupService.pgToolsAvailable();

    return available
      ? {
          name: 'backup_tooling',
          status: 'pass',
          message: 'Backup tooling is available',
          details: detail,
        }
      : {
          name: 'backup_tooling',
          status: 'fail',
          message:
            'Backup tooling is missing — an upgrade cannot be rolled back',
          details: detail,
        };
  }

  /**
   * The pg client major must equal the server major, or the backup cannot be
   * restored — which means there is no rollback, discovered only at the moment
   * one is needed.
   *
   * Measured, not assumed. Against a PostgreSQL 16 server:
   *
   *   pg_dump 18 → archive written fine (624 KB, PGDMP header)
   *   pg_restore 18 → ERROR: unrecognized configuration parameter
   *                   "transaction_timeout"   (added in PG 17)
   *   pg_restore 16 on that archive → ERROR: unsupported version (1.16)
   *                   in file header
   *   pg_dump 16 + pg_restore 16 → restores, rows come back
   *
   * So a newer client is not merely "the supported direction": it produces
   * backups nothing can restore onto that server. An older client is no better,
   * since pg_dump refuses to dump a newer server at all. Equality is the rule.
   *
   * This matters for the published image specifically: it installs Alpine's
   * default postgresql-client, which is currently 18, while docker-compose.yml
   * ships postgres:16-alpine. That combination has no working rollback.
   */
  /** Server major, or null if it cannot be read. server_version_num is MMmmpp. */
  private async readServerMajorVersion(): Promise<number | null> {
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{ server_version_num: string }>
      >`SHOW server_version_num`;
      const num = Number(rows[0]?.server_version_num);
      return Number.isFinite(num) ? Math.floor(num / 10000) : null;
    } catch {
      return null;
    }
  }

  private async checkPgVersionMatch(): Promise<PreUpgradeCheck> {
    const clientMajor = this.databaseBackupService.clientMajorVersion();

    if (clientMajor === null) {
      return {
        name: 'pg_client_version',
        status: 'warn',
        message: 'Could not determine the pg_dump version',
        details:
          'Unable to verify that the client and server majors match, which a ' +
          'restore requires.',
      };
    }

    const serverMajor = await this.readServerMajorVersion();

    if (serverMajor === null) {
      return {
        name: 'pg_client_version',
        status: 'warn',
        message: 'Could not determine the PostgreSQL server version',
        details: `Client is ${clientMajor}; server version unavailable.`,
      };
    }

    if (clientMajor !== serverMajor) {
      return {
        name: 'pg_client_version',
        status: 'fail',
        message: `pg client ${clientMajor} does not match server ${serverMajor}`,
        details:
          `A backup taken by pg_dump ${clientMajor} cannot be restored onto a ` +
          `PostgreSQL ${serverMajor} server, so this upgrade would have no ` +
          `rollback. Install postgresql-client ${serverMajor} (or run a ` +
          `PostgreSQL ${clientMajor} server).`,
      };
    }

    return {
      name: 'pg_client_version',
      status: 'pass',
      message: `pg client and server majors match (${clientMajor})`,
    };
  }

  /**
   * Verify the backup directory can actually be written to.
   *
   * Writes and removes a probe file rather than checking permission bits: a
   * read-only mount, a full filesystem and a wrong-uid container all present
   * differently in the metadata but identically here — as a failed write.
   */
  private checkBackupDirectory(): PreUpgradeCheck {
    const backupDir = process.env.BACKUP_DIR || './backups';
    const configured = Boolean(process.env.BACKUP_DIR);

    try {
      fs.mkdirSync(backupDir, { recursive: true });

      const probe = path.join(
        backupDir,
        `.idenplane-write-probe-${process.pid}`,
      );
      fs.writeFileSync(probe, 'probe');
      fs.unlinkSync(probe);

      if (!configured && process.env.NODE_ENV === 'production') {
        return {
          name: 'backup_directory',
          status: 'warn',
          message: 'BACKUP_DIR is not set; using the default ./backups',
          details:
            'In production this is usually a container filesystem that does not ' +
            'survive a restart. Point BACKUP_DIR at mounted, durable storage.',
        };
      }

      return {
        name: 'backup_directory',
        status: 'pass',
        message: `Backup directory is writable: ${backupDir}`,
      };
    } catch (err) {
      return {
        name: 'backup_directory',
        status: 'fail',
        message: `Backup directory is not writable: ${backupDir}`,
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Check available disk space where backups will actually be written.
   *
   * Previously shelled out to `df -k .`, which had two problems: `df` does not
   * exist on Windows (so this silently degraded to a warning on every developer
   * machine), and `.` is the process working directory, not BACKUP_DIR — the
   * check could pass on a roomy root filesystem while the mounted backup volume
   * was full. statfsSync measures the right filesystem and needs no shell.
   */
  private checkDiskSpace(): PreUpgradeCheck {
    const backupDir = process.env.BACKUP_DIR || './backups';

    try {
      // statfs needs an existing path; walk up to the nearest one that exists
      // so an as-yet-uncreated backup directory still reports its volume.
      let probe = path.resolve(backupDir);
      while (!fs.existsSync(probe)) {
        const parent = path.dirname(probe);
        if (parent === probe) break;
        probe = parent;
      }

      const stats = fs.statfsSync(probe);
      const availableBytes = stats.bavail * stats.bsize;
      const availableMb = availableBytes / (1024 * 1024);
      const availableGb = availableMb / 1024;
      const where = `${availableMb.toFixed(0)} MB available on the filesystem holding ${probe}`;

      if (availableGb >= 1) {
        return {
          name: 'disk_space',
          status: 'pass',
          message: `Sufficient disk space available: ${availableGb.toFixed(2)} GB`,
          details: where,
        };
      }

      if (availableMb >= 256) {
        return {
          name: 'disk_space',
          status: 'warn',
          message: `Low disk space: ${availableGb.toFixed(2)} GB available`,
          details: `${where} (recommended: 1 GB minimum)`,
        };
      }

      return {
        name: 'disk_space',
        status: 'fail',
        message: `Insufficient disk space: ${availableMb.toFixed(0)} MB available`,
        details: `${where}. Minimum 1 GB recommended for safe backups.`,
      };
    } catch (err) {
      return {
        name: 'disk_space',
        status: 'warn',
        message: 'Unable to check disk space',
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Check the database size and estimate backup requirements.
   * Warns if database is very large (> 10GB).
   */
  private async checkDatabaseSize(): Promise<PreUpgradeCheck> {
    try {
      // Query PostgreSQL for database size
      const result = await this.prisma.$queryRaw<
        Array<{ pg_size_pretty: string; size_bytes: bigint }>
      >`
        SELECT pg_size_pretty(pg_database_size(current_database())) as "pg_size_pretty",
               pg_database_size(current_database()) as size_bytes
      `;

      if (result.length > 0) {
        const row = result[0];
        const sizeBytes =
          typeof row.size_bytes === 'bigint'
            ? Number(row.size_bytes)
            : Number(row.size_bytes);
        const sizeGb = sizeBytes / (1024 * 1024 * 1024);

        if (sizeGb > 50) {
          return {
            name: 'database_size',
            status: 'fail',
            message: `Database is very large: ${row.pg_size_pretty}`,
            details: 'Large databases may require extended migration time',
          };
        } else if (sizeGb > 10) {
          return {
            name: 'database_size',
            status: 'warn',
            message: `Large database: ${row.pg_size_pretty}`,
            details:
              'Consider scheduling maintenance window for large database upgrades',
          };
        } else {
          return {
            name: 'database_size',
            status: 'pass',
            message: `Database size: ${row.pg_size_pretty}`,
          };
        }
      }

      return {
        name: 'database_size',
        status: 'warn',
        message: 'Unable to determine database size',
      };
    } catch (err) {
      return {
        name: 'database_size',
        status: 'warn',
        message: 'Unable to check database size',
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Check for active database connections.
   * Warns if there are many active connections (> 50).
   */
  private async checkActiveConnections(): Promise<PreUpgradeCheck> {
    try {
      const result = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) as count FROM pg_stat_activity WHERE datname = current_database()
      `;

      if (result.length > 0) {
        const count =
          typeof result[0].count === 'bigint'
            ? Number(result[0].count)
            : Number(result[0].count);

        if (count > 100) {
          return {
            name: 'active_connections',
            status: 'warn',
            message: `High number of active connections: ${count}`,
            details: 'Consider scheduling upgrade during low-traffic period',
          };
        } else {
          return {
            name: 'active_connections',
            status: 'pass',
            message: `Active connections: ${count}`,
          };
        }
      }

      return {
        name: 'active_connections',
        status: 'warn',
        message: 'Unable to determine active connections',
      };
    } catch (err) {
      return {
        name: 'active_connections',
        status: 'warn',
        message: 'Unable to check active connections',
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Check for long-running transactions that could block migrations.
   */
  private async checkLongRunningTransactions(): Promise<PreUpgradeCheck> {
    try {
      // Find transactions running longer than 30 seconds
      const result = await this.prisma.$queryRaw<
        Array<{ pid: number; duration_seconds: number; state: string }>
      >`
        SELECT pid,
               EXTRACT(EPOCH FROM (now() - state_change))::integer as duration_seconds,
               state
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND state_change < now() - interval '30 seconds'
          AND state = 'active'
        ORDER BY duration_seconds DESC
        LIMIT 5
      `;

      if (result.length > 0) {
        const longest = result[0];
        return {
          name: 'long_running_transactions',
          status: 'warn',
          message: `Found ${result.length} long-running transaction(s)`,
          details: `Longest running: ${longest.duration_seconds}s in state '${longest.state}' (PID: ${longest.pid})`,
        };
      }

      return {
        name: 'long_running_transactions',
        status: 'pass',
        message: 'No long-running transactions detected',
      };
    } catch (err) {
      return {
        name: 'long_running_transactions',
        status: 'warn',
        message: 'Unable to check for long-running transactions',
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
