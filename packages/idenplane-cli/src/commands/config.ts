import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../config.js';
import { HttpClient } from '../http.js';
import { printResult, success } from '../output.js';

export function registerConfigCommands(program: Command): void {
  const cfg = program.command('config').description('Manage CLI configuration');

  cfg
    .command('show')
    .description('Show current configuration (API key is masked)')
    .option('--json', 'Output as JSON')
    .action((opts) => {
      const config = loadConfig();
      if (!config) {
        console.log(chalk.yellow('No config found. Run `idenplane init` or `idenplane login` first.'));
        return;
      }
      // Stored credentials are redacted centrally by printResult
      // (output.ts redactCredentials), so pass them through as-is.
      const display: Record<string, unknown> = {
        serverUrl: config.serverUrl,
        apiKey: config.apiKey ?? undefined,
        accessToken: config.accessToken ?? undefined,
        defaultRealm: config.defaultRealm ?? '(not set)',
      };
      // Remove undefined entries
      for (const key of Object.keys(display)) {
        if (display[key] === undefined) delete display[key];
      }
      printResult(display, opts);
    });

  cfg
    .command('validate')
    .description('Check if server is reachable and credentials are valid')
    .action(async () => {
      const config = loadConfig();
      if (!config) {
        throw new Error('No config found. Run `idenplane init` or `idenplane login` first.');
      }

      console.log(chalk.dim(`Connecting to ${config.serverUrl}...`));

      try {
        const client = new HttpClient();
        const me = await client.get('/admin/auth/me');
        success(`Server is reachable. Authenticated as:`);
        printResult(me, { json: false });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Config validation failed: ${msg}`);
      }
    });
}
