import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getConfig, IdenplaneClient, toToolError } from './client.js';
import { registerRealmTools } from './tools/realms.js';
import { registerClientTools } from './tools/clients.js';
import { registerUserTools } from './tools/users.js';
import { registerRoleTools } from './tools/roles.js';
import { registerSessionTools } from './tools/sessions.js';
import { registerAuditTools } from './tools/audit.js';

async function main(): Promise<void> {
  const config = getConfig();
  const apiClient = new IdenplaneClient(config);

  const server = new McpServer({
    name: '@idenplane/mcp',
    version: '0.1.0',
  });

  registerRealmTools(server, apiClient);
  registerClientTools(server, apiClient);
  registerUserTools(server, apiClient);
  registerRoleTools(server, apiClient);
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
