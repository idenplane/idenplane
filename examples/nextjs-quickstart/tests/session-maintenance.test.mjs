import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { databaseContext, main } from '../scripts/session-maintenance.mjs';

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
