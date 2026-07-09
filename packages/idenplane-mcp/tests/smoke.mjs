/**
 * Smoke test: spawns the MCP server and verifies all 14 tools are listed.
 * Does NOT require a running Idenplane instance — uses dummy env vars.
 * tools/list does not invoke handlers, so no network calls are made.
 *
 * Run: node tests/smoke.mjs
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, '..', 'dist', 'index.js');

const EXPECTED_TOOLS = [
  'list_realms',
  'get_realm',
  'create_realm',
  'list_clients',
  'create_client',
  'list_users',
  'get_user',
  'create_user',
  'set_user_roles',
  'list_roles',
  'assign_role',
  'list_active_sessions',
  'revoke_session',
  'query_audit_events',
];

describe('MCP server smoke test', () => {
  it('lists all 14 expected tools without a live Idenplane instance', async () => {
    const transport = new StdioClientTransport({
      command: 'node',
      args: [serverPath],
      env: {
        ...process.env,
        IDENPLANE_URL: 'http://localhost:9999',
        IDENPLANE_ADMIN_TOKEN: 'dummy',
      },
    });

    const client = new Client({ name: 'smoke-test-client', version: '0.0.1' });
    await client.connect(transport);

    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      const expected = [...EXPECTED_TOOLS].sort();

      assert.deepEqual(
        names,
        expected,
        `Expected tools: ${expected.join(', ')}\nGot: ${names.join(', ')}`,
      );
    } finally {
      await client.close();
    }
  });
});
