import { z } from 'zod';
import type { IdenplaneClient } from '../client.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const RealmSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string().optional(),
  enabled: z.boolean().optional(),
  createdAt: z.string().optional(),
});

export type Realm = z.infer<typeof RealmSchema>;

export function registerRealmTools(server: McpServer, client: IdenplaneClient): void {
  server.registerTool(
    'list_realms',
    {
      description:
        'List all realms on this Idenplane instance. Returns an array of realm objects with name, displayName, and enabled status.',
      inputSchema: {},
    },
    async () => {
      const realms = await client.get<Realm[]>('/admin/realms');
      return {
        content: [{ type: 'text', text: JSON.stringify(realms, null, 2) }],
      };
    },
  );

  server.registerTool(
    'get_realm',
    {
      description:
        'Get details for a specific realm by name. Returns the full realm configuration.',
      inputSchema: {
        realmName: z.string().describe('The realm name (slug, not display name)'),
      },
    },
    async ({ realmName }) => {
      const realm = await client.get<Realm>(`/admin/realms/${realmName}`);
      return {
        content: [{ type: 'text', text: JSON.stringify(realm, null, 2) }],
      };
    },
  );

  server.registerTool(
    'create_realm',
    {
      description:
        '[WRITE] Create a new realm. A realm is an isolated tenant namespace for users, clients, and roles.',
      inputSchema: {
        name: z.string().describe('Unique realm name (lowercase, no spaces)'),
        displayName: z.string().optional().describe('Human-readable display name'),
        enabled: z
          .boolean()
          .optional()
          .default(true)
          .describe('Whether the realm is enabled (default: true)'),
      },
    },
    async ({ name, displayName, enabled }) => {
      const body: Record<string, unknown> = { name };
      if (displayName !== undefined) body['displayName'] = displayName;
      if (enabled !== undefined) body['enabled'] = enabled;
      const realm = await client.post<Realm>('/admin/realms', body);
      return {
        content: [{ type: 'text', text: JSON.stringify(realm, null, 2) }],
      };
    },
  );
}
