import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import {
  databaseContext,
  main,
  restoreTransaction,
} from '../scripts/session-maintenance.mjs';

const configuration = {
  PGHOST: 'db.test',
  PGUSER: 'bff',
  PGDATABASE: 'bff',
  SESSION_POSTGRES_PASSWORD: 'p:a\\ss',
  SESSION_ENCRYPTION_KEY: 'a'.repeat(64),
  SESSION_BACKUP_KEY: 'b'.repeat(64),
  SESSION_CLIENT_SECRET: 'private-client',
  DATABASE_URL: 'private-database-url',
};
test('maintenance requires an explicit dedicated database and verifies TLS by default', () => {
  assert.throws(() => databaseContext({}), /Explicit PostgreSQL/);
  assert.throws(
    () => databaseContext({ ...configuration, PGDATABASE: 'postgres' }),
    /dedicated/,
  );
  for (const mode of ['disable', 'require', 'prefer', 'verify-ca'])
    assert.throws(
      () => databaseContext({ ...configuration, PGSSLMODE: mode }),
      /verify-full/,
    );
  const context = databaseContext(configuration);
  try {
    assert.equal(context.env.PGSSLMODE, 'verify-full');
  } finally {
    context.close();
  }
});
test('child tools receive an escaped private password file and no application secrets', () => {
  const context = databaseContext(configuration),
    filename = context.env.PGPASSFILE;
  try {
    assert.equal(
      fs.readFileSync(filename, 'utf8'),
      'db.test:5432:bff:bff:p\\:a\\\\ss\n',
    );
    for (const name of [
      'PGPASSWORD',
      'SESSION_POSTGRES_PASSWORD',
      'SESSION_ENCRYPTION_KEY',
      'SESSION_BACKUP_KEY',
      'SESSION_CLIENT_SECRET',
      'DATABASE_URL',
    ])
      assert.equal(context.env[name], undefined);
    if (process.platform !== 'win32')
      assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
  } finally {
    context.close();
  }
  assert.equal(fs.existsSync(filename), false);
});
test('password files are supported and multiline credentials cannot inject pgpass records', () => {
  const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'maintenance-password-test-'),
    ),
    filename = path.join(directory, 'password');
  try {
    fs.writeFileSync(filename, 'private-password\n', { mode: 0o600 });
    const context = databaseContext({
      ...configuration,
      PGPASSWORD_FILE: filename,
    });
    try {
      assert.match(
        fs.readFileSync(context.env.PGPASSFILE, 'utf8'),
        /:private-password\n$/,
      );
    } finally {
      context.close();
    }
    assert.throws(
      () =>
        databaseContext({
          ...configuration,
          SESSION_POSTGRES_PASSWORD: 'x\ninjected',
        }),
      /password/,
    );
    assert.throws(
      () => databaseContext({ ...configuration, PGHOST: 'x\ninjected' }),
      /Explicit/,
    );
  } finally {
    fs.unlinkSync(filename);
    fs.rmdirSync(directory);
  }
});
test('local plaintext database access needs an explicit exception', () => {
  const context = databaseContext({
    ...configuration,
    PGSSLMODE: 'disable',
    SESSION_OPS_ALLOW_INSECURE: 'true',
  });
  try {
    assert.equal(context.env.PGSSLMODE, 'disable');
  } finally {
    context.close();
  }
});
test('backup key generation refuses overwrite and never returns the key', async () => {
  const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'maintenance-key-test-'),
    ),
    filename = path.join(directory, '.env.session-backup');
  try {
    assert.deepEqual(await main(['keygen', '--output', filename], {}), {
      keyFileCreated: true,
    });
    const before = fs.readFileSync(filename, 'utf8');
    assert.match(before, /^SESSION_BACKUP_KEY=[a-f0-9]{64}\n$/);
    await assert.rejects(main(['keygen', '--output', filename], {}), {
      code: 'EEXIST',
    });
    assert.equal(fs.readFileSync(filename, 'utf8'), before);
  } finally {
    fs.unlinkSync(filename);
    fs.rmdirSync(directory);
  }
});
test('unknown commands and invalid intervals fail before connecting', async () => {
  await assert.rejects(main(['unknown'], configuration), /Unknown/);
  await assert.rejects(
    main(['cleanup-loop', '--interval-seconds', '0'], configuration),
    /numeric/,
  );
  await assert.rejects(main(['backup'], configuration), /directory/);
});

// Stand-ins for psql (reads stdin) and pg_restore (writes stdout), so the
// restore transaction can be driven without PostgreSQL client tools.
function fakeRestoreTools() {
  const settle = (child, code) => {
    if (child.settled) return;
    child.settled = true;
    setImmediate(() => child.emit('close', code));
  };
  const psql = new EventEmitter();
  psql.written = [];
  psql.stdin = new Writable({
    write(chunk, _encoding, callback) {
      psql.written.push(String(chunk));
      callback();
    },
  });
  // psql exits 0 at end of input, also when its stdin is torn down inside the
  // open transaction (PostgreSQL then rolls that transaction back).
  psql.stdin.on('finish', () => settle(psql, 0));
  psql.stdin.on('close', () => settle(psql, 0));
  psql.kill = () => settle(psql, null);
  const pgRestore = new EventEmitter();
  pgRestore.stdout = new PassThrough();
  pgRestore.killed = false;
  pgRestore.stdout.on('close', () => settle(pgRestore, 0));
  pgRestore.kill = () => {
    pgRestore.killed = true;
    pgRestore.stdout.destroy();
  };
  const context = {
    env: {},
    spawn: (tool) => (tool === 'psql' ? psql : pgRestore),
  };
  return { psql, pgRestore, context };
}
test('restore streams the archive into one transaction and commits it', async () => {
  const { psql, pgRestore, context } = fakeRestoreTools();
  const restoring = restoreTransaction(context, 'sample.dump');
  pgRestore.stdout.end('CREATE TABLE public.bff_sessions ();\n');
  await restoring;
  assert.equal(
    psql.written.join(''),
    'BEGIN;\nCREATE TABLE public.bff_sessions ();\n' +
      '\nTRUNCATE TABLE public.bff_sessions;\nCOMMIT;\n',
  );
});
test('a read error on the pg_restore stream fails the restore and never commits', async () => {
  const { psql, pgRestore, context } = fakeRestoreTools();
  const restoring = restoreTransaction(context, 'sample.dump');
  pgRestore.stdout.write('CREATE TABLE public.bff_sessions ();\n');
  const readError = new Error('sample read failure');
  setImmediate(() => pgRestore.stdout.destroy(readError));
  await assert.rejects(restoring, (error) => {
    assert.match(error.message, /transaction was not committed/);
    assert.equal(error.safeMaintenanceMessage, true);
    assert.equal(error.cause, readError);
    return true;
  });
  assert.equal(psql.written[0], 'BEGIN;\n');
  assert.ok(!psql.written.join('').includes('COMMIT'));
  assert.equal(pgRestore.killed, true);
});
