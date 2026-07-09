import { z } from 'zod';
import type { IdenplaneClient } from '../client.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const UserSchema = z.object({
  id: z.string(),
  username: z.string(),
  email: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  enabled: z.boolean().optional(),
  createdTimestamp: z.number().optional(),
});

const UserListResponseSchema = z.object({
  users: z.array(UserSchema),
  total: z.number(),
});

export type User = z.infer<typeof UserSchema>;
export type UserListResponse = z.infer<typeof UserListResponseSchema>;

export function registerUserTools(server: McpServer, client: IdenplaneClient): void {
  server.registerTool(
    'list_users',
    {
      description:
        'List users in a realm with optional search and pagination. Returns an array of user objects.',
      inputSchema: {
        realmName: z.string().describe('Realm to list users from'),
        search: z.string().optional().describe('Search by username or email (partial match)'),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .default(50)
          .describe('Max users to return (default: 50)'),
        skip: z.number().int().nonnegative().optional().default(0).describe('Records to skip for pagination (default: 0)'),
      },
    },
    async ({ realmName, search, limit, skip }) => {
      const query: Record<string, string | undefined> = {
        limit: String(limit ?? 50),
        skip: String(skip ?? 0),
        search,
      };
      const result = await client.get<UserListResponse>(
        `/admin/realms/${realmName}/users`,
        query,
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    'get_user',
    {
      description: 'Get full details for a specific user by their ID.',
      inputSchema: {
        realmName: z.string().describe('Realm the user belongs to'),
        userId: z.string().describe('User ID (UUID)'),
      },
    },
    async ({ realmName, userId }) => {
      const user = await client.get<User>(`/admin/realms/${realmName}/users/${userId}`);
      return {
        content: [{ type: 'text', text: JSON.stringify(user, null, 2) }],
      };
    },
  );

  server.registerTool(
    'create_user',
    {
      description:
        '[WRITE] Create a new user in a realm. Username is required; all other fields are optional.',
      inputSchema: {
        realmName: z.string().describe('Realm to create the user in'),
        username: z.string().describe('Unique username within the realm'),
        email: z.string().email().optional().describe('User email address'),
        firstName: z.string().optional().describe("User's first name"),
        lastName: z.string().optional().describe("User's last name"),
        password: z.string().optional().describe('Initial password (plaintext, stored hashed)'),
        enabled: z
          .boolean()
          .optional()
          .default(true)
          .describe('Whether the account is active (default: true)'),
      },
    },
    async ({ realmName, username, email, firstName, lastName, password, enabled }) => {
      const body: Record<string, unknown> = { username };
      if (email !== undefined) body['email'] = email;
      if (firstName !== undefined) body['firstName'] = firstName;
      if (lastName !== undefined) body['lastName'] = lastName;
      if (password !== undefined) body['password'] = password;
      if (enabled !== undefined) body['enabled'] = enabled;
      const user = await client.post<User>(`/admin/realms/${realmName}/users`, body);
      return {
        content: [{ type: 'text', text: JSON.stringify(user, null, 2) }],
      };
    },
  );

  server.registerTool(
    'set_user_roles',
    {
      description:
        '[WRITE] Replace the complete set of realm roles for a user. Removes all existing role assignments and adds the specified roles. Pass an empty array to strip all roles.',
      inputSchema: {
        realmName: z.string().describe('Realm the user belongs to'),
        userId: z.string().describe('User ID (UUID)'),
        roleNames: z
          .array(z.string())
          .describe('Complete list of role names to assign (replaces existing assignments)'),
      },
    },
    async ({ realmName, userId, roleNames }) => {
      const existingRoles = await client.get<Array<{ name: string }>>(
        `/admin/realms/${realmName}/users/${userId}/role-mappings/realm`,
      );
      if (existingRoles.length > 0) {
        await client.delete(
          `/admin/realms/${realmName}/users/${userId}/role-mappings/realm`,
          { roleNames: existingRoles.map((r) => r.name) },
        );
      }
      if (roleNames.length > 0) {
        await client.post(`/admin/realms/${realmName}/users/${userId}/role-mappings/realm`, {
          roleNames,
        });
      }
      const updated = await client.get<Array<{ name: string }>>(
        `/admin/realms/${realmName}/users/${userId}/role-mappings/realm`,
      );
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { userId, assignedRoles: updated.map((r) => r.name) },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
