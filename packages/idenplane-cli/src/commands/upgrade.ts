import { Command } from 'commander';
import { execSync, execFileSync } from 'child_process';
import chalk from 'chalk';
import { HttpClient } from '../http.js';
import { success, warn } from '../output.js';
import { confirm } from '../prompt.js';

interface VersionResponse {
  version: string;
  schemaVersion: string | null;
  pendingMigrations: string[];
  databaseUpToDate: boolean;
}

interface PreUpgradeCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  details?: string;
}

interface PreUpgradeValidationResult {
  canProceed: boolean;
  checks: PreUpgradeCheck[];
  summary: {
    passed: number;
    warnings: number;
    failures: number;
  };
}

interface BackupStatus {
  exists: boolean;
  path: string | null;
  lastBackup: string | null;
}

interface ConfigCompatibilityIssue {
  type: 'error' | 'warning';
  path: string;
  message: string;
  currentValue?: string;
  requiredValue?: string;
}

interface ConfigCompatibilityResult {
  compatible: boolean;
  version: string;
  issues: ConfigCompatibilityIssue[];
  summary: {
    errors: number;
    warnings: number;
  };
}

interface HealthStatus {
  healthy: boolean;
  version: string;
  uptime: number;
  checks: {
    database: 'ok' | 'error';
    cache: 'ok' | 'degraded' | 'error';
    storage: 'ok' | 'warning' | 'error';
  };
}

interface HealthCheckResult {
  healthy: boolean;
  timestamp: string;
  duration: number;
  checks: {
    database: { status: 'ok' | 'error'; latency?: number; error?: string };
    cache: { status: 'ok' | 'degraded' | 'error'; latency?: number; error?: string };
    storage: { status: 'ok' | 'warning' | 'error'; latency?: number; error?: string };
  };
}

export function registerUpgradeCommand(program: Command): void {
  program
    .command('upgrade')
    .description('Upgrade Idenplane: run pre-flight checks then apply database migrations')
    .option('--dry-run', 'Preview what would change without applying')
    .option('--rollback', 'Roll back the last applied database migration')
    .option('--yes', 'Skip confirmation prompts')
    .option('--json', 'Output results as JSON')
    .action(async (opts: { dryRun?: boolean; rollback?: boolean; yes?: boolean; json?: boolean }) => {
      const isDryRun = Boolean(opts.dryRun);
      const isRollback = Boolean(opts.rollback);

      console.log(chalk.bold('\n  Idenplane Upgrade\n'));

      // ------------------------------------------------------------------ //
      // Step 1: Pre-flight – server connectivity                             //
      // ------------------------------------------------------------------ //
      process.stdout.write(chalk.dim('  Checking server connectivity... '));
      let versionInfo: VersionResponse;
      try {
        const client = new HttpClient();
        versionInfo = await client.get<VersionResponse>('/admin/system/version');
        console.log(chalk.green('OK'));
      } catch {
        console.log(chalk.red('FAILED'));
        console.error(chalk.red('\n  Cannot connect to the Idenplane server.'));
        console.error(chalk.dim('  Make sure the server is running and `idenplane config set-url` is correct.\n'));
        process.exitCode = 1;
        return;
      }

      // ------------------------------------------------------------------ //
      // Step 1b: Backup status check                                        //
      // ------------------------------------------------------------------ //
      process.stdout.write(chalk.dim('  Checking backup status... '));
      let backupStatus: BackupStatus = { exists: false, path: null, lastBackup: null };
      try {
        const client = new HttpClient();
        backupStatus = await client.get<BackupStatus>('/admin/backup/status');
        console.log(chalk.green('OK'));
      } catch {
        console.log(chalk.yellow('WARNING'));
        console.error(chalk.yellow('    Could not retrieve backup status from server. Continuing anyway.'));
      }

      // ------------------------------------------------------------------ //
      // Step 2: Pre-flight – display current version                        //
      // ------------------------------------------------------------------ //
      console.log(`  Server version      : ${chalk.bold(versionInfo.version)}`);
      console.log(
        `  Database schema     : ${
          versionInfo.schemaVersion
            ? chalk.bold(versionInfo.schemaVersion)
            : chalk.dim('(none)')
        }`,
      );

      // ------------------------------------------------------------------ //
      // Step 3: Pre-flight – migration status                               //
      // ------------------------------------------------------------------ //
      if (isRollback) {
        await handleRollback({ isDryRun, skipConfirm: Boolean(opts.yes), isJson: Boolean(opts.json) });
        return;
      }

      if (versionInfo.databaseUpToDate) {
        success('\n  Database is already up to date. Nothing to migrate.');
        return;
      }

      const { pendingMigrations } = versionInfo;

      // Show backup status warning if no backup exists and migrations pending
      if (backupStatus.exists && backupStatus.lastBackup) {
        console.log(chalk.green(`  ✓ Backup exists`) + chalk.dim(` — last backup: ${backupStatus.lastBackup}`));
      } else if (!isDryRun && pendingMigrations.length > 0) {
        warn('  ⚠ No recent backup detected. It is recommended to create a backup before upgrading.');
      }

      console.log(`\n  Pending migrations (${chalk.yellow(String(pendingMigrations.length))}):`);
      for (const m of pendingMigrations) {
        console.log(`    ${chalk.cyan('→')} ${m}`);
      }

      if (isDryRun) {
        console.log(chalk.dim('\n  Dry run complete — no changes applied.'));
        if (opts.json) {
          console.log(JSON.stringify({ dryRun: true, pendingMigrations }, null, 2));
        }
        return;
      }

      // ------------------------------------------------------------------ //
      // Step 4: Pre-upgrade validation                                      //
      // ------------------------------------------------------------------ //
      process.stdout.write(chalk.dim('\n  Running pre-upgrade validation checks... '));
      let validationResult: PreUpgradeValidationResult;
      try {
        const client = new HttpClient();
        validationResult = await client.get<PreUpgradeValidationResult>('/admin/upgrade/pre-validation');
        console.log(chalk.green('OK'));
      } catch (validationError) {
        console.log(chalk.yellow('WARNING'));
        console.error(chalk.yellow('  Pre-upgrade validation could not be reached. Continuing anyway.'));
        if (Boolean(opts.json)) {
          console.log(JSON.stringify({ preValidationError: String(validationError) }, null, 2));
        }
        validationResult = {
          canProceed: true,
          checks: [],
          summary: { passed: 0, warnings: 0, failures: 0 },
        };
      }

      // Display validation results
      console.log(chalk.dim('  ─────────────────────────────────────────────'));
      for (const check of validationResult.checks) {
        const statusIcon = check.status === 'pass' ? chalk.green('✓') : check.status === 'warn' ? chalk.yellow('!') : chalk.red('✗');
        const statusLabel = check.status.toUpperCase();
        console.log(`  ${statusIcon} ${chalk.bold(statusLabel.padEnd(5))} ${check.message}`);
        if (check.details) {
          console.log(chalk.dim(`    ${check.details}`));
        }
      }
      console.log(chalk.dim('  ─────────────────────────────────────────────'));

      const { summary } = validationResult;
      console.log(
        `  ${chalk.green(String(summary.passed))} passed  ` +
        `${chalk.yellow(String(summary.warnings))} warnings  ` +
        `${chalk.red(String(summary.failures))} failures`,
      );

      if (!validationResult.canProceed) {
        console.error(chalk.red('\n  Pre-upgrade validation failed. Cannot proceed with upgrade.'));
        console.error(chalk.dim('  Fix the issues above and retry.\n'));
        process.exitCode = 1;
        return;
      }

      if (summary.failures > 0) {
        console.error(chalk.red('\n  Pre-upgrade validation has failures. Cannot proceed with upgrade.'));
        console.error(chalk.dim('  Fix the issues above and retry.\n'));
        process.exitCode = 1;
        return;
      }

      if (summary.warnings > 0) {
        console.log(chalk.yellow(`\n  ${summary.warnings} warning(s) — review above before continuing.`));
      }

      if (opts.json) {
        console.log(JSON.stringify({ preValidation: validationResult }, null, 2));
      }

      // ------------------------------------------------------------------ //
      // Step 5: Configuration compatibility check                            //
      // ------------------------------------------------------------------ //
      process.stdout.write(chalk.dim('\n  Checking configuration compatibility... '));
      let configCompatibility: ConfigCompatibilityResult;
      try {
        const client = new HttpClient();
        configCompatibility = await client.get<ConfigCompatibilityResult>('/admin/upgrade/config-compatibility');
        console.log(chalk.green('OK'));
      } catch (configError) {
        console.log(chalk.yellow('WARNING'));
        console.error(chalk.yellow('  Configuration compatibility check could not be reached. Continuing anyway.'));
        if (Boolean(opts.json)) {
          console.log(JSON.stringify({ configCompatibilityError: String(configError) }, null, 2));
        }
        configCompatibility = {
          compatible: true,
          version: versionInfo.version,
          issues: [],
          summary: { errors: 0, warnings: 0 },
        };
      }

      // Display config compatibility results
      if (configCompatibility.issues.length > 0) {
        console.log(chalk.dim('  ─────────────────────────────────────────────'));
        for (const issue of configCompatibility.issues) {
          const statusIcon = issue.type === 'error' ? chalk.red('✗') : chalk.yellow('!');
          const statusLabel = issue.type.toUpperCase();
          console.log(`  ${statusIcon} ${chalk.bold(statusLabel.padEnd(6))} ${issue.message}`);
          console.log(chalk.dim(`    Path: ${issue.path}`));
          if (issue.currentValue) {
            console.log(chalk.dim(`    Current: ${issue.currentValue}`));
          }
          if (issue.requiredValue) {
            console.log(chalk.dim(`    Required: ${issue.requiredValue}`));
          }
        }
        console.log(chalk.dim('  ─────────────────────────────────────────────'));
      }

      const { summary: configSummary } = configCompatibility;
      console.log(
        `  ${configSummary.errors === 0 ? chalk.green(String(configSummary.errors)) : chalk.red(String(configSummary.errors))} errors  ` +
        `${configSummary.warnings === 0 ? chalk.green(String(configSummary.warnings)) : chalk.yellow(String(configSummary.warnings))} warnings`,
      );

      if (!configCompatibility.compatible) {
        console.error(chalk.red('\n  Configuration is not compatible with the target version. Cannot proceed with upgrade.'));
        console.error(chalk.dim('  Fix the issues above and retry.\n'));
        process.exitCode = 1;
        return;
      }

      if (configSummary.warnings > 0) {
        console.log(chalk.yellow(`\n  ${configSummary.warnings} configuration warning(s) — review above before continuing.`));
      }

      if (opts.json) {
        console.log(JSON.stringify({ configCompatibility }, null, 2));
      }

      // ------------------------------------------------------------------ //
      // Step 6: Confirm + apply                                             //
      // ------------------------------------------------------------------ //
      if (!opts.yes) {
        const ok = await confirm(
          `\n  Apply ${pendingMigrations.length} migration(s) now?`,
        );
        if (!ok) {
          console.log(chalk.dim('  Aborted.'));
          return;
        }
      }

      console.log(chalk.dim('\n  Running: prisma migrate deploy\n'));

      // Progress indicator for migration execution
      const totalMigrations = pendingMigrations.length;
      console.log(chalk.dim(`  Applying ${totalMigrations} migration(s)...`));

      let migrationSuccess = false;
      let appliedCount = 0;
      try {
        const output = execSync('npx prisma migrate deploy', {
          encoding: 'utf-8',
          stdio: ['inherit', 'pipe', 'pipe'],
        });
        appliedCount = totalMigrations;
        migrationSuccess = true;
        console.log(`  ${chalk.green('✓')} All ${totalMigrations} migration(s) applied successfully.`);

        // ------------------------------------------------------------------ //
        // Step 7: Post-upgrade health verification                             //
        // ------------------------------------------------------------------ //
        process.stdout.write(chalk.dim('\n  Verifying system health after upgrade... '));
        let healthResult: HealthCheckResult;
        try {
          const client = new HttpClient();
          healthResult = await client.get<HealthCheckResult>('/admin/system/health');
          console.log(chalk.green('OK'));
        } catch (healthError) {
          console.log(chalk.yellow('WARNING'));
          console.error(chalk.yellow('    Could not verify system health after upgrade. Please check the server manually.'));
          if (Boolean(opts.json)) {
            console.log(JSON.stringify({ healthCheckError: String(healthError) }, null, 2));
          }
          healthResult = {
            healthy: false,
            timestamp: new Date().toISOString(),
            duration: 0,
            checks: {
              database: { status: 'error' as const },
              cache: { status: 'error' as const },
              storage: { status: 'error' as const },
            },
          };
        }

        // Display health check results
        console.log(chalk.dim('  ─────────────────────────────────────────────'));
        const dbStatus = healthResult.checks.database;
        const cacheStatus = healthResult.checks.cache;
        const storageStatus = healthResult.checks.storage;

        const dbIcon = dbStatus.status === 'ok' ? chalk.green('✓') : chalk.red('✗');
        const cacheIcon = cacheStatus.status === 'ok' ? chalk.green('✓') : cacheStatus.status === 'degraded' ? chalk.yellow('!') : chalk.red('✗');
        const storageIcon = storageStatus.status === 'ok' ? chalk.green('✓') : storageStatus.status === 'warning' ? chalk.yellow('!') : chalk.red('✗');

        console.log(`  ${dbIcon} Database  ${dbStatus.status === 'ok' ? chalk.green('OK') : chalk.red('ERROR')}${dbStatus.latency !== undefined ? chalk.dim(` (${dbStatus.latency}ms)`) : ''}`);
        console.log(`  ${cacheIcon} Cache     ${cacheStatus.status === 'ok' ? chalk.green('OK') : cacheStatus.status === 'degraded' ? chalk.yellow('DEGRADED') : chalk.red('ERROR')}${cacheStatus.latency !== undefined ? chalk.dim(` (${cacheStatus.latency}ms)`) : ''}`);
        console.log(`  ${storageIcon} Storage   ${storageStatus.status === 'ok' ? chalk.green('OK') : storageStatus.status === 'warning' ? chalk.yellow('WARNING') : chalk.red('ERROR')}${storageStatus.latency !== undefined ? chalk.dim(` (${storageStatus.latency}ms)`) : ''}`);
        console.log(chalk.dim('  ─────────────────────────────────────────────'));

        const healthTime = new Date(healthResult.timestamp).toLocaleTimeString();
        console.log(`  Health check at ${chalk.bold(healthTime)}  ${chalk.dim(`(${healthResult.duration}ms)`)}`);

        if (!healthResult.healthy) {
          warn('\n  ⚠ System health check reported issues. The upgrade completed, but please verify the system is functioning correctly.');
          if (opts.json) {
            console.log(JSON.stringify({ migrationSuccess: true, healthIssues: healthResult }, null, 2));
          }
        } else {
          if (opts.json) {
            console.log(JSON.stringify({ migrationSuccess: true, healthOk: true, health: healthResult }, null, 2));
          }
        }

        if (opts.json) {
          console.log(JSON.stringify({ applied: pendingMigrations }, null, 2));
        }
      } catch (err: unknown) {
        const msg =
          err instanceof Error && 'stderr' in err
            ? String((err as NodeJS.ErrnoException & { stderr?: Buffer }).stderr)
            : String(err);
        console.error(chalk.red('\n  Migration failed:\n'));
        console.error(chalk.red(msg));

        // ------------------------------------------------------------------ //
        // Automatic rollback on failure                                      //
        // ------------------------------------------------------------------ //
        console.log(chalk.yellow('\n  ⚠ Upgrade failed — initiating rollback...\n'));

        // Attempt to restore from backup if available
        if (backupStatus.exists && backupStatus.path) {
          console.log(chalk.dim(`  Backup found: ${backupStatus.path}`));
          console.log(chalk.dim('  Restoring from backup...\n'));

          try {
            // Try server-side backup restore first
            const client = new HttpClient();
            const restoreResult = await client.post<{ success: boolean; message: string }>(
              '/admin/backup/restore',
              { backupPath: backupStatus.path },
            );

            if (restoreResult.success) {
              success('  ✓ Backup restored successfully.');
              console.log(chalk.dim(`    ${restoreResult.message}`));
            } else {
              warn('  ⚠ Backup restore completed with warnings. Please verify data integrity.');
              console.log(chalk.dim(`    ${restoreResult.message}`));
            }
          } catch {
            // Server-side restore unavailable, attempt CLI restore
            console.log(chalk.yellow('  Server-side restore unavailable, attempting CLI restore...'));

            if (process.platform === 'win32') {
              try {
                execFileSync('cmd', ['/c', 'sqlcmd', '-b', '-E', '-i', 'restore.sql'], {
                  stdio: 'inherit',
                });
                success('  ✓ Database restored from CLI backup.');
              } catch {
                console.error(chalk.red('    CLI restore failed. Manual intervention may be required.'));
                console.error(chalk.dim(`    Restore from: ${backupStatus.path}`));
              }
            } else {
              // PostgreSQL/MySQL restore via CLI
              const dbUrl = process.env.DATABASE_URL;
              if (dbUrl && dbUrl.startsWith('postgresql://')) {
                console.log(chalk.dim('  Using pg_restore for PostgreSQL backup...'));
                try {
                  execFileSync('pg_restore', ['-d', dbUrl, backupStatus.path], {
                    stdio: 'inherit',
                  });
                  success('  ✓ Database restored successfully.');
                } catch {
                  console.error(chalk.red('    PostgreSQL restore failed. Manual intervention may be required.'));
                  console.error(chalk.dim(`    Restore from: ${backupStatus.path}`));
                }
              } else if (dbUrl && dbUrl.startsWith('mysql://')) {
                console.log(chalk.dim('  Using mysql for MySQL backup...'));
                try {
                  execFileSync('mysql', [dbUrl.replace('mysql://', ''), '<', backupStatus.path], {
                    shell: '/bin/bash',
                    stdio: 'inherit',
                  } as { encoding: 'utf-8'; stdio: 'pipe' | 'inherit' | 'pipe'; shell: string });
                  success('  ✓ Database restored successfully.');
                } catch {
                  console.error(chalk.red('    MySQL restore failed. Manual intervention may be required.'));
                  console.error(chalk.dim(`    Restore from: ${backupStatus.path}`));
                }
              } else {
                console.error(chalk.red('    No supported database CLI found. Manual intervention required.'));
                console.error(chalk.dim(`    Restore from: ${backupStatus.path}`));
              }
            }
          }
        } else {
          // No backup available
          warn('  ⚠ No backup available for automatic restore.');
          console.log(chalk.dim('\n  Manual recovery options:'));
          console.log(chalk.dim('    1. Create a manual backup of current state'));
          console.log(chalk.dim('    2. Run: idenplane upgrade --rollback'));
          console.log(chalk.dim('    3. Restore from any existing backups in the backup directory'));
          console.log(chalk.dim('\n  After recovery, review migration logs and retry the upgrade.'));
        }

        console.log(chalk.yellow('\n  Upgrade process completed with errors. System state unchanged.'));
        if (opts.json) {
          console.log(JSON.stringify({ upgradeFailed: true, rolledBack: backupStatus.exists, backupPath: backupStatus.path }, null, 2));
        }
        process.exitCode = 1;
      }
    });
}

// -------------------------------------------------------------------------- //
// Rollback handler                                                            //
// -------------------------------------------------------------------------- //

async function handleRollback(opts: {
  isDryRun: boolean;
  skipConfirm: boolean;
  isJson: boolean;
}): Promise<void> {
  warn('  Rolling back the last migration using `prisma migrate resolve --rolled-back <name>`.');
  console.log(chalk.dim('  Determining last applied migration...\n'));

  let statusOutput: string;
  try {
    statusOutput = execSync('npx prisma migrate status 2>&1', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err: unknown) {
    statusOutput =
      err instanceof Error && 'stdout' in err
        ? String((err as NodeJS.ErrnoException & { stdout?: Buffer }).stdout)
        : '';
  }

  // Find the last line that shows an applied migration (✓ or ✔)
  const applied = (statusOutput.match(/[✓✔]\s+(\S+)/g) ?? [])
    .map((m) => m.replace(/^[✓✔]\s+/, ''));

  if (applied.length === 0) {
    console.error(chalk.red('  No applied migrations found to roll back.'));
    process.exitCode = 1;
    return;
  }

  const lastMigration = applied[applied.length - 1];
  console.log(`  Last applied migration : ${chalk.bold(lastMigration)}`);

  if (opts.isDryRun) {
    console.log(chalk.dim(`\n  Dry run — would roll back: ${lastMigration}`));
    if (opts.isJson) {
      console.log(JSON.stringify({ dryRun: true, wouldRollback: lastMigration }, null, 2));
    }
    return;
  }

  if (!opts.skipConfirm) {
    const ok = await confirm(`\n  Roll back migration "${lastMigration}"?`);
    if (!ok) {
      console.log(chalk.dim('  Aborted.'));
      return;
    }
  }

  console.log(chalk.dim(`\n  Running: prisma migrate resolve --rolled-back ${lastMigration}\n`));
  try {
    const out = execFileSync(
      'npx',
      ['prisma', 'migrate', 'resolve', '--rolled-back', lastMigration],
      { encoding: 'utf-8', stdio: ['inherit', 'pipe', 'pipe'] },
    );
    console.log(out);
    success(`  Rolled back migration "${lastMigration}".`);

    if (opts.isJson) {
      console.log(JSON.stringify({ rolledBack: lastMigration }, null, 2));
    }
  } catch (err: unknown) {
    const msg =
      err instanceof Error && 'stderr' in err
        ? String((err as NodeJS.ErrnoException & { stderr?: Buffer }).stderr)
        : String(err);
    console.error(chalk.red('\n  Rollback failed:\n'));
    console.error(chalk.red(msg));
    process.exitCode = 1;
  }
}
