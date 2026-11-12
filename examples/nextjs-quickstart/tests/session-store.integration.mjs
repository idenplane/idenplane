import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import pg from 'pg';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const artifactDirectory =
  process.env.SESSION_TEST_ARTIFACTS ||
  join(tmpdir(), 'idenplane-session-evidence');
mkdirSync(artifactDirectory, { recursive: true });
import { SessionCipher, sessionHash } from '../lib/session/crypto.ts';
import { PostgresSessionStore } from '../lib/session/postgres-store.ts';

const name = 'bff-store-check-' + Date.now().toString(36),
  password = randomBytes(24).toString('hex'),
  key = randomBytes(32),
  checks = [];
let first,
  second,
  cleanup = false,
  success = false;
const docker = (args) => {
  const r = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
const record = (name) => checks.push({ name, passed: true });
try {
  docker([
    'run',
    '-d',
    '--name',
    name,
    '--label',
    'idenplane.validation=' + name,
    '-p',
    '127.0.0.1::5432',
    '-e',
    'POSTGRES_USER=bff',
    '-e',
    'POSTGRES_DB=bff',
    '-e',
    'POSTGRES_PASSWORD=' + password,
    'postgres:16-alpine',
  ]);
  const info = JSON.parse(docker(['inspect', name]))[0],
    port = info.NetworkSettings.Ports['5432/tcp'][0].HostPort;
  let ready = false;
  for (let n = 0; n < 60; n++) {
    const r = spawnSync(
      'docker',
      ['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'bff'],
      { encoding: 'utf8', windowsHide: true },
    );
    if (r.status === 0) {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(ready, 'PostgreSQL TCP readiness timed out');
  const config = {
    host: '127.0.0.1',
    port: Number(port),
    user: 'bff',
    database: 'bff',
    password,
    max: 4,
    connectionTimeoutMillis: 3000,
  };
  first = new pg.Pool(config);
  second = new pg.Pool(config);
  await first.query(
    readFileSync(new URL('../session-schema.sql', import.meta.url), 'utf8'),
  );
  const a = new PostgresSessionStore(first, new SessionCipher(key)),
    b = new PostgresSessionStore(second, new SessionCipher(key));
  const data = {
    accessToken: 'access-private',
    refreshToken: 'refresh-private',
    idToken: 'id-private',
    subject: 'alice',
    counter: 0,
  };
  const sid = await a.createSession(data);
  assert.equal(sid.length, 43);
  const raw = (
    await first.query('SELECT * FROM bff_sessions WHERE sid_hash=$1', [
      sessionHash(sid),
    ])
  ).rows[0];
  assert.equal(raw.sid_hash, sessionHash(sid));
  assert.ok(!JSON.stringify(raw).includes(sid));
  assert.ok(!JSON.stringify(raw).includes('access-private'));
  assert.ok(!JSON.stringify(raw).includes('refresh-private'));
  record('opaque_random_cookie_hashed_and_credentials_encrypted');
  assert.equal(
    await b.withSession(sid, async (value) => ({ value: value.subject })),
    'alice',
  );
  record('session_survives_second_process_store_instance');
  assert.equal(
    await b.withSession('x'.repeat(43), async () => {
      throw Error('must not run');
    }),
    null,
  );
  record('unknown_cookie_rejected');
  assert.equal(
    await b.withSession("'; DROP TABLE bff_sessions;--", async () => {
      throw Error('must not run');
    }),
    null,
  );
  record('malformed_cookie_rejected_before_database_work');
  let refreshCount = 0;
  const refresh = async (value) => {
    if (value.counter === 0) {
      refreshCount++;
      await new Promise((r) => setTimeout(r, 80));
      return { data: { ...value, counter: 1 }, value: 1 };
    }
    return { value: value.counter };
  };
  assert.deepEqual(
    await Promise.all([
      a.withSession(sid, refresh),
      b.withSession(sid, refresh),
    ]),
    [1, 1],
  );
  assert.equal(refreshCount, 1);
  record('concurrent_refresh_serialized_across_connections');
  await assert.rejects(
    a.withSession(sid, async () => {
      throw Error('provider unavailable');
    }),
  );
  assert.equal(
    await b.withSession(sid, async (value) => ({ value: value.counter })),
    1,
  );
  record('failed_refresh_rolls_back_without_losing_session');
  const login = await a.createLogin(
    { verifier: 'private-verifier', nonce: 'private-nonce' },
    'correct-state',
  );
  assert.equal(await b.consumeLogin(login, 'wrong-state'), null);
  const winners = await Promise.all([
    a.consumeLogin(login, 'correct-state'),
    b.consumeLogin(login, 'correct-state'),
  ]);
  assert.equal(winners.filter(Boolean).length, 1);
  record('login_transaction_state_bound_and_consumed_exactly_once');
  const revoked = await a.revokeSession(sid);
  assert.equal(revoked.subject, 'alice');
  assert.equal(
    await b.withSession(sid, async () => {
      throw Error('must not run');
    }),
    null,
  );
  assert.equal(await b.revokeSession(sid), null);
  record('revocation_immediate_across_connections_and_idempotent');
  const race = await a.createSession(data);
  let entered, continueWork;
  const started = new Promise((r) => {
      entered = r;
    }),
    gate = new Promise((r) => {
      continueWork = r;
    });
  const reader = a.withSession(race, async (value) => {
    entered();
    await gate;
    return { data: { ...value, counter: 9 }, value: 9 };
  });
  await started;
  const deletion = b.revokeSession(race);
  continueWork();
  assert.equal(await reader, 9);
  assert.ok(await deletion);
  assert.equal(
    await a.withSession(race, async () => {
      throw Error('must not run');
    }),
    null,
  );
  record('logout_waits_for_inflight_refresh_then_prevents_resurrection');
  const expired = await a.createSession(data);
  await first.query(
    "UPDATE bff_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE sid_hash=$1",
    [sessionHash(expired)],
  );
  assert.equal(
    await b.withSession(expired, async () => {
      throw Error('must not run');
    }),
    null,
  );
  record('absolute_expiry_enforced_by_database_clock');
  const idle = await a.createSession(data);
  await first.query(
    "UPDATE bff_sessions SET last_seen_at=clock_timestamp()-interval '1 hour' WHERE sid_hash=$1",
    [sessionHash(idle)],
  );
  assert.equal(
    await b.withSession(idle, async () => {
      throw Error('must not run');
    }),
    null,
  );
  record('idle_expiry_enforced');
  const tampered = await a.createSession(data),
    different = await a.createSession(data);
  await first.query(
    'UPDATE bff_sessions SET payload=(SELECT payload FROM bff_sessions WHERE sid_hash=$1) WHERE sid_hash=$2',
    [sessionHash(tampered), sessionHash(different)],
  );
  await assert.rejects(
    b.withSession(different, async () => {
      throw Error('must not run');
    }),
  );
  record('ciphertext_cannot_be_moved_between_sessions');
  const wrongKey = new PostgresSessionStore(
    second,
    new SessionCipher(randomBytes(32)),
  );
  await assert.rejects(
    wrongKey.withSession(tampered, async () => {
      throw Error('must not run');
    }),
  );
  record('wrong_encryption_key_fails_closed');
  await a.deleteExpired();
  assert.equal(
    (
      await first.query(
        'SELECT count(*)::int AS count FROM bff_sessions WHERE sid_hash=ANY($1::text[])',
        [[sessionHash(expired), sessionHash(idle)]],
      )
    ).rows[0].count,
    0,
  );
  record('expired_records_cleaned');
  success = true;
} finally {
  await first?.end();
  await second?.end();
  const inspected = spawnSync('docker', ['inspect', name], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (inspected.status === 0) {
    assert.equal(
      JSON.parse(inspected.stdout)[0].Config.Labels['idenplane.validation'],
      name,
    );
    docker(['rm', '-f', '-v', name]);
  }
  cleanup = true;
  writeFileSync(
    join(artifactDirectory, 'store-results.json'),
    JSON.stringify(
      {
        success,
        checks,
        cleanup,
        completedAt: new Date().toISOString(),
        scope: 'real PostgreSQL session storage',
        driver:
          'pg ' +
          JSON.parse(
            readFileSync(
              new URL('../node_modules/pg/package.json', import.meta.url),
              'utf8',
            ),
          ).version,
      },
      null,
      2,
    ),
  );
}
console.log(JSON.stringify({ passed: checks.length, cleanup }));
