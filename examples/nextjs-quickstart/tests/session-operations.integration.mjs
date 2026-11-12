import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import cp from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import pg from 'pg';
import { SessionCipher } from '../lib/session/crypto.ts';
import { PostgresSessionStore } from '../lib/session/postgres-store.ts';
import { openBackup } from '../scripts/session-maintenance.mjs';

const example = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const artifacts = path.resolve(
  process.env.SESSION_TEST_ARTIFACTS ||
    path.join(os.tmpdir(), 'idenplane-session-evidence'),
);
fs.mkdirSync(artifacts, { recursive: true });
const fixture = fs.mkdtempSync(
  path.join(os.tmpdir(), 'idenplane-session-ops-test-'),
);
const tag = 'session-ops-' + Date.now().toString(36),
  db = tag + '-db',
  loop = tag + '-loop',
  image =
    process.env.SESSION_OPS_TEST_IMAGE || 'idenplane-session-ops:validation';
const checks = [],
  pools = [];
let cleanup = false,
  success = false;
const run = (args) =>
  cp.spawnSync('docker', args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 180000,
    maxBuffer: 4 * 1024 * 1024,
  });
const docker = (args) => {
  const result = run(args);
  assert.equal(
    result.status,
    0,
    'Docker operation failed: ' + (result.stderr || '').slice(-800),
  );
  return result.stdout.trim();
};
const record = (name) => checks.push({ name, passed: true });
const password = randomBytes(24).toString('hex'),
  payloadKey = randomBytes(32),
  backupKey = randomBytes(32);
const privateEnv = {
  SESSION_ENCRYPTION_KEY: payloadKey.toString('hex'),
  SESSION_BACKUP_KEY: backupKey.toString('hex'),
};
const owner = process.getuid
  ? String(process.getuid()) + ':' + process.getgid()
  : '1000:1000';
function environment(database, overrides = {}) {
  const filename = path.join(fixture, '.env-' + randomBytes(5).toString('hex'));
  fs.writeFileSync(
    filename,
    Object.entries({
      PGHOST: db,
      PGPORT: '5432',
      PGUSER: 'bff',
      PGDATABASE: database,
      PGSSLMODE: 'disable',
      SESSION_OPS_ALLOW_INSECURE: 'true',
      SESSION_POSTGRES_PASSWORD: password,
      ...privateEnv,
      ...overrides,
    })
      .map(([key, value]) => key + '=' + value)
      .join('\n') + '\n',
    { mode: 0o600 },
  );
  return filename;
}
function opsArgs(database, args, overrides = {}, daemon = false) {
  return [
    'run',
    ...(daemon ? ['-d', '--name', loop] : ['--rm']),
    '--label',
    'idenplane.validation=' + tag,
    '--network',
    tag,
    '--user',
    owner,
    '--read-only',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=128m',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--env-file',
    environment(database, overrides),
    '--mount',
    `type=bind,source=${fixture},target=/fixture`,
    image,
    ...args,
  ];
}
function ops(database, args, overrides) {
  return run(opsArgs(database, args, overrides));
}
function ok(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}
function rejected(result) {
  assert.notEqual(result.status, 0);
  const text = result.stdout + result.stderr;
  for (const secret of [
    password,
    payloadKey.toString('hex'),
    backupKey.toString('hex'),
  ])
    assert.ok(!text.includes(secret));
}
async function eventually(work, message) {
  for (let n = 0; n < 50; n++) {
    if (await work()) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw Error(message);
}
function ownPool(port, database) {
  const pool = new pg.Pool({
    host: '127.0.0.1',
    port,
    database,
    user: 'bff',
    password,
    max: 4,
    connectionTimeoutMillis: 2000,
  });
  pool.on('error', () => {});
  pools.push(pool);
  return pool;
}
try {
  const build = run([
    'build',
    '-f',
    'Dockerfile.session-ops',
    '-t',
    image,
    example,
  ]);
  fs.writeFileSync(
    path.join(artifacts, 'operations-build.log'),
    build.stdout + build.stderr,
  );
  assert.equal(build.status, 0, 'Maintenance image build failed');
  record(
    'non_root_dependency_free_operations_image_builds_with_postgresql16_clients',
  );
  docker(['network', 'create', '--label', 'idenplane.validation=' + tag, tag]);
  docker([
    'run',
    '-d',
    '--name',
    db,
    '--label',
    'idenplane.validation=' + tag,
    '--network',
    tag,
    '-p',
    '127.0.0.1::5432',
    '-e',
    'POSTGRES_USER=bff',
    '-e',
    'POSTGRES_DB=source',
    '-e',
    'POSTGRES_PASSWORD=' + password,
    'postgres:16-alpine',
  ]);
  await eventually(
    () =>
      run([
        'exec',
        db,
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        'bff',
        '-d',
        'source',
      ]).status === 0,
    'Database readiness timed out',
  );
  const port = Number(
    JSON.parse(docker(['inspect', db]))[0].NetworkSettings.Ports['5432/tcp'][0]
      .HostPort,
  );
  const source = ownPool(port, 'source');
  for (const name of ['quarantine', 'recovered', 'failed_restore'])
    await source.query('CREATE DATABASE ' + name);
  const quarantine = ownPool(port, 'quarantine'),
    recovered = ownPool(port, 'recovered'),
    failed = ownPool(port, 'failed_restore');
  await source.query(
    fs.readFileSync(path.join(example, 'session-schema.sql'), 'utf8'),
  );
  const store = new PostgresSessionStore(source, new SessionCipher(payloadKey));
  const data = {
    subject: 'fixture-user',
    accessToken: 'dummy-access-private',
    refreshToken: 'dummy-refresh-private',
    idToken: 'fixture-id-private',
  };
  const sid = await store.createSession(data),
    login = await store.createLogin(
      { verifier: 'fixture-private-verifier' },
      'fixture-state',
    );
  const backup = '/fixture/good';
  assert.equal(
    ok(ops('source', ['backup', '--output', backup])).backupCreated,
    true,
  );
  record('consistent_encrypted_backup_created_without_exporting_secrets');
  const archive = path.join(fixture, 'good/archive.enc');
  for (const secret of [
    sid,
    login,
    data.accessToken,
    data.refreshToken,
    payloadKey.toString('hex'),
  ])
    assert.ok(!fs.readFileSync(archive).includes(Buffer.from(secret)));
  record('archive_does_not_contain_raw_cookie_tokens_or_encryption_key');
  rejected(ops('source', ['backup', '--output', backup]));
  record('backup_refuses_to_overwrite_existing_snapshot');
  rejected(
    ops('source', ['backup', '--output', '/fixture/shared-key'], {
      SESSION_BACKUP_KEY: payloadKey.toString('hex'),
    }),
  );
  record('payload_and_backup_keys_must_be_independent');
  rejected(
    ops('source', ['backup', '--output', '/fixture/wrong-payload-key'], {
      SESSION_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    }),
  );
  record('backup_checks_that_session_key_decrypts_sampled_source_rows');

  const opened = await openBackup(path.join(fixture, 'good'), privateEnv);
  try {
    docker(['cp', opened.archive, db + ':/tmp/quarantine.dump']);
    docker([
      'exec',
      db,
      'pg_restore',
      '-U',
      'bff',
      '-d',
      'quarantine',
      '--no-owner',
      '--no-acl',
      '/tmp/quarantine.dump',
    ]);
    docker(['exec', db, 'rm', '/tmp/quarantine.dump']);
  } finally {
    opened.close();
  }
  const restored = new PostgresSessionStore(
    quarantine,
    new SessionCipher(payloadKey),
  );
  assert.equal(
    await restored.withSession(sid, async (value) => ({
      value: value.subject,
    })),
    'fixture-user',
  );
  record(
    'quarantined_pg_dump_restore_preserves_decryptable_session_data_with_original_key',
  );
  await assert.rejects(
    new PostgresSessionStore(
      quarantine,
      new SessionCipher(randomBytes(32)),
    ).withSession(sid, async () => ({ value: true })),
  );
  record('restored_ciphertext_rejects_wrong_session_key');
  await store.revokeSession(sid);
  assert.equal(
    await store.withSession(sid, async () => ({ value: true })),
    null,
  );
  assert.equal(
    await restored.withSession(sid, async (value) => ({
      value: value.subject,
    })),
    'fixture-user',
  );
  record(
    'quarantine_demonstrates_old_snapshots_can_resurrect_later_revoked_sessions',
  );

  rejected(
    ops('recovered', ['restore', '--input', backup], {
      SESSION_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    }),
  );
  record('restore_rejects_wrong_payload_key_before_database_changes');
  rejected(
    ops('recovered', ['restore', '--input', backup], {
      SESSION_BACKUP_KEY: randomBytes(32).toString('hex'),
    }),
  );
  record('restore_rejects_wrong_archive_key_before_database_changes');
  fs.mkdirSync(path.join(fixture, 'corrupt'));
  fs.copyFileSync(archive, path.join(fixture, 'corrupt/archive.enc'));
  const manifest = JSON.parse(
    fs.readFileSync(path.join(fixture, 'good/manifest.json'), 'utf8'),
  );
  const damaged = fs.readFileSync(path.join(fixture, 'corrupt/archive.enc'));
  damaged[50] ^= 1;
  fs.writeFileSync(path.join(fixture, 'corrupt/archive.enc'), damaged);
  fs.writeFileSync(
    path.join(fixture, 'corrupt/manifest.json'),
    JSON.stringify(manifest),
  );
  rejected(ops('recovered', ['restore', '--input', '/fixture/corrupt']));
  record('restore_rejects_changed_archive_checksum');
  manifest.sha256 = createHash('sha256').update(damaged).digest('hex');
  fs.writeFileSync(
    path.join(fixture, 'corrupt/manifest.json'),
    JSON.stringify(manifest),
  );
  rejected(ops('recovered', ['restore', '--input', '/fixture/corrupt']));
  record(
    'gcm_authentication_rejects_tampering_even_when_checksum_is_recomputed',
  );
  fs.writeFileSync(
    path.join(fixture, 'corrupt/manifest.json'),
    '{"private":"' + password + '" invalid-json}',
  );
  rejected(ops('recovered', ['restore', '--input', '/fixture/corrupt']));
  record('malformed_backup_metadata_is_rejected_without_echoing_its_contents');
  assert.equal(
    (
      await recovered.query(
        "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'",
      )
    ).rows[0].n,
    0,
  );
  const result = ok(ops('recovered', ['restore', '--input', backup]));
  assert.equal(result.activeSessionsRestored, 0);
  assert.equal(result.requiresSignIn, true);
  const safe = new PostgresSessionStore(
    recovered,
    new SessionCipher(payloadKey),
  );
  assert.equal(
    await safe.withSession(sid, async () => ({ value: true })),
    null,
  );
  assert.equal(await safe.consumeLogin(login, 'fixture-state'), null);
  record(
    'normal_restore_atomically_invalidates_all_backed_up_sessions_and_login_transactions',
  );
  const fresh = await safe.createSession(data);
  assert.equal(
    await safe.withSession(fresh, async (value) => ({ value: value.subject })),
    'fixture-user',
  );
  record('restored_schema_supports_new_sessions');
  rejected(ops('recovered', ['restore', '--input', backup]));
  assert.equal(
    await safe.withSession(fresh, async (value) => ({ value: value.subject })),
    'fixture-user',
  );
  record('restore_refuses_populated_target_and_preserves_existing_sessions');
  await source.query('CREATE TABLE unrelated (id int)');
  rejected(ops('source', ['cleanup']));
  await source.query('DROP TABLE unrelated');
  record('maintenance_refuses_shared_application_database');
  await source.query(
    "CREATE ROLE bff_cleaner LOGIN PASSWORD '" + password + "'",
  );
  await source.query('GRANT CONNECT ON DATABASE source TO bff_cleaner');
  await source.query('GRANT USAGE ON SCHEMA public TO bff_cleaner');
  await source.query(
    'GRANT SELECT, DELETE ON public.bff_sessions TO bff_cleaner',
  );
  await source.query(
    'GRANT UPDATE (sid_hash) ON public.bff_sessions TO bff_cleaner',
  );
  assert.equal(
    ok(ops('source', ['cleanup'], { PGUSER: 'bff_cleaner' })).deleted,
    0,
  );
  const cleaner = new pg.Pool({
    host: '127.0.0.1',
    port,
    database: 'source',
    user: 'bff_cleaner',
    password,
  });
  cleaner.on('error', () => {});
  pools.push(cleaner);
  await assert.rejects(
    cleaner.query('UPDATE public.bff_sessions SET payload=payload'),
    { code: '42501' },
  );
  await assert.rejects(
    cleaner.query(
      'INSERT INTO public.bff_sessions SELECT * FROM public.bff_sessions LIMIT 1',
    ),
    { code: '42501' },
  );
  record(
    'limited_cleanup_role_can_clean_but_cannot_insert_sessions_or_change_encrypted_payloads',
  );

  const active = await store.createSession(data),
    idle = await store.createSession(data),
    expired = [];
  for (let n = 0; n < 6; n++) expired.push(await store.createSession(data));
  await source.query(
    "UPDATE bff_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE sid_hash=ANY($1)",
    [expired.map((id) => createHash('sha256').update(id).digest('hex'))],
  );
  await source.query(
    "UPDATE bff_sessions SET last_seen_at=clock_timestamp()-interval '1 hour' WHERE sid_hash=$1",
    [createHash('sha256').update(idle).digest('hex')],
  );
  const first = ok(
    ops('source', ['cleanup', '--batch-size', '2', '--max-batches', '1']),
  );
  assert.equal(first.deleted, 2);
  assert.equal(first.batches, 1);
  record('cleanup_respects_batch_and_work_budget');
  const locked = await source.connect();
  await locked.query('BEGIN');
  await locked.query(
    'SELECT * FROM bff_sessions WHERE expires_at < clock_timestamp() LIMIT 1 FOR UPDATE',
  );
  try {
    const pass = ok(
      ops('source', ['cleanup', '--batch-size', '20', '--max-batches', '1']),
    );
    assert.equal(pass.deleted, 4);
  } finally {
    await locked.query('ROLLBACK');
    locked.release();
  }
  assert.equal(ok(ops('source', ['cleanup'])).deleted, 1);
  assert.equal(
    await store.withSession(active, async (value) => ({
      value: value.subject,
    })),
    'fixture-user',
  );
  assert.equal(
    (
      await source.query(
        "SELECT count(*)::int AS n FROM bff_sessions WHERE expires_at<=clock_timestamp() OR last_seen_at+idle_seconds*interval '1 second'<=clock_timestamp()",
      )
    ).rows[0].n,
    0,
  );
  record(
    'cleanup_skips_locked_rows_then_removes_expired_and_idle_rows_without_deleting_active_sessions',
  );
  assert.equal(
    (await store.consumeLogin(login, 'fixture-state')) !== null,
    true,
  );
  record('cleanup_preserves_unexpired_login_transactions');

  await source.query(
    'CREATE FUNCTION public.ops_restore_fixture() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$',
  );
  await source.query(
    'ALTER TABLE bff_sessions ADD COLUMN dependency_probe int DEFAULT public.ops_restore_fixture()',
  );
  ok(ops('source', ['backup', '--output', '/fixture/dependency-failure']));
  rejected(
    ops('failed_restore', [
      'restore',
      '--input',
      '/fixture/dependency-failure',
    ]),
  );
  assert.equal(
    (
      await failed.query(
        "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'",
      )
    ).rows[0].n,
    0,
  );
  record(
    'restore_sql_failure_rolls_back_without_committing_schema_or_sessions',
  );
  await source.query('ALTER TABLE bff_sessions DROP COLUMN dependency_probe');
  await source.query('DROP FUNCTION public.ops_restore_fixture()');

  docker(
    opsArgs(
      'source',
      ['cleanup-loop', '--interval-seconds', '1'],
      { PGUSER: 'bff_cleaner' },
      true,
    ),
  );
  const scheduled = await store.createSession(data);
  await source.query(
    "UPDATE bff_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE sid_hash=$1",
    [createHash('sha256').update(scheduled).digest('hex')],
  );
  await eventually(
    async () =>
      (
        await source.query(
          'SELECT count(*)::int AS n FROM bff_sessions WHERE sid_hash=$1',
          [createHash('sha256').update(scheduled).digest('hex')],
        )
      ).rows[0].n === 0,
    'Automatic cleanup did not run',
  );
  await eventually(
    () =>
      run([
        'exec',
        loop,
        'node',
        '/ops/scripts/session-maintenance.mjs',
        'health',
        '--interval-seconds',
        '1',
      ]).status === 0,
    'Cleaner health did not become healthy',
  );
  record('scheduled_cleaner_runs_automatically_and_exposes_success_health');
  await source.query('CREATE TABLE unrelated (id int)');
  await eventually(
    () =>
      run([
        'exec',
        loop,
        'node',
        '/ops/scripts/session-maintenance.mjs',
        'health',
        '--interval-seconds',
        '1',
      ]).status !== 0,
    'Cleaner did not report database contract failure',
  );
  await source.query('DROP TABLE unrelated');
  await eventually(
    () =>
      run([
        'exec',
        loop,
        'node',
        '/ops/scripts/session-maintenance.mjs',
        'health',
        '--interval-seconds',
        '1',
      ]).status === 0,
    'Cleaner did not recover',
  );
  record('cleaner_health_turns_unhealthy_on_failure_and_recovers_after_repair');
  docker(['stop', db]);
  await eventually(
    () =>
      run([
        'exec',
        loop,
        'node',
        '/ops/scripts/session-maintenance.mjs',
        'health',
        '--interval-seconds',
        '1',
      ]).status !== 0,
    'Database outage was not reported',
  );
  const logResult = run(['logs', loop]);
  assert.equal(logResult.status, 0);
  const logs = logResult.stdout + logResult.stderr;
  for (const secret of [password, ...Object.values(privateEnv)])
    assert.ok(!logs.includes(secret));
  record('database_outage_is_reported_without_logging_credentials');
  docker(['stop', '--time', '15', loop]);
  assert.equal(JSON.parse(docker(['inspect', loop]))[0].State.ExitCode, 0);
  record('scheduled_cleaner_stops_gracefully');
  success = true;
} finally {
  for (const pool of pools) await pool.end();
  for (const name of [loop, db]) {
    const inspected = run(['inspect', name]);
    if (inspected.status === 0) {
      assert.equal(
        JSON.parse(inspected.stdout)[0].Config.Labels['idenplane.validation'],
        tag,
      );
      docker(['rm', '-f', '-v', name]);
    }
  }
  for (const id of docker([
    'ps',
    '-aq',
    '--filter',
    'label=idenplane.validation=' + tag,
  ])
    .split(/\s+/)
    .filter(Boolean)) {
    assert.equal(
      JSON.parse(docker(['inspect', id]))[0].Config.Labels[
        'idenplane.validation'
      ],
      tag,
    );
    docker(['rm', '-f', '-v', id]);
  }
  const network = run(['network', 'inspect', tag]);
  if (network.status === 0) {
    assert.equal(
      JSON.parse(network.stdout)[0].Labels['idenplane.validation'],
      tag,
    );
    docker(['network', 'rm', tag]);
  }
  const actual = fs.realpathSync(fixture);
  assert.equal(
    path.dirname(actual).toLowerCase(),
    fs.realpathSync(os.tmpdir()).toLowerCase(),
  );
  assert.ok(path.basename(actual).startsWith('idenplane-session-ops-test-'));
  fs.rmSync(actual, { recursive: true });
  cleanup = true;
  fs.writeFileSync(
    path.join(artifacts, 'operations-results.json'),
    JSON.stringify(
      {
        success,
        checks,
        cleanup,
        completedAt: new Date().toISOString(),
        scope:
          'disposable PostgreSQL16 databases; synthetic encrypted sessions; no production or user database accessed',
      },
      null,
      2,
    ),
  );
}
console.log(JSON.stringify({ success, checks: checks.length, cleanup }));
