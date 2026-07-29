import { Injectable, Logger } from '@nestjs/common';
import { execSync } from 'child_process';
import { PrismaService } from '../prisma/prisma.service.js';

export interface UpgradeHealthCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  details?: string;
}

export interface UpgradeHealthResult {
  healthy: boolean;
  version: string | null;
  checks: UpgradeHealthCheck[];
  summary: {
    passed: number;
    warnings: number;
    failures: number;
  };
}

/**
 * UpgradeHealthService
 *
 * Performs post-upgrade verification to ensure the system is healthy
 * after an upgrade has been applied. It validates:
 *   - Database connection and schema integrity
 *   - Applied migrations verification
 *   - Critical data integrity checks
 *   - Service connectivity (Redis, etc.)
 *   - Configuration consistency
 */

/**
 * Tables whose absence means the schema is unusable after an upgrade.
 *
 * These are the physical table names — i.e. the `@@map(...)` values in
 * prisma/schema.prisma, not the Prisma model names. They are checked against
 * `pg_tables`, which only ever sees the mapped names. `upgrade-health.service.spec.ts`
 * parses the schema and asserts every entry here still exists, so a future
 * `@@map` rename fails the suite instead of silently making every upgrade
 * abort at POST_HEALTH_CHECK.
 */
export const CRITICAL_TABLES = [
  'realms',
  'users',
  'clients',
  'roles',
  'client_scopes',
  'sessions',
  'upgrade_audit_log',
] as const;

@Injectable()
export class UpgradeHealthService {
  private readonly logger = new Logger(UpgradeHealthService.name);
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Run all post-upgrade health checks.
   *
   * @param expectedVersion The version the system should be at after upgrade
   * @returns Health check result with pass/warn/fail status for each check
   */
  async checkHealth(expectedVersion?: string): Promise<UpgradeHealthResult> {
    this.logger.log('Starting post-upgrade health checks...');

    const checks: UpgradeHealthCheck[] = [];
    let passed = 0;
    let warnings = 0;
    let failures = 0;

    // 1. Database connection check
    const dbCheck = await this.checkDatabaseConnection();
    checks.push(dbCheck);
    if (dbCheck.status === 'pass') passed++;
    else if (dbCheck.status === 'warn') warnings++;
    else failures++;

    // 2. Schema integrity check
    const schemaCheck = await this.checkSchemaIntegrity();
    checks.push(schemaCheck);
    if (schemaCheck.status === 'pass') passed++;
    else if (schemaCheck.status === 'warn') warnings++;
    else failures++;

    // 3. Migrations verification
    const migrationsCheck = this.checkMigrationsApplied();
    checks.push(migrationsCheck);
    if (migrationsCheck.status === 'pass') passed++;
    else if (migrationsCheck.status === 'warn') warnings++;
    else failures++;

    // 4. Data integrity checks
    const integrityCheck = await this.checkDataIntegrity();
    checks.push(integrityCheck);
    if (integrityCheck.status === 'pass') passed++;
    else if (integrityCheck.status === 'warn') warnings++;
    else failures++;

    // 5. Redis connectivity check
    const redisCheck = await this.checkRedisConnectivity();
    checks.push(redisCheck);
    if (redisCheck.status === 'pass') passed++;
    else if (redisCheck.status === 'warn') warnings++;
    else failures++;

    // 6. Configuration consistency check
    const configCheck = await this.checkConfigurationConsistency();
    checks.push(configCheck);
    if (configCheck.status === 'pass') passed++;
    else if (configCheck.status === 'warn') warnings++;
    else failures++;

    // 7. Critical tables verification
    const tablesCheck = await this.checkCriticalTables();
    checks.push(tablesCheck);
    if (tablesCheck.status === 'pass') passed++;
    else if (tablesCheck.status === 'warn') warnings++;
    else failures++;

    const healthy = failures === 0;

    this.logger.log(
      `Post-upgrade health check complete: ${passed} passed, ${warnings} warnings, ${failures} failures. ` +
        `System healthy: ${healthy}`,
    );

    return {
      healthy,
      version: expectedVersion ?? null,
      checks,
      summary: { passed, warnings, failures },
    };
  }

  /**
   * Check that the database connection is healthy.
   */
  private async checkDatabaseConnection(): Promise<UpgradeHealthCheck> {
    try {
      await this.prisma.$connect();
      await this.prisma.$queryRaw`SELECT 1`;

      return {
        name: 'database_connection',
        status: 'pass',
        message: 'Database connection is healthy',
      };
    } catch (err) {
      this.logger.error('Database connection health check failed', err);
      return {
        name: 'database_connection',
        status: 'fail',
        message: 'Cannot connect to database',
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Verify database schema integrity by checking all tables exist.
   */
  private async checkSchemaIntegrity(): Promise<UpgradeHealthCheck> {
    try {
      const tables = await this.prisma.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
        ORDER BY tablename
      `;

      const existingTables = new Set(tables.map((t) => t.tablename));
      const missingTables = CRITICAL_TABLES.filter(
        (t) => !existingTables.has(t),
      );

      if (missingTables.length > 0) {
        return {
          name: 'schema_integrity',
          status: 'fail',
          message: `Missing critical tables: ${missingTables.join(', ')}`,
          details: `Found ${tables.length} tables, but missing: ${missingTables.join(', ')}`,
        };
      }

      return {
        name: 'schema_integrity',
        status: 'pass',
        message: `Schema integrity verified (${tables.length} tables found)`,
        details: `All ${CRITICAL_TABLES.length} critical tables present`,
      };
    } catch (err) {
      this.logger.error('Schema integrity check failed', err);
      return {
        name: 'schema_integrity',
        status: 'fail',
        message: 'Unable to verify schema integrity',
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Verify that all migrations have been applied.
   */
  private checkMigrationsApplied(): UpgradeHealthCheck {
    try {
      const output = execSync('npx prisma migrate status 2>&1', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Exit code 0 means no pending migrations
      const pendingMigrations = this.parsePendingMigrations(output);

      if (pendingMigrations.length > 0) {
        return {
          name: 'migrations_applied',
          status: 'fail',
          message: `${pendingMigrations.length} migration(s) not applied`,
          details: pendingMigrations.join(', '),
        };
      }

      return {
        name: 'migrations_applied',
        status: 'pass',
        message: 'All migrations applied successfully',
        details: output.trim().split('\n').slice(-2).join(' '),
      };
    } catch (err: unknown) {
      const output =
        err instanceof Error && 'stdout' in err
          ? String((err as NodeJS.ErrnoException & { stdout?: Buffer }).stdout)
          : String(err);

      const pendingMigrations = this.parsePendingMigrations(output);

      if (pendingMigrations.length > 0) {
        return {
          name: 'migrations_applied',
          status: 'fail',
          message: `${pendingMigrations.length} migration(s) not applied`,
          details: pendingMigrations.join(', '),
        };
      }

      return {
        name: 'migrations_applied',
        status: 'pass',
        message: 'All migrations applied successfully',
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
   * Check referential integrity.
   *
   * Deliberately does NOT hand-write orphan queries. Every relationship here is
   * backed by a real FK constraint created by Prisma migrations, so a validated
   * constraint cannot have orphans — such a query can only ever return 0.
   *
   * What *can* actually go wrong after an upgrade or a restore is a constraint
   * left NOT VALID: `pg_restore` adds constraints without re-checking existing
   * rows, so a partial or out-of-order restore leaves them unvalidated and the
   * data underneath them unverified. That is the real post-upgrade failure mode,
   * and it is what this checks.
   */
  private async checkDataIntegrity(): Promise<UpgradeHealthCheck> {
    try {
      const unvalidated = await this.prisma.$queryRaw<
        Array<{ conname: string; table_name: string }>
      >`
        SELECT c.conname, rel.relname AS table_name
        FROM pg_constraint c
        JOIN pg_class rel ON rel.oid = c.conrelid
        JOIN pg_namespace ns ON ns.oid = rel.relnamespace
        WHERE ns.nspname = 'public'
          AND c.contype = 'f'
          AND NOT c.convalidated
        ORDER BY rel.relname, c.conname
      `;

      if (unvalidated.length > 0) {
        return {
          name: 'data_integrity',
          status: 'fail',
          message: `${unvalidated.length} foreign key constraint(s) are not validated`,
          details: unvalidated
            .map((c) => `${c.table_name}.${c.conname}`)
            .join(', '),
        };
      }

      return {
        name: 'data_integrity',
        status: 'pass',
        message: 'Data integrity verified',
        details: 'All foreign key constraints are validated',
      };
    } catch (err) {
      this.logger.warn('Data integrity check failed, skipping', err);
      return {
        name: 'data_integrity',
        status: 'warn',
        message: 'Unable to complete data integrity check',
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Check Redis connectivity.
   */
  private async checkRedisConnectivity(): Promise<UpgradeHealthCheck> {
    const redisUrl = process.env['REDIS_URL'];

    if (!redisUrl) {
      return {
        name: 'redis_connectivity',
        status: 'warn',
        message: 'Redis not configured, skipping connectivity check',
      };
    }

    try {
      // Simple connectivity check using Node.js net
      const { createConnection } = await import('net');
      const url = new URL(redisUrl);
      const host = url.hostname;
      const port = parseInt(url.port || '6379', 10);

      return new Promise((resolve) => {
        const socket = createConnection({ host, port, timeout: 5000 });

        socket.on('connect', () => {
          socket.destroy();
          resolve({
            name: 'redis_connectivity',
            status: 'pass',
            message: 'Redis connection successful',
            details: `${host}:${port}`,
          });
        });

        socket.on('error', (err) => {
          resolve({
            name: 'redis_connectivity',
            status: 'warn',
            message: 'Redis connection failed',
            details: err.message,
          });
        });

        socket.on('timeout', () => {
          socket.destroy();
          resolve({
            name: 'redis_connectivity',
            status: 'warn',
            message: 'Redis connection timed out',
            details: `${host}:${port}`,
          });
        });
      });
    } catch (err) {
      return {
        name: 'redis_connectivity',
        status: 'warn',
        message: 'Unable to check Redis connectivity',
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Check configuration consistency with database state.
   */
  private async checkConfigurationConsistency(): Promise<UpgradeHealthCheck> {
    try {
      // Verify that realms in config match database state
      const realmCount = await this.prisma.realm.count();
      const clientCount = await this.prisma.client.count();

      // Basic sanity checks
      if (realmCount === 0) {
        return {
          name: 'configuration_consistency',
          status: 'warn',
          message: 'No realms configured',
          details: 'At least one realm should exist for normal operation',
        };
      }

      if (clientCount === 0) {
        return {
          name: 'configuration_consistency',
          status: 'warn',
          message: 'No clients configured',
          details: 'At least one client should exist for OAuth/OIDC operations',
        };
      }

      return {
        name: 'configuration_consistency',
        status: 'pass',
        message: 'Configuration consistent with database state',
        details: `${realmCount} realm(s), ${clientCount} client(s)`,
      };
    } catch (err) {
      this.logger.error('Configuration consistency check failed', err);
      return {
        name: 'configuration_consistency',
        status: 'fail',
        message: 'Unable to verify configuration consistency',
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Verify critical tables have expected data structure.
   */
  private async checkCriticalTables(): Promise<UpgradeHealthCheck> {
    try {
      const issues: string[] = [];
      const warnings: string[] = [];

      // Use the Prisma accessors rather than raw SQL: Prisma applies the
      // @@map(...) names, hand-written SQL does not.
      const enabledRealmCount = await this.prisma.realm.count({
        where: { enabled: true },
      });
      if (enabledRealmCount === 0) {
        issues.push('No enabled realms found');
      }

      const masterRealm = await this.prisma.realm.findFirst({
        where: { name: 'master' },
      });
      if (!masterRealm) {
        issues.push('Master realm not found');
      }

      // The seeded admin username is configurable (ADMIN_USER, see
      // AdminSeedService), and an install that has moved to SSO may have
      // removed it entirely — so its absence is a warning, not a failure.
      const adminUsername = process.env.ADMIN_USER || 'admin';
      const adminUserCount = await this.prisma.user.count({
        where: { username: adminUsername },
      });
      if (adminUserCount === 0) {
        warnings.push(`Admin user '${adminUsername}' not found`);
      }

      if (issues.length > 0) {
        return {
          name: 'critical_tables',
          status: 'fail',
          message: `Critical data missing: ${issues.length} issue(s)`,
          details: [...issues, ...warnings].join('; '),
        };
      }

      if (warnings.length > 0) {
        return {
          name: 'critical_tables',
          status: 'warn',
          message: 'Critical tables present, with warnings',
          details: warnings.join('; '),
        };
      }

      return {
        name: 'critical_tables',
        status: 'pass',
        message: 'All critical tables have expected data',
        details: `Master realm: ${masterRealm?.name ?? 'unknown'}, Admin user: present`,
      };
    } catch (err) {
      this.logger.error('Critical tables check failed', err);
      return {
        name: 'critical_tables',
        status: 'fail',
        message: 'Unable to verify critical tables',
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
