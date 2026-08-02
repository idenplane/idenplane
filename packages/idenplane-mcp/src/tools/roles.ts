import { z } from 'zod';
import type { IdenplaneClient } from '../client.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { pathSegment } from '../schemas.js';

const RoleSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  composite: z.boolean().optional(),
});

/** A realm role, inferred from {@link RoleSchema}. */
export type Role = z.infer<typeof RoleSchema>;

/**
 * Registers role MCP tools on `server`:
 *
 * - `list_roles` (read-only) — List all realm roles defined in a realm.
 * - `assign_role` (`[WRITE]`) — Assign one or more realm roles to a user, additively
 *   (existing role assignments are preserved).
 */
export function registerRoleTools(server: McpServer, client: IdenplaneClient): void {
  server.registerTool(
    'list_roles',
    {
      description: 'List all realm roles defined in a realm.',
      inputSchema: {
        realmName: pathSegment('Realm to list roles from'),
      },
    },
    async ({ realmName }) => {
      const roles = await client.get<Role[]>(`/admin/realms/${realmName}/roles`);
      return {
        content: [{ type: 'text', text: JSON.stringify(roles, null, 2) }],
      };
    },
  );

  server.registerTool(
    'assign_role',
    {
      description:
        '[WRITE] Assign one or more realm roles to a user. Roles are additive — existing assignments are preserved.',
      inputSchema: {
        realmName: pathSegment('Realm the user and roles belong to'),
        userId: pathSegment('User ID (UUID)'),
        roleNames: z.array(z.string()).min(1).describe('One or more role names to assign'),
      },
    },
    async ({ realmName, userId, roleNames }) => {
      await client.post(`/admin/realms/${realmName}/users/${userId}/role-mappings/realm`, {
        roleNames,
      });
      const assigned = await client.get<Role[]>(
        `/admin/realms/${realmName}/users/${userId}/role-mappings/realm`,
      );
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { userId, allAssignedRoles: assigned.map((r) => r.name) },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
