import { Command } from 'commander';
import { readFileSync } from 'fs';
import chalk from 'chalk';
import { HttpClient } from '../http.js';
import { printResult, success, warn } from '../output.js';
import { confirm, askPassword } from '../prompt.js';
import type { UserListResponse, BulkUserInput, BulkImportResult } from '../types.js';
import { parseCsv } from '../csv.js';

export function registerUserCommands(program: Command): void {
  const user = program.command('user').description('Manage users');

  user
    .command('list')
    .description('List users in a realm')
    .requiredOption('--realm <realm>', 'Realm name')
    .option('--skip <skip>', 'Number of records to skip', '0')
    .option('--limit <limit>', 'Max records to return', '50')
    .option('--search <query>', 'Search by username or email')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const client = new HttpClient();
      const query: Record<string, string> = { skip: opts.skip, limit: opts.limit };
      if (opts.search) query.search = opts.search;
      const result = await client.get<UserListResponse>(
        `/admin/realms/${opts.realm}/users`,
        query,
      );
      if (!opts.json) {
        console.log(chalk.dim(`Total: ${result.total}`));
        printResult(result.users, opts);
      } else {
        printResult(result, opts);
      }
    });

  user
    .command('create <username>')
    .description('Create a user')
    .requiredOption('--realm <realm>', 'Realm name')
    .option('--email <email>', 'User email')
    .option('--first-name <firstName>', 'First name')
    .option('--last-name <lastName>', 'Last name')
    .option('--password <password>', 'Initial password')
    .option('--disabled', 'Create as disabled')
    .option('--json', 'Output as JSON')
    .action(async (username: string, opts) => {
      const client = new HttpClient();
      const body: Record<string, unknown> = { username };
      if (opts.email) body.email = opts.email;
      if (opts.firstName) body.firstName = opts.firstName;
      if (opts.lastName) body.lastName = opts.lastName;
      if (opts.password) body.password = opts.password;
      if (opts.disabled) body.enabled = false;
      const result = await client.post(`/admin/realms/${opts.realm}/users`, body);
      printResult(result, opts);
    });

  user
    .command('get <id>')
    .description('Get user by ID')
    .requiredOption('--realm <realm>', 'Realm name')
    .option('--json', 'Output as JSON')
    .action(async (id: string, opts) => {
      const client = new HttpClient();
      const result = await client.get(`/admin/realms/${opts.realm}/users/${id}`);
      printResult(result, opts);
    });

  user
    .command('update <id>')
    .description('Update a user')
    .requiredOption('--realm <realm>', 'Realm name')
    .option('--email <email>', 'New email')
    .option('--first-name <firstName>', 'New first name')
    .option('--last-name <lastName>', 'New last name')
    .option('--enable', 'Enable the user')
    .option('--disable', 'Disable the user')
    .option('--json', 'Output as JSON')
    .action(async (id: string, opts) => {
      const client = new HttpClient();
      const body: Record<string, unknown> = {};
      if (opts.email) body.email = opts.email;
      if (opts.firstName) body.firstName = opts.firstName;
      if (opts.lastName) body.lastName = opts.lastName;
      if (opts.enable) body.enabled = true;
      if (opts.disable) body.enabled = false;
      const result = await client.put(`/admin/realms/${opts.realm}/users/${id}`, body);
      printResult(result, opts);
    });

  user
    .command('delete <id>')
    .description('Delete a user')
    .requiredOption('--realm <realm>', 'Realm name')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (id: string, opts) => {
      if (!opts.yes) {
        const ok = await confirm(`Delete user "${id}"?`);
        if (!ok) {
          console.log('Aborted.');
          return;
        }
      }
      const client = new HttpClient();
      await client.delete(`/admin/realms/${opts.realm}/users/${id}`);
      success(`User "${id}" deleted.`);
    });

  user
    .command('set-password <id>')
    .description('Set a user password')
    .requiredOption('--realm <realm>', 'Realm name')
    .option('--password <password>', 'New password (will prompt if not provided)')
    .action(async (id: string, opts) => {
      const password = opts.password || (await askPassword('New password: '));
      const client = new HttpClient();
      await client.put(`/admin/realms/${opts.realm}/users/${id}/reset-password`, { password });
      success(`Password updated for user "${id}".`);
    });

  user
    .command('bulk-import')
    .description('Import users from a CSV or JSON file')
    .requiredOption('--realm <realm>', 'Realm name')
    .requiredOption('--file <file>', 'Path to CSV or JSON file')
    .option('--dry-run', 'Validate without importing')
    .option('--json', 'Output result as JSON')
    .action(async (opts) => {
      const file: string = opts.file;
      const realm: string = opts.realm;
      const isDryRun: boolean = Boolean(opts.dryRun);

      // Parse file
      let users: BulkUserInput[];
      if (file.endsWith('.json')) {
        let raw: string;
        try {
          raw = readFileSync(file, 'utf-8');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Error: could not read file "${file}": ${msg}`);
          process.exitCode = 1;
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Error: could not parse JSON file "${file}": ${msg}`);
          process.exitCode = 1;
          return;
        }
        if (!Array.isArray(parsed)) {
          console.error(`Error: JSON file "${file}" must contain an array of user objects.`);
          process.exitCode = 1;
          return;
        }
        users = parsed as BulkUserInput[];
      } else if (file.endsWith('.csv')) {
        let raw: string;
        try {
          raw = readFileSync(file, 'utf-8');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Error: could not read file "${file}": ${msg}`);
          process.exitCode = 1;
          return;
        }
        users = parseCsv(raw) as unknown as BulkUserInput[];
      } else {
        throw new Error('Unsupported file format. Use .json or .csv');
      }

      console.log(chalk.dim(`Parsed ${users.length} user(s) from ${file}`));

      // Validate
      const validationErrors: Array<{ row: number; username?: string; error: string }> = [];
      const valid: Array<{ user: BulkUserInput; row: number }> = [];

      for (let i = 0; i < users.length; i++) {
        const u = users[i];
        const rowNum = i + 1;
        if (!u.username || typeof u.username !== 'string' || u.username.trim() === '') {
          validationErrors.push({ row: rowNum, error: 'Missing or empty "username" field' });
          continue;
        }
        if (u.email !== undefined && typeof u.email !== 'string') {
          validationErrors.push({ row: rowNum, username: u.username, error: 'Invalid "email" field' });
          continue;
        }
        valid.push({ user: u, row: rowNum });
      }

      if (validationErrors.length > 0) {
        console.log(chalk.yellow(`\nValidation errors (${validationErrors.length}):`));
        for (const e of validationErrors) {
          const loc = e.username ? `row ${e.row} (${e.username})` : `row ${e.row}`;
          console.log(chalk.red(`  ${loc}: ${e.error}`));
        }
      }

      if (isDryRun) {
        console.log(chalk.dim(`\nDry run complete. ${valid.length} valid, ${validationErrors.length} invalid.`));
        return;
      }

      if (valid.length === 0) {
        console.log(chalk.yellow('No valid users to import.'));
        return;
      }

      // Import with progress
      const result: BulkImportResult = {
        imported: 0,
        failed: validationErrors.length,
        errors: [...validationErrors],
      };

      const client = new HttpClient();
      for (let i = 0; i < valid.length; i++) {
        const { user: u, row } = valid[i];
        const pct = Math.round(((i + 1) / valid.length) * 100);
        process.stdout.write(`\r${chalk.dim(`Importing... ${i + 1}/${valid.length} (${pct}%)`)}  `);
        try {
          const body: Record<string, unknown> = { username: u.username };
          if (u.email) body.email = u.email;
          if (u.firstName) body.firstName = u.firstName;
          if (u.lastName) body.lastName = u.lastName;
          if (u.password) body.password = u.password;
          if (u.enabled !== undefined) body.enabled = u.enabled;
          await client.post(`/admin/realms/${realm}/users`, body);
          result.imported++;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          result.failed++;
          result.errors.push({ row, username: u.username, error: msg });
        }
      }
      process.stdout.write('\n');

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(`\n${chalk.green('Imported:')} ${result.imported}`);
      if (result.failed > 0) {
        warn(`Failed: ${result.failed}`);
        for (const e of result.errors) {
          const loc = e.username ? `row ${e.row} (${e.username})` : `row ${e.row}`;
          console.log(chalk.red(`  ${loc}: ${e.error}`));
        }
      } else {
        success(`All ${result.imported} user(s) imported successfully.`);
      }
    });
}
