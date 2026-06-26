/**
 * Integration tests for @idenplane/mcp
 *
 * Prerequisites:
 *   docker compose up db -d && npm run start:dev   (from repo root)
 *
 * Environment variables:
 *   IDENPLANE_URL          (default: http://localhost:3000)
 *   IDENPLANE_ADMIN_TOKEN  (default: dev-admin-key)
 *
 * Run: node --test tests/integration.mjs
 */

import assert from 'node:assert/strict';
import { describe, it, after } from 'node:test';

const BASE_URL = (process.env['IDENPLANE_URL'] ?? 'http://localhost:3000').replace(/\/$/, '');
const ADMIN_TOKEN = process.env['IDENPLANE_ADMIN_TOKEN'] ?? 'dev-admin-key';

const HEADERS = {
  'Content-Type': 'application/json',
  'x-admin-api-key': ADMIN_TOKEN,
};

async function apiGet(path, query) {
  const url = new URL(`${BASE_URL}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), { headers: HEADERS });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`HTTP ${res.status}: ${body.message ?? body.error ?? res.statusText}`);
  }
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(`HTTP ${res.status}: ${b.message ?? b.error ?? res.statusText}`);
  }
  return res.json();
}

async function apiDelete(path) {
  const res = await fetch(`${BASE_URL}${path}`, { method: 'DELETE', headers: HEADERS });
  if (!res.ok && res.status !== 204) {
    const b = await res.json().catch(() => ({}));
    throw new Error(`HTTP ${res.status}: ${b.message ?? b.error ?? res.statusText}`);
  }
}

const TEST_REALM = `mcp-test-${Date.now()}`;

after(async () => {
  try {
    await apiDelete(`/admin/realms/${TEST_REALM}`);
  } catch {
    // best-effort cleanup
  }
});

describe('Idenplane MCP integration', () => {
  describe('Realm tools', () => {
    it('create_realm creates a realm and get_realm retrieves it', async () => {
      const created = await apiPost('/admin/realms', {
        name: TEST_REALM,
        displayName: 'MCP Test Realm',
      });

      assert.equal(created.name, TEST_REALM);

      const fetched = await apiGet(`/admin/realms/${TEST_REALM}`);
      assert.equal(fetched.name, TEST_REALM);
      assert.equal(fetched.displayName, 'MCP Test Realm');
    });

    it('list_realms includes the newly created realm', async () => {
      const realms = await apiGet('/admin/realms');
      const names = realms.map((r) => r.name);
      assert.ok(names.includes(TEST_REALM), `Expected ${TEST_REALM} in [${names.join(', ')}]`);
    });
  });

  describe('Client tools', () => {
    it('create_client creates a client and list_clients reflects it', async () => {
      const created = await apiPost(`/admin/realms/${TEST_REALM}/clients`, {
        clientId: 'mcp-test-app',
        name: 'MCP Test App',
        publicClient: true,
      });

      assert.equal(created.clientId, 'mcp-test-app');

      const clients = await apiGet(`/admin/realms/${TEST_REALM}/clients`);
      const ids = clients.map((c) => c.clientId);
      assert.ok(ids.includes('mcp-test-app'), `Expected mcp-test-app in [${ids.join(', ')}]`);
    });
  });

  describe('User + Audit tools', () => {
    let createdUserId;

    it('create_user creates a user and get_user retrieves them', async () => {
      const user = await apiPost(`/admin/realms/${TEST_REALM}/users`, {
        username: 'mcp-test-user',
        email: 'mcp-test@example.com',
        firstName: 'MCP',
        lastName: 'Test',
      });

      assert.ok(user.id, 'Expected user to have an id');
      assert.equal(user.username, 'mcp-test-user');
      createdUserId = user.id;

      const fetched = await apiGet(`/admin/realms/${TEST_REALM}/users/${createdUserId}`);
      assert.equal(fetched.username, 'mcp-test-user');
    });

    it('query_audit_events returns admin events after user creation', async () => {
      assert.ok(createdUserId, 'Requires user to be created first');

      const events = await apiGet(`/admin/realms/${TEST_REALM}/admin-events`, { max: '20' });

      const userCreation = events.find(
        (e) => e.resourceType === 'USER' && e.operationType === 'CREATE',
      );

      assert.ok(
        userCreation !== undefined,
        `Expected a USER CREATE admin event. Got: ${JSON.stringify(
          events.map((e) => ({ resourceType: e.resourceType, operationType: e.operationType })),
        )}`,
      );
    });
  });
});
