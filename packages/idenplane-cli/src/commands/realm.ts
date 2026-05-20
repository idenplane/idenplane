import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'fs';
import { HttpClient } from '../http.js';
import { printResult, success } from '../output.js';
import { confirm } from '../prompt.js';

export function registerRealmCommands(program: Command): void {
  const realm = program.command('realm').description('Manage realms');

  realm
    .command('list')
    .description('List all realms')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const client = new HttpClient();
      const realms = await client.get('/admin/realms');
      printResult(realms, opts);
    });

  realm
    .command('create <name>')
    .description('Create a new realm')
    .option('--display-name <displayName>', 'Human-readable name')
    .option('--disabled', 'Create as disabled')
    .option('--json', 'Output as JSON')
    .action(async (name: string, opts) => {
      const client = new HttpClient();
      const body: Record<string, unknown> = { name };
      if (opts.displayName) body.displayName = opts.displayName;
      if (opts.disabled) body.enabled = false;
      const result = await client.post('/admin/realms', body);
      printResult(result, opts);
    });

  realm
    .command('get <name>')
    .description('Get realm details')
    .option('--json', 'Output as JSON')
    .action(async (name: string, opts) => {
      const client = new HttpClient();
      const result = await client.get(`/admin/realms/${name}`);
      printResult(result, opts);
    });

  realm
    .command('update <name>')
    .description('Update a realm')
    .option('--display-name <displayName>', 'New human-readable name')
    .option('--enable', 'Enable the realm')
    .option('--disable', 'Disable the realm')
    .option('--json', 'Output as JSON')
    .action(async (name: string, opts) => {
      const client = new HttpClient();
      const body: Record<string, unknown> = {};
      if (opts.displayName) body.displayName = opts.displayName;
      if (opts.enable) body.enabled = true;
      if (opts.disable) body.enabled = false;
      const result = await client.put(`/admin/realms/${name}`, body);
      printResult(result, opts);
    });

  realm
    .command('delete <name>')
    .description('Delete a realm')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (name: string, opts) => {
      if (!opts.yes) {
        const ok = await confirm(`Delete realm "${name}"? This cannot be undone.`);
        if (!ok) {
          console.log('Aborted.');
          return;
        }
      }
      const client = new HttpClient();
      await client.delete(`/admin/realms/${name}`);
      success(`Realm "${name}" deleted.`);
    });

  realm
    .command('export <name>')
    .description('Export realm to a JSON file')
    .option('-o, --output <file>', 'Output file path (default: <name>.json)')
    .option('--include-users', 'Include user data in export')
    .option('--include-secrets', 'Include client secrets in export')
    .option('--json', 'Output to stdout as JSON instead of file')
    .action(async (name: string, opts) => {
      const client = new HttpClient();
      const query: Record<string, string> = {};
      if (opts.includeUsers) query.includeUsers = 'true';
      if (opts.includeSecrets) query.includeSecrets = 'true';
      const data = await client.get(`/admin/realms/${name}/export`, query);

      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      const file = opts.output || `${name}.json`;
      writeFileSync(file, JSON.stringify(data, null, 2));
      success(`Realm exported to ${file}`);
    });

  realm
    .command('import <file>')
    .description('Import realm from a JSON file')
    .option('--overwrite', 'Overwrite if realm already exists')
    .option('--json', 'Output as JSON')
    .action(async (file: string, opts) => {
      let raw: string;
      try {
        raw = readFileSync(file, 'utf-8');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: could not read file "${file}": ${msg}`);
        process.exitCode = 1;
        return;
      }
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        console.error(`Error: "${file}" does not contain valid JSON.`);
        process.exitCode = 1;
        return;
      }
      const client = new HttpClient();
      const query: Record<string, string> = {};
      if (opts.overwrite) query.overwrite = 'true';
      const result = await client.post('/admin/realms/import', body, query);
      printResult(result, opts);
    });
}
