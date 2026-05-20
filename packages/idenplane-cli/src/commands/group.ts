import { Command } from 'commander';
import { HttpClient } from '../http.js';
import { printResult, success } from '../output.js';
import { confirm } from '../prompt.js';

export function registerGroupCommands(program: Command): void {
  const group = program.command('group').description('Manage groups');

  group
    .command('list')
    .description('List groups in a realm')
    .requiredOption('--realm <realm>', 'Realm name')
    .option('--search <query>', 'Search by group name')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const client = new HttpClient();
      const query: Record<string, string> = {};
      if (opts.search) query.search = opts.search;
      const result = await client.get(`/admin/realms/${opts.realm}/groups`, query);
      printResult(result, opts);
    });

  group
    .command('create <name>')
    .description('Create a group')
    .requiredOption('--realm <realm>', 'Realm name')
    .option('--parent <parentId>', 'Parent group ID (for nested groups)')
    .option('--json', 'Output as JSON')
    .action(async (name: string, opts) => {
      const client = new HttpClient();
      const body: Record<string, unknown> = { name };
      if (opts.parent) body.parentId = opts.parent;
      const result = await client.post(`/admin/realms/${opts.realm}/groups`, body);
      printResult(result, opts);
    });

  group
    .command('get <id>')
    .description('Get group details')
    .requiredOption('--realm <realm>', 'Realm name')
    .option('--json', 'Output as JSON')
    .action(async (id: string, opts) => {
      const client = new HttpClient();
      const result = await client.get(`/admin/realms/${opts.realm}/groups/${id}`);
      printResult(result, opts);
    });

  group
    .command('update <id>')
    .description('Update a group')
    .requiredOption('--realm <realm>', 'Realm name')
    .option('--name <name>', 'New group name')
    .option('--json', 'Output as JSON')
    .action(async (id: string, opts) => {
      const client = new HttpClient();
      const body: Record<string, unknown> = {};
      if (opts.name) body.name = opts.name;
      const result = await client.put(`/admin/realms/${opts.realm}/groups/${id}`, body);
      printResult(result, opts);
    });

  group
    .command('delete <id>')
    .description('Delete a group')
    .requiredOption('--realm <realm>', 'Realm name')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (id: string, opts) => {
      if (!opts.yes) {
        const ok = await confirm(`Delete group "${id}"?`);
        if (!ok) {
          console.log('Aborted.');
          return;
        }
      }
      const client = new HttpClient();
      await client.delete(`/admin/realms/${opts.realm}/groups/${id}`);
      success(`Group "${id}" deleted.`);
    });
}
