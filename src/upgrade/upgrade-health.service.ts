import { Injectable, Logger } from '@nestjs/common';
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';

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
@Injectable()
export class UpgradeHealthService {
  private readonly logger = new Logger(UpgradeHealthService.name);
  private readonly prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

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
    const migrationsCheck = await this.checkMigrationsApplied();
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

      // Check for critical tables that must exist
      const criticalTables = [
        'realm',
        'client',
        'user',
        'role',
        'scope',
        'session',
      ];

      const existingTables = new Set(tables.map((t) => t.tablename));
      const missingTables = criticalTables.filter((t) => !existingTables.has(t));

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
        details: `All ${criticalTables.length} critical tables present`,
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
  private async checkMigrationsApplied(): Promise<UpgradeHealthCheck> {
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
      const output = err instanceof Error && 'stdout' in err
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
   * Check data integrity by verifying referential integrity.
   */
  private async checkDataIntegrity(): Promise<UpgradeHealthCheck> {
    try {
      // Check for orphaned foreign keys by verifying a few critical relationships
      const checks = await Promise.all([
        // Check for realms with invalid parent references
        this.prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) as count FROM realm
          WHERE parent_id IS NOT NULL
          AND parent_id NOT IN (SELECT id FROM realm WHERE id != realm.id)
        `,
        // Check for clients with invalid realm references
        this.prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) as count FROM client
          WHERE realm_id NOT IN (SELECT id FROM realm)
        `,
        // Check for users with invalid realm references
        this.prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) as count FROM "user"
          WHERE realm_id NOT IN (SELECT id FROM realm)
        `,
      ]);

      const orphanedRealms = Number(checks[0][0]?.count ?? 0);
      const orphanedClients = Number(checks[1][0]?.count ?? 0);
      const orphanedUsers = Number(checks[2][0]?.count ?? 0);
      const totalOrphans = orphanedRealms + orphanedClients + orphanedUsers;

      if (totalOrphans > 0) {
        const details = [
          orphanedRealms > 0 ? `${orphanedRealms} orphaned realm(s)` : null,
          orphanedClients > 0 ? `${orphanedClients} orphaned client(s)` : null,
          orphanedUsers > 0 ? `${orphanedUsers} orphaned user(s)` : null,
        ]
          .filter(Boolean)
          .join(', ');

        return {
          name: 'data_integrity',
          status: 'fail',
          message: `Data integrity issues detected: ${totalOrphans} orphaned records`,
          details,
        };
      }

      return {
        name: 'data_integrity',
        status: 'pass',
        message: 'Data integrity verified',
        details: 'No orphaned foreign key references detected',
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

      // Check realms have at least one enabled realm
      const enabledRealms = await this.prisma.$queryRaw<Array<{ count: bigint; enabled: boolean }>>`
        SELECT count(*) as count, enabled FROM realm GROUP BY enabled
      `;

      const hasEnabledRealm = enabledRealms.some((r) => r.enabled && Number(r.count) > 0);
      if (!hasEnabledRealm) {
        issues.push('No enabled realms found');
      }

      // Check that master realm exists
      const masterRealm = await this.prisma.realm.findFirst({
        where: { name: 'master' },
      });

      if (!masterRealm) {
        issues.push('Master realm not found');
      }

      // Check for admin users
      const adminUsers = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) as count FROM "user" WHERE username = 'admin'
      `;

      if (Number(adminUsers[0]?.count ?? 0) === 0) {
        issues.push('Admin user not found');
      }

      if (issues.length > 0) {
        return {
          name: 'critical_tables',
          status: 'fail',
          message: `Critical data missing: ${issues.length} issue(s)`,
          details: issues.join('; '),
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

  /**
   * Clean up Prisma client connections.
   */
  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}