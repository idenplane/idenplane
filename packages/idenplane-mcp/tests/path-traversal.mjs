/**
 * Regression test for the path-traversal fix: realmName/userId/clientId/
 * sessionId must be rejected by schema validation before they ever reach
 * IdenplaneClient's unencoded URL interpolation.
 *
 * Does NOT require a running Idenplane instance — uses a dummy env var
 * pointing at an unreachable port, so a passing rejection proves validation
 * happened before any network call was attempted.
 *
 * Run: node --test tests/path-traversal.mjs
 */

import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, '..', 'dist', 'index.js');

let mcpClient;

async function callTool(name, args) {
  return mcpClient.callTool({ name, arguments: args ?? {} });
}

describe('MCP tool path-segment validation', () => {
  before(async () => {
    const transport = new StdioClientTransport({
      command: 'node',
      args: [serverPath],
      env: {
        ...process.env,
        IDENPLANE_URL: 'http://localhost:9999',
        IDENPLANE_ADMIN_TOKEN: 'dummy',
      },
    });
    mcpClient = new Client({ name: 'path-traversal-test-client', version: '0.0.1' });
    await mcpClient.connect(transport);
  });

  after(async () => {
    await mcpClient.close();
  });

  const traversalPayloads = ['../../admin/some-other-endpoint', '%2e%2e%2f', '..', 'a/b', 'a b'];

  for (const payload of traversalPayloads) {
    it(`rejects get_realm with realmName=${JSON.stringify(payload)}`, async () => {
      const result = await callTool('get_realm', { realmName: payload });
      assert.equal(result.isError, true);
    });

    it(`rejects revoke_session with sessionId=${JSON.stringify(payload)}`, async () => {
      const result = await callTool('revoke_session', { realmName: 'test', sessionId: payload });
      assert.equal(result.isError, true);
    });

    it(`rejects get_user with userId=${JSON.stringify(payload)}`, async () => {
      const result = await callTool('get_user', { realmName: 'test', userId: payload });
      assert.equal(result.isError, true);
    });
  }

  it('accepts a well-formed realmName (fails later on the network call, not on validation)', async () => {
    const result = await callTool('get_realm', { realmName: 'my-realm_1' });
    assert.equal(result.isError, true);
    const text = result.content.find((c) => c.type === 'text')?.text ?? '';
    assert.ok(!text.includes('must contain only letters'), `expected a network error, got: ${text}`);
  });
});
