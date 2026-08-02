import { z } from 'zod';
import type { IdenplaneClient } from '../client.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { pathSegment } from '../schemas.js';

const SessionSchema = z.object({
  id: z.string(),
  userId: z.string().optional(),
  username: z.string().optional(),
  clientId: z.string().optional(),
  ipAddress: z.string().optional(),
  start: z.number().optional(),
  lastAccess: z.number().optional(),
});

/** An active login session, inferred from {@link SessionSchema}. */
export type Session = z.infer<typeof SessionSchema>;

/**
 * Registers session MCP tools on `server`:
 *
 * - `list_active_sessions` (read-only) — List active login sessions in a realm,
 *   optionally filtered to a specific user.
 * - `revoke_session` (`[DESTRUCTIVE]`) — Revoke (terminate) a specific active
 *   session by ID, logging that user out immediately.
 */
export function registerSessionTools(server: McpServer, client: IdenplaneClient): void {
  server.registerTool(
    'list_active_sessions',
    {
      description:
        'List all active login sessions in a realm. Optionally filter to sessions for a specific user.',
      inputSchema: {
        realmName: pathSegment('Realm to query sessions from'),
        userId: pathSegment('If set, only return sessions for this user ID').optional(),
      },
    },
    async ({ realmName, userId }) => {
      const path =
        userId !== undefined
          ? `/admin/realms/${realmName}/users/${userId}/sessions`
          : `/admin/realms/${realmName}/sessions`;
      const sessions = await client.get<Session[]>(path);
      return {
        content: [{ type: 'text', text: JSON.stringify(sessions, null, 2) }],
      };
    },
  );

  server.registerTool(
    'revoke_session',
    {
      description:
        '[DESTRUCTIVE] Revoke (terminate) a specific active session by its session ID. The user will be logged out of that session immediately.',
      inputSchema: {
        realmName: pathSegment('Realm the session belongs to'),
        sessionId: pathSegment('Session ID to revoke'),
      },
    },
    async ({ realmName, sessionId }) => {
      await client.delete(`/admin/realms/${realmName}/sessions/${sessionId}`);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ revoked: true, sessionId }, null, 2),
          },
        ],
      };
    },
  );
}
