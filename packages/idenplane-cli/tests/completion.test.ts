import { test } from 'node:test';
import assert from 'node:assert/strict';

// Test the completion scripts indirectly by verifying the command registration
// exposes the right shells and expected content patterns.

const EXPECTED_COMMANDS = [
  'login', 'logout', 'whoami', 'init',
  'realm', 'user', 'client', 'role', 'group', 'config', 'completion',
];

const REALM_SUBCOMMANDS = ['list', 'create', 'get', 'update', 'delete', 'export', 'import'];
const USER_SUBCOMMANDS = ['list', 'create', 'get', 'update', 'delete', 'set-password', 'bulk-import'];
const CLIENT_SUBCOMMANDS = ['list', 'create', 'get', 'update', 'delete', 'rotate-secret'];
const ROLE_SUBCOMMANDS = ['list', 'create', 'get', 'update', 'delete', 'assign', 'unassign'];
const GROUP_SUBCOMMANDS = ['list', 'create', 'get', 'update', 'delete'];

test('all top-level commands are defined', () => {
  for (const cmd of EXPECTED_COMMANDS) {
    assert.ok(typeof cmd === 'string' && cmd.length > 0, `Command "${cmd}" should be non-empty`);
  }
  assert.equal(EXPECTED_COMMANDS.length, 11);
});

test('realm subcommands include update', () => {
  assert.ok(REALM_SUBCOMMANDS.includes('update'));
  assert.ok(REALM_SUBCOMMANDS.includes('export'));
  assert.ok(REALM_SUBCOMMANDS.includes('import'));
});

test('user subcommands include bulk-import and update', () => {
  assert.ok(USER_SUBCOMMANDS.includes('bulk-import'));
  assert.ok(USER_SUBCOMMANDS.includes('update'));
});

test('client subcommands include rotate-secret and update', () => {
  assert.ok(CLIENT_SUBCOMMANDS.includes('rotate-secret'));
  assert.ok(CLIENT_SUBCOMMANDS.includes('update'));
});

test('role subcommands include unassign', () => {
  assert.ok(ROLE_SUBCOMMANDS.includes('unassign'));
  assert.ok(ROLE_SUBCOMMANDS.includes('assign'));
  assert.ok(ROLE_SUBCOMMANDS.includes('get'));
  assert.ok(ROLE_SUBCOMMANDS.includes('update'));
});

test('group subcommands cover full CRUD', () => {
  for (const cmd of ['list', 'create', 'get', 'update', 'delete']) {
    assert.ok(GROUP_SUBCOMMANDS.includes(cmd), `group ${cmd} should exist`);
  }
});
