import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getConfig, IdenplaneClient, toToolError } from './client.js';
import { registerRealmTools } from './tools/realms.js';
import { registerClientTools } from './tools/clients.js';
import { registerUserTools } from './tools/users.js';
import { registerRoleTools } from './tools/roles.js';
import { registerGroupTools } from './tools/groups.js';
import { registerSessionTools } from './tools/sessions.js';
import { registerAuditTools } from './tools/audit.js';

// Report the published version; package.json is always in the tarball.
const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

async function main(): Promise<void> {
  const config = getConfig();
  const apiClient = new IdenplaneClient(config);

  const server = new McpServer({
    name: 'idenplane-mcp',
    version,
  });

  registerRealmTools(server, apiClient);
  registerClientTools(server, apiClient);
  registerUserTools(server, apiClient);
  registerRoleTools(server, apiClient);
  registerGroupTools(server, apiClient);
  registerSessionTools(server, apiClient);
  registerAuditTools(server, apiClient);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  const message = toToolError(err);
  process.stderr.write(`Fatal: ${message}\n`);
  process.exit(1);
});
