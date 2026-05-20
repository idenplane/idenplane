import { Command } from 'commander';
import { HttpClient } from '../http.js';
import { printResult, success } from '../output.js';
import { confirm } from '../prompt.js';

export function registerClientCommands(program: Command): void {
  const client = program.command('client').description('Manage clients');

  client
    .command('list')
    .description('List clients in a realm')
    .requiredOption('--realm <realm>', 'Realm name')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const http = new HttpClient();
      const result = await http.get(`/admin/realms/${opts.realm}/clients`);
      printResult(result, opts);
    });

  client
    .command('create <clientId>')
    .description('Create a client')
    .requiredOption('--realm <realm>', 'Realm name')
    .option('--name <name>', 'Display name')
    .option('--type <type>', 'Client type: CONFIDENTIAL or PUBLIC', 'CONFIDENTIAL')
    .option('--redirect-uris <uris...>', 'Redirect URIs (space-separated)')
    .option('--web-origins <origins...>', 'Web origins (space-separated)')
    .option('--grant-types <types...>', 'Grant types (space-separated)')
    .option('--json', 'Output as JSON')
    .action(async (clientId: string, opts) => {
      const http = new HttpClient();
      const body: Record<string, unknown> = { clientId };
      if (opts.name) body.name = opts.name;
      if (opts.type) body.clientType = opts.type;
      if (opts.redirectUris) body.redirectUris = opts.redirectUris;
      if (opts.webOrigins) body.webOrigins = opts.webOrigins;
      if (opts.grantTypes) body.grantTypes = opts.grantTypes;
      const result = await http.post(`/admin/realms/${opts.realm}/clients`, body);
      printResult(result, opts);
    });

  client
    .command('get <clientId>')
    .description('Get client details')
    .requiredOption('--realm <realm>', 'Realm name')
    .option('--json', 'Output as JSON')
    .action(async (clientId: string, opts) => {
      const http = new HttpClient();
      const result = await http.get(`/admin/realms/${opts.realm}/clients/${clientId}`);
      printResult(result, opts);
    });

  client
    .command('update <clientId>')
    .description('Update a client')
    .requiredOption('--realm <realm>', 'Realm name')
    .option('--name <name>', 'New display name')
    .option('--redirect-uris <uris...>', 'New redirect URIs (space-separated)')
    .option('--web-origins <origins...>', 'New web origins (space-separated)')
    .option('--grant-types <types...>', 'New grant types (space-separated)')
    .option('--enable', 'Enable the client')
    .option('--disable', 'Disable the client')
    .option('--json', 'Output as JSON')
    .action(async (clientId: string, opts) => {
      const http = new HttpClient();
      const body: Record<string, unknown> = {};
      if (opts.name) body.name = opts.name;
      if (opts.redirectUris) body.redirectUris = opts.redirectUris;
      if (opts.webOrigins) body.webOrigins = opts.webOrigins;
      if (opts.grantTypes) body.grantTypes = opts.grantTypes;
      if (opts.enable) body.enabled = true;
      if (opts.disable) body.enabled = false;
      const result = await http.put(`/admin/realms/${opts.realm}/clients/${clientId}`, body);
      printResult(result, opts);
    });

  client
    .command('delete <clientId>')
    .description('Delete a client')
    .requiredOption('--realm <realm>', 'Realm name')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (clientId: string, opts) => {
      if (!opts.yes) {
        const ok = await confirm(`Delete client "${clientId}"?`);
        if (!ok) {
          console.log('Aborted.');
          return;
        }
      }
      const http = new HttpClient();
      await http.delete(`/admin/realms/${opts.realm}/clients/${clientId}`);
      success(`Client "${clientId}" deleted.`);
    });

  client
    .command('rotate-secret <clientId>')
    .description('Rotate the client secret for a CONFIDENTIAL client')
    .requiredOption('--realm <realm>', 'Realm name')
    .option('--json', 'Output as JSON')
    .action(async (clientId: string, opts) => {
      const http = new HttpClient();
      const result = await http.post(
        `/admin/realms/${opts.realm}/clients/${clientId}/rotate-secret`,
      );
      printResult(result, opts);
    });
}
