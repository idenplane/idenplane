import { Injectable, Logger } from '@nestjs/common';
import { prismaMigrateStatus } from './migrate-status.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { policyProblems } from '../authorization/policy-engine.js';
import { classifyIdpProviderType } from '../identity-providers/idp-provider-types.js';
import { adminMfaRequiredFromEnv } from '../admin-rbac/admin-principal.service.js';
import {
  ADMIN_ROLES,
  MASTER_REALM,
} from '../admin-rbac/admin-access-policy.js';

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

    // 8. Security posture: realms without brute-force protection. Only ever
    // a warning, so it never blocks an upgrade.
    const bruteForceCheck = await this.checkBruteForceProtection();
    checks.push(bruteForceCheck);
    if (bruteForceCheck.status === 'pass') passed++;
    else warnings++;

    // 9. Security posture: clients with wildcard redirect URIs. Also only
    // ever a warning.
    const wildcardCheck = await this.checkWildcardRedirectUris();
    checks.push(wildcardCheck);
    if (wildcardCheck.status === 'pass') passed++;
    else warnings++;

    // 10. Admin console MFA: off after an upgrade until turned on, and
    // recovery codes still in the pre-0.11.0 format. Warnings only.
    for (const check of [
      await this.checkAdminMfa(),
      await this.checkRecoveryCodes(),
    ]) {
      checks.push(check);
      if (check.status === 'pass') passed++;
      else warnings++;
    }

    // 11. Authorization policies the engine cannot evaluate. Also only ever
    // a warning.
    const policyCheck = await this.checkInvalidPolicies();
    checks.push(policyCheck);
    if (policyCheck.status === 'pass') passed++;
    else warnings++;

    // 12. Identity providers stored with a type the broker does not take
    // (SAML, or anything else saved before 0.12.0). Also only ever a
    // warning.
    const idpCheck = await this.checkIdentityProviderTypes();
    checks.push(idpCheck);
    if (idpCheck.status === 'pass') passed++;
    else warnings++;

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
   * Warns about realms that have brute-force protection off. New realms get
   * it on (since 0.10.0) but an upgrade never changes an existing realm, so
   * this is how an operator finds the realms still to review. The endpoint
   * is admin-only, so naming the realms here is fine.
   */
  async checkBruteForceProtection(): Promise<UpgradeHealthCheck> {
    try {
      const realms = await this.prisma.realm.findMany({
        where: { bruteForceEnabled: false },
        select: { name: true },
        orderBy: { name: 'asc' },
      });
      if (realms.length === 0) {
        return {
          name: 'brute_force_protection',
          status: 'pass',
          message: 'Brute-force protection is on in every realm',
        };
      }
      return {
        name: 'brute_force_protection',
        status: 'warn',
        message: `${realms.length} realm(s) have brute-force protection off`,
        details: realms.map((r) => r.name).join(', '),
      };
    } catch (error) {
      return {
        name: 'brute_force_protection',
        status: 'warn',
        message: 'Could not check brute-force protection',
        details: (error as Error).message,
      };
    }
  }

  /**
   * Warns while a second factor is not required for every admin (the state
   * an upgraded install starts in), and names the admins without one. See
   * docs/docs/security/admin-mfa.md.
   */
  async checkAdminMfa(): Promise<UpgradeHealthCheck> {
    try {
      const fromEnv = adminMfaRequiredFromEnv(
        process.env['ADMIN_MFA_REQUIRED'],
      );
      const required =
        fromEnv ??
        (
          await this.prisma.adminSecurityPolicy.findUnique({
            where: { id: 1 },
            select: { mfaRequired: true },
          })
        )?.mfaRequired ??
        false;
      const without = await this.prisma.user.findMany({
        where: {
          realm: { name: MASTER_REALM },
          enabled: true,
          userRoles: {
            some: {
              role: {
                clientId: null,
                name: { in: [...ADMIN_ROLES] },
                realm: { name: MASTER_REALM },
              },
            },
          },
          userCredentials: { none: { type: 'totp', verified: true } },
          webAuthnCredentials: { none: {} },
        },
        select: { username: true },
        orderBy: { username: 'asc' },
      });
      const names = without.map((u) => u.username).join(', ');
      if (!required) {
        return {
          name: 'admin_mfa',
          status: 'warn',
          message:
            'A second factor is not required for admin console sign-in' +
            (fromEnv === false ? ' (ADMIN_MFA_REQUIRED=false)' : ''),
          ...(without.length ? { details: `No second factor: ${names}` } : {}),
        };
      }
      if (without.length > 0) {
        return {
          name: 'admin_mfa',
          status: 'warn',
          message: `${without.length} admin(s) must still enrol a second factor`,
          details: names,
        };
      }
      return {
        name: 'admin_mfa',
        status: 'pass',
        message: 'Every admin has a second factor, and it is required',
      };
    } catch (error) {
      return {
        name: 'admin_mfa',
        status: 'warn',
        message: 'Could not check admin MFA',
        details: (error as Error).message,
      };
    }
  }

  /**
   * Warns about users who still hold recovery codes issued before 0.11.0
   * (32 bits). They keep working, but should be replaced.
   */
  async checkRecoveryCodes(): Promise<UpgradeHealthCheck> {
    try {
      const rows = await this.prisma.recoveryCode.findMany({
        where: { used: false, NOT: { codeHash: { startsWith: 'rc2$' } } },
        select: { userId: true },
        distinct: ['userId'],
      });
      if (rows.length === 0) {
        return {
          name: 'recovery_codes',
          status: 'pass',
          message: 'Every unused recovery code is in the current format',
        };
      }
      return {
        name: 'recovery_codes',
        status: 'warn',
        message: `${rows.length} user(s) still have recovery codes issued before 0.11.0; they work, but should be replaced`,
      };
    } catch (error) {
      return {
        name: 'recovery_codes',
        status: 'warn',
        message: 'Could not check recovery codes',
        details: (error as Error).message,
      };
    }
  }

  /**
   * Warns about clients with wildcard (`/*`) redirect URIs. Since 0.11.0
   * redirect URIs match exactly (RFC 9700). The 0.11.0 migration turned on
   * `allowInsecureWildcardRedirectUris` for every client that had such an
   * entry, so they keep working; this is how an operator finds them to
   * register exact URIs and turn the opt-in off. A client with a wildcard
   * entry and the opt-in off is listed too: that entry matches nothing.
   */
  async checkWildcardRedirectUris(): Promise<UpgradeHealthCheck> {
    try {
      const clients = await this.prisma.$queryRaw<
        Array<{ realm: string; client_id: string; opt_in: boolean }>
      >`
        SELECT r."name" AS realm,
               c."client_id",
               c."allow_insecure_wildcard_redirect_uris" AS opt_in
          FROM "clients" c
          JOIN "realms" r ON r."id" = c."realm_id"
         WHERE c."allow_insecure_wildcard_redirect_uris"
            OR EXISTS (
                 SELECT 1
                   FROM unnest(c."redirect_uris" || c."post_logout_redirect_uris") AS u(uri)
                  WHERE u.uri LIKE '%/*'
               )
         ORDER BY r."name", c."client_id"
      `;
      if (clients.length === 0) {
        return {
          name: 'wildcard_redirect_uris',
          status: 'pass',
          message: 'Every client uses exact redirect URIs',
        };
      }
      return {
        name: 'wildcard_redirect_uris',
        status: 'warn',
        message:
          `${clients.length} client(s) rely on wildcard redirect URIs, which match any path ` +
          'below them (insecure, RFC 9700). Register exact redirect URIs and turn ' +
          'allowInsecureWildcardRedirectUris off.',
        details: clients
          .map(
            (c) =>
              `${c.realm}/${c.client_id}${c.opt_in ? '' : ' (opt-in off: the wildcard matches nothing)'}`,
          )
          .join(', '),
      };
    } catch (error) {
      return {
        name: 'wildcard_redirect_uris',
        status: 'warn',
        message: 'Could not check redirect URIs',
        details: (error as Error).message,
      };
    }
  }

  /**
   * Warns about authorization policies with a condition the engine cannot
   * evaluate: an unknown operator (a typo such as `equal`), a value the
   * operator cannot use (an invalid CIDR or regex, `in` without an array),
   * or an unknown `effect` / `logic`. Before 0.11.0 these were saved
   * unchecked and evaluated as "no match", so such a DENY never denied.
   * Since 0.11.0 they fail closed: a DENY denies every request it applies
   * to, an ALLOW never allows. Each is listed as `realm/policy` with what is
   * wrong, so the operator can fix it.
   */
  async checkInvalidPolicies(): Promise<UpgradeHealthCheck> {
    try {
      const policies = await this.prisma.policy.findMany({
        select: {
          name: true,
          effect: true,
          logic: true,
          subjectConditions: true,
          resourceConditions: true,
          actionConditions: true,
          environmentConditions: true,
          realm: { select: { name: true } },
        },
        orderBy: [{ realm: { name: 'asc' } }, { name: 'asc' }],
      });
      const invalid = policies
        .map((p) => ({ p, problems: policyProblems(p) }))
        .filter((x) => x.problems.length > 0);
      if (invalid.length === 0) {
        return {
          name: 'invalid_authorization_policies',
          status: 'pass',
          message: 'Every authorization policy can be evaluated',
        };
      }
      return {
        name: 'invalid_authorization_policies',
        status: 'warn',
        message:
          `${invalid.length} authorization polic${invalid.length === 1 ? 'y has' : 'ies have'} ` +
          'a condition that cannot be evaluated. They now fail closed: a DENY denies ' +
          'every request it applies to, an ALLOW never allows. Fix or delete them.',
        details: invalid
          .map(
            ({ p, problems }) =>
              `${p.realm.name}/${p.name} (${p.effect}): ` +
              problems.map((x) => `${x.path}: ${x.message}`).join('; '),
          )
          .join(', '),
      };
    } catch (error) {
      return {
        name: 'invalid_authorization_policies',
        status: 'warn',
        message: 'Could not check authorization policies',
        details: (error as Error).message,
      };
    }
  }

  /**
   * Warns about identity providers whose `providerType` the broker does not
   * sign in with (`oidc` and `oauth2` only, since 0.12.0). Before 0.12.0
   * the admin API and the importers stored any type, so a realm can still
   * hold `SAML` rows, or other types; an enabled one shows a sign-in
   * button on the login page. (Supported types stored in another case,
   * such as `OIDC`, were lower-cased by the 0.13.0 migration.)
   *
   * SAML rows are reported as needing configuration review rather than as
   * unusable: they were stored without the settings a SAML sign-in needs.
   * Each is listed as `realm/alias (type, enabled|disabled)`. What counts
   * as SAML or supported is decided by classifyIdpProviderType.
   */
  async checkIdentityProviderTypes(): Promise<UpgradeHealthCheck> {
    try {
      const providers = await this.prisma.identityProvider.findMany({
        select: {
          alias: true,
          providerType: true,
          enabled: true,
          realm: { select: { name: true } },
        },
        orderBy: [{ realm: { name: 'asc' } }, { alias: 'asc' }],
      });
      const listed = (kind: 'saml' | 'unsupported') =>
        providers
          .filter((p) => classifyIdpProviderType(p.providerType).kind === kind)
          .map(
            (p) =>
              `${p.realm.name}/${p.alias} (${p.providerType || '(none)'}, ${p.enabled ? 'enabled' : 'disabled'})`,
          );
      const saml = listed('saml');
      const unsupported = listed('unsupported');
      if (saml.length === 0 && unsupported.length === 0) {
        return {
          name: 'identity_provider_types',
          status: 'pass',
          message: 'Every identity provider has a supported type',
        };
      }
      const parts: string[] = [];
      if (saml.length > 0) {
        parts.push(
          `${saml.length} SAML identity provider(s) need configuration review: ` +
            'they were stored before 0.12.0 without the settings a SAML sign-in ' +
            'needs. Review and complete each one, or delete it.',
        );
      }
      if (unsupported.length > 0) {
        parts.push(
          `${unsupported.length} identity provider(s) have a type the broker ` +
            'does not support (oidc and oauth2 are). Change the type to oidc or ' +
            'oauth2 if the provider speaks it, or delete them.',
        );
      }
      parts.push(
        'An enabled one shows a sign-in button that cannot complete a sign-in until then.',
      );
      const details: string[] = [];
      if (saml.length > 0) {
        details.push(`Needs configuration review: ${saml.join(', ')}`);
      }
      if (unsupported.length > 0) {
        details.push(`Unsupported type: ${unsupported.join(', ')}`);
      }
      return {
        name: 'identity_provider_types',
        status: 'warn',
        message: parts.join(' '),
        details: details.join('; '),
      };
    } catch (error) {
      return {
        name: 'identity_provider_types',
        status: 'warn',
        message: 'Could not check identity provider types',
        details: (error as Error).message,
      };
    }
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
  private async checkMigrationsApplied(): Promise<UpgradeHealthCheck> {
    try {
      const output = await prismaMigrateStatus();

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
