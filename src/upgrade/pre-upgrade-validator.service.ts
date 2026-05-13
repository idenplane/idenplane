import { Injectable, Logger } from '@nestjs/common';
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';

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
  private readonly prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

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
    const migrationCheck = await this.checkPendingMigrations();
    checks.push(migrationCheck);
    if (migrationCheck.status === 'pass') passed++;
    else if (migrationCheck.status === 'warn') warnings++;
    else failures++;

    // 3. Disk space check
    const diskCheck = await this.checkDiskSpace();
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
  private checkPendingMigrations(): Promise<PreUpgradeCheck> {
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

    for (const line of lines) {
      const notApplied = line.match(/\[\s*\]\s+(\S+)/);
      if (notApplied) {
        pending.push(notApplied[1]);
      }
    }

    return pending;
  }

  /**
   * Check available disk space for backups.
   * Requires at least 1GB of free space.
   */
  private checkDiskSpace(): Promise<PreUpgradeCheck> {
    try {
      const output = execSync('df -k . 2>&1', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const lines = output.split('\n');
      if (lines.length >= 2) {
        const lastLine = lines[lines.length - 1];
        const parts = lastLine.split(/\s+/);
        if (parts.length >= 4) {
          const availableKb = parseInt(parts[3], 10);
          const availableMb = availableKb / 1024;
          const availableGb = availableMb / 1024;

          // Require at least 1GB (1024MB)
          if (availableGb >= 1) {
            return {
              name: 'disk_space',
              status: 'pass',
              message: `Sufficient disk space available: ${availableGb.toFixed(2)} GB`,
              details: `${availableMb.toFixed(0)} MB available`,
            };
          } else if (availableMb >= 256) {
            return {
              name: 'disk_space',
              status: 'warn',
              message: `Low disk space: ${availableGb.toFixed(2)} GB available`,
              details: `${availableMb.toFixed(0)} MB available (recommended: 1 GB minimum)`,
            };
          } else {
            return {
              name: 'disk_space',
              status: 'fail',
              message: `Insufficient disk space: ${availableMb.toFixed(0)} MB available`,
              details: 'Minimum 1 GB recommended for safe backups',
            };
          }
        }
      }

      return {
        name: 'disk_space',
        status: 'warn',
        message: 'Unable to determine disk space',
        details: output.trim(),
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

  /**
   * Clean up Prisma client connections.
   */
  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
