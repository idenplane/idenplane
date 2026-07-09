import { z } from 'zod';
import type { IdenplaneClient } from '../client.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const LoginEventSchema = z.object({
  id: z.string().optional(),
  type: z.string().optional(),
  realmId: z.string().optional(),
  clientId: z.string().optional(),
  userId: z.string().optional(),
  ipAddress: z.string().optional(),
  time: z.number().optional(),
  details: z.record(z.string()).optional(),
});

const AdminEventSchema = z.object({
  id: z.string().optional(),
  time: z.number().optional(),
  realmId: z.string().optional(),
  operationType: z.string().optional(),
  resourceType: z.string().optional(),
  resourcePath: z.string().optional(),
  representation: z.string().optional(),
  error: z.string().optional(),
});

export type LoginEvent = z.infer<typeof LoginEventSchema>;
export type AdminEvent = z.infer<typeof AdminEventSchema>;

export function registerAuditTools(server: McpServer, client: IdenplaneClient): void {
  server.registerTool(
    'query_audit_events',
    {
      description:
        'Query audit/event logs for a realm. Supports filtering by user, event type, and time window. Returns both user-facing login events and admin operation events.',
      inputSchema: {
        realmName: z.string().describe('Realm to query events from'),
        kind: z
          .enum(['login', 'admin', 'both'])
          .optional()
          .default('both')
          .describe('Type of events to retrieve: "login" (user auth events), "admin" (admin API operations), or "both" (default)'),
        userId: z.string().optional().describe('Filter to events for a specific user ID'),
        type: z
          .string()
          .optional()
          .describe(
            'Filter login events by event type (e.g. LOGIN, LOGOUT, LOGIN_ERROR, REGISTER, UPDATE_PASSWORD)',
          ),
        dateFrom: z
          .string()
          .optional()
          .describe('Start of time window in ISO 8601 format (e.g. 2024-01-01T00:00:00Z)'),
        dateTo: z
          .string()
          .optional()
          .describe('End of time window in ISO 8601 format (e.g. 2024-12-31T23:59:59Z)'),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .default(50)
          .describe('Max events to return per category (default: 50)'),
      },
    },
    async ({ realmName, kind, userId, type, dateFrom, dateTo, limit }) => {
      const effectiveKind = kind ?? 'both';
      const maxResults = String(limit ?? 50);

      const results: { loginEvents?: LoginEvent[]; adminEvents?: AdminEvent[] } = {};

      if (effectiveKind === 'login' || effectiveKind === 'both') {
        const query: Record<string, string | undefined> = {
          max: maxResults,
          userId,
          type,
          dateFrom,
          dateTo,
        };
        results['loginEvents'] = await client.get<LoginEvent[]>(
          `/admin/realms/${realmName}/events`,
          query,
        );
      }

      if (effectiveKind === 'admin' || effectiveKind === 'both') {
        const query: Record<string, string | undefined> = {
          max: maxResults,
          dateFrom,
          dateTo,
        };
        results['adminEvents'] = await client.get<AdminEvent[]>(
          `/admin/realms/${realmName}/admin-events`,
          query,
        );
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
      };
    },
  );
}
