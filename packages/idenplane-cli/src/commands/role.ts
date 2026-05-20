import { Command } from 'commander';
import { HttpClient } from '../http.js';
import { printResult, success } from '../output.js';
import { confirm } from '../prompt.js';

export function registerRoleCommands(program: Command): void {
  const role = program.command('role').description('Manage roles');

  role
    .command('list')
    .description('List realm roles')
    .requiredOption('--realm <realm>', 'Realm name')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const client = new HttpClient();
      const result = await client.get(`/admin/realms/${opts.realm}/roles`);
      printResult(result, opts);
    });

  role
    .command('create <name>')
    .description('Create a realm role')
    .requiredOption('--realm <realm>', 'Realm name')
    .option('--description <desc>', 'Role description')
    .option('--json', 'Output as JSON')
    .action(async (name: string, opts) => {
      const client = new HttpClient();
      const body: Record<string, unknown> = { name };
      if (opts.description) body.description = opts.description;
      const result = await client.post(`/admin/realms/${opts.realm}/roles`, body);
      printResult(result, opts);
    });

  role
    .command('get <name>')
    .description('Get role details')
    .requiredOption('--realm <realm>', 'Realm name')
    .option('--json', 'Output as JSON')
    .action(async (name: string, opts) => {
      const client = new HttpClient();
      const result = await client.get(`/admin/realms/${opts.realm}/roles/${name}`);
      printResult(result, opts);
    });

  role
    .command('update <name>')
    .description('Update a realm role')
    .requiredOption('--realm <realm>', 'Realm name')
    .option('--description <desc>', 'New role description')
    .option('--json', 'Output as JSON')
    .action(async (name: string, opts) => {
      const client = new HttpClient();
      const body: Record<string, unknown> = {};
      if (opts.description !== undefined) body.description = opts.description;
      const result = await client.put(`/admin/realms/${opts.realm}/roles/${name}`, body);
      printResult(result, opts);
    });

  role
    .command('delete <name>')
    .description('Delete a realm role')
    .requiredOption('--realm <realm>', 'Realm name')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (name: string, opts) => {
      if (!opts.yes) {
        const ok = await confirm(`Delete role "${name}"?`);
        if (!ok) {
          console.log('Aborted.');
          return;
        }
      }
      const client = new HttpClient();
      await client.delete(`/admin/realms/${opts.realm}/roles/${name}`);
      success(`Role "${name}" deleted.`);
    });

  role
    .command('assign <userId> <roleName>')
    .description('Assign a realm role to a user')
    .requiredOption('--realm <realm>', 'Realm name')
    .action(async (userId: string, roleName: string, opts) => {
      const client = new HttpClient();
      await client.post(
        `/admin/realms/${opts.realm}/users/${userId}/role-mappings/realm`,
        { roleNames: [roleName] },
      );
      success(`Role "${roleName}" assigned to user "${userId}".`);
    });

  role
    .command('unassign <userId> <roleName>')
    .description('Remove a realm role from a user')
    .requiredOption('--realm <realm>', 'Realm name')
    .action(async (userId: string, roleName: string, opts) => {
      const client = new HttpClient();
      await client.delete(
        `/admin/realms/${opts.realm}/users/${userId}/role-mappings/realm`,
        { roleNames: [roleName] },
      );
      success(`Role "${roleName}" removed from user "${userId}".`);
    });

  // Keep 'remove' as an alias for backward compat
  role
    .command('remove <userId> <roleName>')
    .description('Remove a realm role from a user (alias for unassign)')
    .requiredOption('--realm <realm>', 'Realm name')
    .action(async (userId: string, roleName: string, opts) => {
      const client = new HttpClient();
      await client.delete(
        `/admin/realms/${opts.realm}/users/${userId}/role-mappings/realm`,
        { roleNames: [roleName] },
      );
      success(`Role "${roleName}" removed from user "${userId}".`);
    });
}
