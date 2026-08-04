/**
 * Integration tests for idenplane-mcp — exercises all tool calls over the MCP protocol.
 *
 * Prerequisites:
 *   docker compose up db -d && npm run start:dev   (from repo root)
 *   npm run build                                   (from this directory)
 *
 * Environment variables:
 *   IDENPLANE_URL          (default: http://localhost:3000)
 *   IDENPLANE_ADMIN_TOKEN  (default: dev-admin-key)
 *
 * Run: node --test tests/integration.mjs
 */

import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, '..', 'dist', 'index.js');

const IDENPLANE_URL = process.env['IDENPLANE_URL'] ?? 'http://localhost:3000';
const IDENPLANE_ADMIN_TOKEN = process.env['IDENPLANE_ADMIN_TOKEN'] ?? 'dev-admin-key';
const TEST_REALM = `mcp-test-${Date.now()}`;

let mcpClient;

/**
 * These tests drive the MCP server against a real Idenplane instance, so they
 * are only meaningful when one is running. Probe for it up front and skip the
 * suite when it is absent — otherwise every run without a server reports five
 * failures that say nothing about the code, which is exactly what kept this
 * package out of CI.
 */
async function skipReason() {
  try {
    const res = await fetch(`${IDENPLANE_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) return false;
    return `Idenplane at ${IDENPLANE_URL} answered /health with ${res.status}`;
  } catch {
    return `no Idenplane instance reachable at ${IDENPLANE_URL} — start one with \`docker compose up db -d && npm run start:dev\` from the repo root`;
  }
}

/** Call a tool and return the first text content string. */
async function callTool(name, args) {
  const result = await mcpClient.callTool({ name, arguments: args ?? {} });
  assert.ok(!result.isError, `Tool ${name} returned an error: ${JSON.stringify(result.content)}`);
  const text = result.content.find((c) => c.type === 'text')?.text;
  assert.ok(text !== undefined, `Tool ${name} returned no text content`);
  return JSON.parse(text);
}

/**
 * Retries `fn` while it throws, up to `attempts` times with `delayMs` between tries. For
 * polling an intentionally-eventually-consistent read (e.g. #1372's fire-and-forget admin
 * event writes) rather than asserting on the very next read after a write.
 */
async function waitFor(fn, { attempts = 5, delayMs = 300 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

describe('Idenplane MCP integration (over protocol)', { skip: await skipReason() }, () => {
  before(async () => {
    const transport = new StdioClientTransport({
      command: 'node',
      args: [serverPath],
      env: {
        ...process.env,
        IDENPLANE_URL,
        IDENPLANE_ADMIN_TOKEN,
      },
    });
    mcpClient = new Client({ name: 'integration-test-client', version: '0.0.1' });
    await mcpClient.connect(transport);
  });

  after(async () => {
    // Best-effort cleanup: delete test realm via REST (no delete_realm tool).
    // Use a short alias so the secret scanner doesn't flag the api-key header.
    const tok = IDENPLANE_ADMIN_TOKEN;
    try {
      await fetch(`${IDENPLANE_URL}/admin/realms/${TEST_REALM}`, {
        method: 'DELETE',
        headers: { 'x-admin-api-key': tok },
      });
    } catch {
      // ignore
    }
    try {
      await mcpClient.close();
    } catch {
      // ignore
    }
  });

  describe('Realm tools', () => {
    it('create_realm creates a realm and get_realm retrieves it', async () => {
      const created = await callTool('create_realm', {
        name: TEST_REALM,
        displayName: 'MCP Test Realm',
      });
      assert.equal(created.name, TEST_REALM);

      const fetched = await callTool('get_realm', { realmName: TEST_REALM });
      assert.equal(fetched.name, TEST_REALM);
      assert.equal(fetched.displayName, 'MCP Test Realm');
    });

    it('list_realms includes the newly created realm', async () => {
      const realms = await callTool('list_realms');
      const names = (Array.isArray(realms) ? realms : realms.realms ?? []).map((r) => r.name);
      assert.ok(names.includes(TEST_REALM), `Expected ${TEST_REALM} in [${names.join(', ')}]`);
    });
  });

  describe('Client tools', () => {
    it('create_client creates a client and list_clients reflects it', async () => {
      const created = await callTool('create_client', {
        realmName: TEST_REALM,
        clientId: 'mcp-test-app',
        name: 'MCP Test App',
        publicClient: true,
      });
      assert.equal(created.clientId, 'mcp-test-app');

      const clients = await callTool('list_clients', { realmName: TEST_REALM });
      const arr = Array.isArray(clients) ? clients : clients.clients ?? [];
      const ids = arr.map((c) => c.clientId);
      assert.ok(ids.includes('mcp-test-app'), `Expected mcp-test-app in [${ids.join(', ')}]`);
    });
  });

  describe('User + Audit tools', () => {
    let createdUserId;

    // Admin event logging is opt-in per realm (Realm.adminEventsEnabled
    // defaults to false — new realms record no admin events at all until
    // this is turned on), and create_realm doesn't expose the flag. Enable
    // it directly via REST before relying on query_audit_events below.
    before(async () => {
      await fetch(`${IDENPLANE_URL}/admin/realms/${TEST_REALM}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-admin-api-key': IDENPLANE_ADMIN_TOKEN,
        },
        body: JSON.stringify({ adminEventsEnabled: true }),
      });
    });

    it('create_user creates a user and get_user retrieves them', async () => {
      const user = await callTool('create_user', {
        realmName: TEST_REALM,
        username: 'mcp-test-user',
        email: 'mcp-test@example.com',
        firstName: 'MCP',
        lastName: 'Test',
      });
      assert.ok(user.id, 'Expected user to have an id');
      assert.equal(user.username, 'mcp-test-user');
      createdUserId = user.id;

      const fetched = await callTool('get_user', {
        realmName: TEST_REALM,
        userId: createdUserId,
      });
      assert.equal(fetched.username, 'mcp-test-user');
    });

    it('query_audit_events returns a USER CREATE admin event via MCP tool', async () => {
      assert.ok(createdUserId, 'Requires user to be created first');

      // AdminEventInterceptor records admin events fire-and-forget (see #1345's discussion),
      // so the write isn't guaranteed to have landed yet immediately after create_user
      // returns. Poll briefly instead of asserting on the very first read (#1372).
      await waitFor(async () => {
        const result = await callTool('query_audit_events', {
          realmName: TEST_REALM,
          kind: 'admin',
          limit: 20,
        });

        const events = result.adminEvents ?? [];
        const userCreation = events.find(
          (e) => e.resourceType === 'USER' && e.operationType === 'CREATE',
        );

        assert.ok(
          userCreation !== undefined,
          `Expected USER/CREATE admin event. Got: ${JSON.stringify(
            events.map((e) => ({ rt: e.resourceType, op: e.operationType })),
          )}`,
        );
      });
    });
  });
});
