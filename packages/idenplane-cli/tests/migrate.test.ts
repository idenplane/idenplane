import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Command } from 'commander';
import { registerMigrateCommand, type MigrateDeps } from '../src/commands/migrate.js';
import type { CliConfig, MigrationReport } from '../src/types.js';

const CONFIG: CliConfig = { serverUrl: 'http://idenplane.test', apiKey: 'example-admin-key' } as CliConfig;

const REPORT: MigrationReport = {
  source: 'authentik',
  dryRun: true,
  startedAt: '2026-11-17T10:00:00.000Z',
  completedAt: '2026-11-17T10:00:01.000Z',
  summary: { users: { created: 2, skipped: 1, failed: 0 } },
  errors: [],
  warnings: [{ entity: 'user', message: "User 'ak-outpost-x' was not imported" }],
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'idenplane-cli-migrate-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function run(args: string[]) {
  const calls: { config: CliConfig; path: string; body: any }[] = [];
  const deps: MigrateDeps = {
    loadConfig: () => CONFIG,
    post: async (config, path, body) => {
      calls.push({ config, path, body });
      return REPORT;
    },
  };
  const program = new Command();
  program.exitOverride();
  registerMigrateCommand(program, deps);

  const out: string[] = [];
  const originalLog = console.log;
  console.log = (...parts: unknown[]) => {
    out.push(parts.join(' '));
  };
  try {
    await program.parseAsync(['node', 'idenplane', ...args]);
  } finally {
    console.log = originalLog;
  }
  return { calls, out: out.join('\n') };
}

test('migrate authentik posts the file to /admin/migration/authentik', async () => {
  const file = join(dir, 'authentik-export.json');
  const data = {
    users: { pagination: { next: 0 }, results: [{ pk: 1, username: 'alice' }] },
    groups: [{ pk: 'g', name: 'staff' }],
  };
  writeFileSync(file, JSON.stringify(data));

  const { calls, out } = await run(['migrate', 'authentik', '--file', file, '--realm', 'my-realm', '--dry-run']);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/admin/migration/authentik');
  assert.equal(calls[0].config, CONFIG);
  assert.deepEqual(calls[0].body, { data, dryRun: true, targetRealm: 'my-realm', addMembershipsToExistingUsers: false });
  assert.match(out, /Importing Authentik data into realm 'my-realm' \(dry run\)/);
  assert.match(out, /Migration Report \(authentik\)/);
  assert.match(out, /ak-outpost-x/);
});

test('migrate authentik --add-memberships-to-existing-users opts in', async () => {
  const file = join(dir, 'authentik-export.json');
  writeFileSync(file, '{}');
  const { calls } = await run(['migrate', 'authentik', '--file', file, '--realm', 'r', '--add-memberships-to-existing-users']);
  assert.equal(calls[0].body.addMembershipsToExistingUsers, true);
});

test('migrate authentik --json prints the report as JSON', async () => {
  const file = join(dir, 'authentik-export.json');
  writeFileSync(file, '{}');
  const { calls, out } = await run(['migrate', 'authentik', '--file', file, '--realm', 'r', '--json']);
  assert.equal(calls[0].body.dryRun, false);
  assert.deepEqual(JSON.parse(out.slice(out.indexOf('{'))), REPORT);
});

test('migrate authentik requires --realm', async () => {
  const file = join(dir, 'authentik-export.json');
  writeFileSync(file, '{}');
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (() => true) as typeof process.stderr.write;
  try {
    await assert.rejects(run(['migrate', 'authentik', '--file', file]), /--realm/);
  } finally {
    process.stderr.write = originalWrite;
  }
});

test('the other importers still post to their own endpoints', async () => {
  const file = join(dir, 'export.json');
  writeFileSync(file, JSON.stringify({ realm: 'kc' }));
  for (const source of ['keycloak', 'auth0', 'zitadel']) {
    const { calls } = await run(['migrate', source, '--file', file, '--realm', 'r']);
    assert.equal(calls[0].path, `/admin/migration/${source}`);
    assert.deepEqual(calls[0].body, { data: { realm: 'kc' }, dryRun: false, targetRealm: 'r' });
  }
});
