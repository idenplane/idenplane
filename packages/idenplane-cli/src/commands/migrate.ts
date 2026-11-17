import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { loadConfig } from '../config.js';
import { createHttpClient, handleApiError } from '../http.js';
import type { CliConfig, MigrationReport } from '../types.js';

function printReport(report: MigrationReport): void {
  console.log(chalk.bold(`\nMigration Report (${report.source})`));
  console.log(chalk.dim(`Dry run: ${report.dryRun}`));
  console.log(chalk.dim(`Duration: ${new Date(report.completedAt).getTime() - new Date(report.startedAt).getTime()}ms\n`));

  console.log(chalk.bold('Summary:'));
  const { summary } = report;
  const entities = Object.entries(summary) as [string, { created: number; skipped: number; failed: number }][];
  for (const [name, stats] of entities) {
    const parts: string[] = [];
    if (stats.created > 0) parts.push(chalk.green(`${stats.created} created`));
    if (stats.skipped > 0) parts.push(chalk.yellow(`${stats.skipped} skipped`));
    if (stats.failed > 0) parts.push(chalk.red(`${stats.failed} failed`));
    if (parts.length > 0) {
      console.log(`  ${name}: ${parts.join(', ')}`);
    }
  }

  if (report.warnings.length > 0) {
    console.log(chalk.bold.yellow(`\nWarnings (${report.warnings.length}):`));
    for (const w of report.warnings) {
      console.log(`  ${chalk.yellow('⚠')} [${w.entity}] ${w.message}`);
    }
  }

  if (report.errors.length > 0) {
    console.log(chalk.bold.red(`\nErrors (${report.errors.length}):`));
    for (const e of report.errors) {
      console.log(`  ${chalk.red('✗')} [${e.entity}] ${e.name}: ${e.error}`);
    }
  }

  const totalCreated = entities.reduce((sum, [, s]) => sum + s.created, 0);
  const totalFailed = entities.reduce((sum, [, s]) => sum + s.failed, 0);
  console.log(chalk.bold(`\nTotal: ${chalk.green(totalCreated + ' created')}, ${chalk.red(totalFailed + ' failed')}`));
}

/** What the migrate subcommands need from outside; replaced in tests. */
export interface MigrateDeps {
  loadConfig: () => CliConfig | null;
  post: (config: CliConfig, path: string, body: unknown) => Promise<MigrationReport>;
}

const defaultDeps: MigrateDeps = {
  loadConfig,
  post: (config, path, body) => createHttpClient(config).post<MigrationReport>(path, body),
};

type Source = 'keycloak' | 'auth0' | 'zitadel' | 'authentik';

interface MigrateOptions {
  file: string;
  realm?: string;
  dryRun: boolean;
  json: boolean;
}

/** Reads the export, posts it to `/admin/migration/<source>` and prints the report. */
async function runMigration(
  source: Source,
  opts: MigrateOptions,
  describe: (data: any) => string,
  deps: MigrateDeps,
): Promise<void> {
  const config = deps.loadConfig();
  if (!config) { console.error(chalk.red('Not configured. Run: idenplane init')); process.exit(1); }

  let data: any;
  try {
    data = JSON.parse(readFileSync(opts.file, 'utf-8'));
  } catch (e: any) {
    console.error(chalk.red(`Failed to read file: ${e.message}`));
    process.exit(1);
  }

  console.log(chalk.blue(`${describe(data)}${opts.dryRun ? ' (dry run)' : ''}...`));

  try {
    const report = await deps.post(config, `/admin/migration/${source}`, {
      data, dryRun: opts.dryRun, targetRealm: opts.realm,
    });
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printReport(report);
    }
  } catch (error) {
    handleApiError(error);
  }
}

/**
 * Registers `idenplane migrate keycloak|auth0|zitadel|authentik`
 * subcommands for importing users and configuration from a Keycloak realm
 * export, an Auth0 Management API export, a hand-assembled Zitadel
 * Management API export, or Authentik REST API responses, printing a
 * formatted (or `--json`) migration report.
 */
export function registerMigrateCommand(program: Command, deps: MigrateDeps = defaultDeps): void {
  const migrate = program.command('migrate').description('Migrate from other IAM providers');

  migrate
    .command('keycloak')
    .description('Import from Keycloak realm export JSON')
    .requiredOption('--file <path>', 'Path to Keycloak realm export JSON file')
    .option('--dry-run', 'Preview import without making changes', false)
    .option('--realm <name>', 'Target realm name (defaults to realm name in export)')
    .option('--json', 'Output as JSON', false)
    .action((opts: MigrateOptions) =>
      runMigration('keycloak', opts, (data) => `Importing Keycloak realm '${data.realm ?? 'unknown'}'`, deps),
    );

  migrate
    .command('auth0')
    .description('Import from Auth0 Management API export')
    .requiredOption('--file <path>', 'Path to Auth0 export JSON file')
    .requiredOption('--realm <name>', 'Target realm name')
    .option('--dry-run', 'Preview import without making changes', false)
    .option('--json', 'Output as JSON', false)
    .action((opts: MigrateOptions) =>
      runMigration('auth0', opts, () => `Importing Auth0 data into realm '${opts.realm}'`, deps),
    );

  migrate
    .command('zitadel')
    .description('Import from a hand-assembled Zitadel Management API export (see docs)')
    .requiredOption('--file <path>', 'Path to Zitadel export JSON file')
    .requiredOption('--realm <name>', 'Target realm name')
    .option('--dry-run', 'Preview import without making changes', false)
    .option('--json', 'Output as JSON', false)
    .action((opts: MigrateOptions) =>
      runMigration('zitadel', opts, () => `Importing Zitadel data into realm '${opts.realm}'`, deps),
    );

  migrate
    .command('authentik')
    .description('Import from Authentik REST API responses: users, groups, OAuth2 providers, OAuth sources (see docs)')
    .requiredOption('--file <path>', 'Path to the Authentik import JSON file')
    .requiredOption('--realm <name>', 'Target realm name (must exist)')
    .option('--dry-run', 'Preview import without making changes', false)
    .option('--json', 'Output as JSON', false)
    .action((opts: MigrateOptions) =>
      runMigration('authentik', opts, () => `Importing Authentik data into realm '${opts.realm}'`, deps),
    );
}
