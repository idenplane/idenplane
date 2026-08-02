import { z } from 'zod';
import type { IdenplaneClient } from '../client.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { pathSegment } from '../schemas.js';

const GroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  parentId: z.string().optional(),
});

export type Group = z.infer<typeof GroupSchema>;

export function registerGroupTools(server: McpServer, client: IdenplaneClient): void {
  server.registerTool(
    'list_groups',
    {
      description: 'List all groups defined in a realm.',
      inputSchema: {
        realmName: pathSegment('Realm to list groups from'),
      },
    },
    async ({ realmName }) => {
      const groups = await client.get<Group[]>(`/admin/realms/${realmName}/groups`);
      return {
        content: [{ type: 'text', text: JSON.stringify(groups, null, 2) }],
      };
    },
  );

  server.registerTool(
    'get_group',
    {
      description: 'Get full details for a specific group by its ID.',
      inputSchema: {
        realmName: pathSegment('Realm the group belongs to'),
        groupId: pathSegment('Group ID (UUID)'),
      },
    },
    async ({ realmName, groupId }) => {
      const group = await client.get<Group>(`/admin/realms/${realmName}/groups/${groupId}`);
      return {
        content: [{ type: 'text', text: JSON.stringify(group, null, 2) }],
      };
    },
  );

  server.registerTool(
    'create_group',
    {
      description:
        '[WRITE] Create a new group in a realm. Name is required. Pass parentId to nest the group under an existing group.',
      inputSchema: {
        realmName: pathSegment('Realm to create the group in'),
        name: z.string().describe('Unique group name within the realm'),
        description: z.string().optional().describe('Group description'),
        parentId: z.string().optional().describe('Parent group ID (UUID) to nest this group under'),
      },
    },
    async ({ realmName, name, description, parentId }) => {
      const body: Record<string, unknown> = { name };
      if (description !== undefined) body['description'] = description;
      if (parentId !== undefined) body['parentId'] = parentId;
      const group = await client.post<Group>(`/admin/realms/${realmName}/groups`, body);
      return {
        content: [{ type: 'text', text: JSON.stringify(group, null, 2) }],
      };
    },
  );

  server.registerTool(
    'update_group',
    {
      description:
        '[WRITE] Update a group. Only the provided fields are changed; omitted fields are left as-is.',
      inputSchema: {
        realmName: pathSegment('Realm the group belongs to'),
        groupId: pathSegment('Group ID (UUID)'),
        name: z.string().optional().describe('New group name'),
        description: z.string().optional().describe('New group description'),
        parentId: z.string().optional().describe('New parent group ID (UUID)'),
      },
    },
    async ({ realmName, groupId, name, description, parentId }) => {
      const body: Record<string, unknown> = {};
      if (name !== undefined) body['name'] = name;
      if (description !== undefined) body['description'] = description;
      if (parentId !== undefined) body['parentId'] = parentId;
      const group = await client.put<Group>(
        `/admin/realms/${realmName}/groups/${groupId}`,
        body,
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(group, null, 2) }],
      };
    },
  );

  server.registerTool(
    'delete_group',
    {
      description: '[WRITE] Delete a group from a realm. This cannot be undone.',
      inputSchema: {
        realmName: pathSegment('Realm the group belongs to'),
        groupId: pathSegment('Group ID (UUID) to delete'),
      },
    },
    async ({ realmName, groupId }) => {
      await client.delete(`/admin/realms/${realmName}/groups/${groupId}`);
      return {
        content: [{ type: 'text', text: JSON.stringify({ deleted: true, groupId }, null, 2) }],
      };
    },
  );

  server.registerTool(
    'add_group_member',
    {
      description: '[WRITE] Add a user to a group.',
      inputSchema: {
        realmName: pathSegment('Realm the user and group belong to'),
        userId: pathSegment('User ID (UUID) to add'),
        groupId: pathSegment('Group ID (UUID) to add the user to'),
      },
    },
    async ({ realmName, userId, groupId }) => {
      await client.post(`/admin/realms/${realmName}/users/${userId}/groups/${groupId}`);
      return {
        content: [{ type: 'text', text: JSON.stringify({ added: true, userId, groupId }, null, 2) }],
      };
    },
  );

  server.registerTool(
    'remove_group_member',
    {
      description: '[WRITE] Remove a user from a group.',
      inputSchema: {
        realmName: pathSegment('Realm the user and group belong to'),
        userId: pathSegment('User ID (UUID) to remove'),
        groupId: pathSegment('Group ID (UUID) to remove the user from'),
      },
    },
    async ({ realmName, userId, groupId }) => {
      await client.delete(`/admin/realms/${realmName}/users/${userId}/groups/${groupId}`);
      return {
        content: [
          { type: 'text', text: JSON.stringify({ removed: true, userId, groupId }, null, 2) },
        ],
      };
    },
  );
}
