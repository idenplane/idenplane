import { z } from 'zod';
import type { IdenplaneClient } from '../client.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const ClientSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  protocol: z.string().optional(),
  publicClient: z.boolean().optional(),
  redirectUris: z.array(z.string()).optional(),
});

export type OidcClient = z.infer<typeof ClientSchema>;

export function registerClientTools(server: McpServer, client: IdenplaneClient): void {
  server.registerTool(
    'list_clients',
    {
      description:
        'List all OAuth2/OIDC clients registered in a realm. Returns client IDs, names, and configuration.',
      inputSchema: {
        realmName: z.string().describe('Realm name to list clients from'),
      },
    },
    async ({ realmName }) => {
      const clients = await client.get<OidcClient[]>(`/admin/realms/${realmName}/clients`);
      return {
        content: [{ type: 'text', text: JSON.stringify(clients, null, 2) }],
      };
    },
  );

  server.registerTool(
    'create_client',
    {
      description:
        '[WRITE] Register a new OAuth2/OIDC client in a realm. Clients represent applications that delegate authentication to Idenplane.',
      inputSchema: {
        realmName: z.string().describe('Realm to create the client in'),
        clientId: z
          .string()
          .describe('Unique client identifier (e.g. "my-app", "backend-service")'),
        name: z.string().optional().describe('Human-readable client name'),
        description: z.string().optional().describe('Optional description'),
        publicClient: z
          .boolean()
          .optional()
          .default(false)
          .describe('True for SPAs/native apps that cannot keep a secret (default: false)'),
        redirectUris: z
          .array(z.string())
          .optional()
          .describe('Allowed redirect URIs after authentication'),
      },
    },
    async ({ realmName, clientId, name, description, publicClient, redirectUris }) => {
      const body: Record<string, unknown> = { clientId };
      if (name !== undefined) body['name'] = name;
      if (description !== undefined) body['description'] = description;
      if (publicClient !== undefined) body['publicClient'] = publicClient;
      if (redirectUris !== undefined) body['redirectUris'] = redirectUris;
      const created = await client.post<OidcClient>(`/admin/realms/${realmName}/clients`, body);
      return {
        content: [{ type: 'text', text: JSON.stringify(created, null, 2) }],
      };
    },
  );
}
