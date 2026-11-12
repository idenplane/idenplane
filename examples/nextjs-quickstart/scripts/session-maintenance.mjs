import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { setTimeout as pause } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { SessionCipher } from '../lib/session/crypto.ts';

const MAGIC = Buffer.from('IDENPLANE-BFF-1\n');
const STATUS_DIRECTORY = path.join(os.tmpdir(), 'idenplane-session-ops');
const STATUS_FILE = path.join(STATUS_DIRECTORY, 'cleanup-status.json');
const TOOL_TIMEOUT = 15 * 60 * 1000;
const fail = (message) => {
  throw Object.assign(new Error(message), { safeMaintenanceMessage: true });
};
const integer = (value, fallback, min, max) => {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max)
    fail('Invalid numeric maintenance option');
  return number;
};
const key = (env, name) => {
  if (!/^[a-fA-F0-9]{64}$/.test(env[name] ?? ''))
    fail('Missing or invalid ' + name);
  return Buffer.from(env[name], 'hex');
};
const fingerprint = (value) => createHash('sha256').update(value).digest('hex');
async function fileHash(filename) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

// Passwords are copied to a private pgpass file, never command arguments.
export function databaseContext(env = process.env) {
  const host = env.PGHOST,
    database = env.PGDATABASE,
    user = env.PGUSER;
  for (const value of [host, database, user])
    if (!value || /[\r\n\0]/.test(value))
      fail('Explicit PostgreSQL host, database and user are required');
  if (['postgres', 'template0', 'template1'].includes(database))
    fail('A dedicated session database is required');
  const port = integer(env.PGPORT, 5432, 1, 65535);
  const sslmode = env.PGSSLMODE ?? 'verify-full';
  if (
    sslmode !== 'verify-full' &&
    !(sslmode === 'disable' && env.SESSION_OPS_ALLOW_INSECURE === 'true')
  )
    fail(
      'Database TLS requires verify-full; only the explicit local fixture exception permits disable',
    );
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'idenplane-pgpass-'));
  fs.chmodSync(directory, 0o700);
  try {
    const password = env.PGPASSWORD_FILE
      ? fs.readFileSync(env.PGPASSWORD_FILE, 'utf8').replace(/\r?\n$/, '')
      : env.SESSION_POSTGRES_PASSWORD;
    if (!password || /[\r\n\0]/.test(password))
      fail(
        'A database password file or private session database password is required',
      );
    const escape = (text) =>
      String(text).replaceAll('\\', '\\\\').replaceAll(':', '\\:');
    const passfile = path.join(directory, 'pgpass');
    fs.writeFileSync(
      passfile,
      [host, port, database, user, password].map(escape).join(':') + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    const inherited = Object.fromEntries(
      Object.entries(env).filter(([name]) =>
        /^(PATH|SystemRoot|WINDIR|TEMP|TMP|TMPDIR|HOME|LANG|LC_ALL|TZ|LD_LIBRARY_PATH|PGSSLROOTCERT|PGSSLCERT|PGSSLKEY|PGSSLCRL|PGSSLCRLDIR|PGCHANNELBINDING|PGSSLMINPROTOCOLVERSION)$/i.test(
          name,
        ),
      ),
    );
    const childEnv = {
      ...inherited,
      PGHOST: host,
      PGPORT: String(port),
      PGDATABASE: database,
      PGUSER: user,
      PGSSLMODE: sslmode,
      PGPASSFILE: passfile,
      PGCONNECT_TIMEOUT: '5',
      PGAPPNAME: 'idenplane-session-maintenance',
      PGOPTIONS:
        '-c statement_timeout=120000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=30000',
    };
    function command(tool, args, input) {
      try {
        return execFileSync(tool, args, {
          env: childEnv,
          input,
          encoding: 'utf8',
          timeout: TOOL_TIMEOUT,
          maxBuffer: 1024 * 1024,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        }).trim();
      } catch {
        fail(
          'PostgreSQL maintenance command failed; check connectivity, permissions and tool versions',
        );
      }
    }
    const sql = (text) =>
      command('psql', [
        '-X',
        '--no-password',
        '--set',
        'ON_ERROR_STOP=1',
        '--tuples-only',
        '--no-align',
        '--command',
        text,
      ]);
    return {
      env: childEnv,
      command,
      sql,
      close() {
        fs.unlinkSync(passfile);
        fs.rmdirSync(directory);
      },
    };
  } catch (error) {
    for (const file of fs.readdirSync(directory))
      fs.unlinkSync(path.join(directory, file));
    fs.rmdirSync(directory);
    throw error;
  }
}

function verifyDatabase(context, empty = false) {
  const version = Number(
    context.sql("SELECT current_setting('server_version_num')"),
  );
  if (Math.floor(version / 10000) !== 16)
    fail('This maintenance image requires PostgreSQL server major 16');
  for (const tool of ['pg_dump', 'pg_restore'])
    if (!/\b16\./.test(context.command(tool, ['--version'])))
      fail('PostgreSQL client major 16 is required');
  const relations = JSON.parse(
    context.sql(
      "SELECT COALESCE(json_agg(n.nspname || '.' || c.relname ORDER BY n.nspname,c.relname),'[]'::json) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast' AND c.relkind IN ('r','p','v','m','S','f')",
    ),
  );
  if (
    empty
      ? relations.length !== 0
      : JSON.stringify(relations) !== '["public.bff_sessions"]'
  )
    fail(
      empty
        ? 'Restore target must be an empty dedicated database'
        : 'Only a dedicated session database containing public.bff_sessions is supported',
    );
}

export function cleanupSessions(context, options = {}) {
  verifyDatabase(context);
  const batch = integer(options.batchSize, 500, 1, 5000),
    max = integer(options.maxBatches, 20, 1, 100);
  let deleted = 0,
    batches = 0;
  for (; batches < max;) {
    const count = Number(
      context.sql(
        `WITH stale AS (SELECT ctid FROM public.bff_sessions WHERE expires_at <= clock_timestamp() OR last_seen_at + idle_seconds * interval '1 second' <= clock_timestamp() ORDER BY expires_at LIMIT ${batch} FOR UPDATE SKIP LOCKED), removed AS (DELETE FROM public.bff_sessions b USING stale s WHERE b.ctid=s.ctid RETURNING 1) SELECT count(*) FROM removed`,
      ),
    );
    if (!Number.isSafeInteger(count) || count < 0 || count > batch)
      fail('Invalid cleanup result');
    deleted += count;
    batches++;
    if (count < batch) break;
  }
  return { deleted, batches, batchSize: batch, maxBatches: max };
}

export async function backupSessions(context, output, env = process.env) {
  verifyDatabase(context);
  const payloadKey = key(env, 'SESSION_ENCRYPTION_KEY'),
    backupKey = key(env, 'SESSION_BACKUP_KEY');
  if (payloadKey.equals(backupKey))
    fail('Use an independent backup encryption key');
  const probe = JSON.parse(
    context.sql(
      "SELECT COALESCE(json_agg(p),'[]'::json) FROM (SELECT sid_hash,kind,payload FROM public.bff_sessions ORDER BY sid_hash LIMIT 10) p",
    ),
  );
  try {
    const cipher = new SessionCipher(payloadKey);
    for (const row of probe)
      cipher.open(row.payload, row.kind + ':' + row.sid_hash);
  } catch {
    fail('Session encryption key does not decrypt the sampled source rows');
  }
  const destination = path.resolve(output);
  fs.mkdirSync(destination, { mode: 0o700 }); // Refuses an existing destination.
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), 'idenplane-session-dump-'),
  );
  fs.chmodSync(temporary, 0o700);
  const raw = path.join(temporary, 'session.dump'),
    sealed = path.join(destination, 'archive.enc');
  let complete = false;
  try {
    fs.writeFileSync(raw, '', { flag: 'wx', mode: 0o600 });
    context.command('pg_dump', [
      '--no-password',
      '--format=custom',
      '--no-owner',
      '--no-acl',
      '--table=public.bff_sessions',
      '--file',
      raw,
    ]);
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', backupKey, iv);
    cipher.setAAD(MAGIC);
    fs.writeFileSync(sealed, Buffer.concat([MAGIC, iv]), {
      flag: 'wx',
      mode: 0o600,
    });
    await pipeline(
      fs.createReadStream(raw),
      cipher,
      fs.createWriteStream(sealed, { flags: 'a', mode: 0o600 }),
    );
    fs.appendFileSync(sealed, cipher.getAuthTag());
    const manifest = {
      format: 'idenplane-session-backup-v1',
      createdAt: new Date().toISOString(),
      pgMajor: 16,
      sha256: await fileHash(sealed),
      payloadKeyFingerprint: fingerprint(payloadKey),
      restorePolicy: 'empty-target-atomic-session-invalidation',
    };
    fs.writeFileSync(
      path.join(destination, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      { flag: 'wx', mode: 0o600 },
    );
    complete = true;
    return {
      backupCreated: true,
      format: manifest.format,
      restorePolicy: manifest.restorePolicy,
    };
  } finally {
    if (fs.existsSync(raw)) fs.unlinkSync(raw);
    fs.rmdirSync(temporary);
    if (!complete) {
      for (const file of ['archive.enc', 'manifest.json']) {
        const target = path.join(destination, file);
        if (fs.existsSync(target)) fs.unlinkSync(target);
      }
      fs.rmdirSync(destination);
    }
  }
}

// The dump is decrypted and authenticated completely before any restore SQL.
export async function openBackup(input, env = process.env) {
  const source = path.resolve(input),
    manifest = JSON.parse(
      fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'),
    );
  if (
    manifest.format !== 'idenplane-session-backup-v1' ||
    manifest.pgMajor !== 16 ||
    manifest.restorePolicy !== 'empty-target-atomic-session-invalidation'
  )
    fail('Unsupported session backup format');
  const payloadKey = key(env, 'SESSION_ENCRYPTION_KEY'),
    backupKey = key(env, 'SESSION_BACKUP_KEY');
  if (manifest.payloadKeyFingerprint !== fingerprint(payloadKey))
    fail('The session encryption key does not match this backup');
  const sealed = path.join(source, 'archive.enc');
  if (manifest.sha256 !== (await fileHash(sealed)))
    fail('Backup checksum mismatch');
  const length = fs.statSync(sealed).size,
    header = Buffer.alloc(MAGIC.length + 12),
    authTag = Buffer.alloc(16);
  if (length <= header.length + 16) fail('Truncated session backup');
  const fd = fs.openSync(sealed, 'r');
  try {
    fs.readSync(fd, header, 0, header.length, 0);
    fs.readSync(fd, authTag, 0, 16, length - 16);
  } finally {
    fs.closeSync(fd);
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC))
    fail('Invalid session backup header');
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'idenplane-session-restore-'),
  );
  fs.chmodSync(directory, 0o700);
  const archive = path.join(directory, 'session.dump');
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      backupKey,
      header.subarray(MAGIC.length),
    );
    decipher.setAAD(MAGIC);
    decipher.setAuthTag(authTag);
    await pipeline(
      fs.createReadStream(sealed, { start: header.length, end: length - 17 }),
      decipher,
      fs.createWriteStream(archive, { flags: 'wx', mode: 0o600 }),
    );
    return {
      archive,
      manifest,
      close() {
        fs.unlinkSync(archive);
        fs.rmdirSync(directory);
      },
    };
  } catch {
    if (fs.existsSync(archive)) fs.unlinkSync(archive);
    fs.rmdirSync(directory);
    fail('Session backup authentication failed');
  }
}

async function restoreTransaction(context, archive) {
  // No restored session is ever committed. A failed restore rolls back its DDL
  // and data; successful restore commits only the clean session schema.
  const consumer = spawn(
    'psql',
    ['-X', '--no-password', '--set', 'ON_ERROR_STOP=1', '--quiet'],
    {
      env: context.env,
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true,
    },
  );
  const producer = spawn(
    'pg_restore',
    ['--no-owner', '--no-acl', '--file=-', archive],
    {
      env: context.env,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    },
  );
  let producerError = false,
    consumerError = false;
  consumer.stdin.on('error', () => {
    consumerError = true;
  });
  producer.on('error', () => {
    producerError = true;
    consumer.stdin.destroy();
  });
  consumer.on('error', () => {
    consumerError = true;
    producer.kill();
  });
  consumer.on('close', (code) => {
    if (code !== 0) producer.kill();
  });
  const consumed = new Promise((resolve) =>
    consumer.on('close', (code) => resolve(code)),
  );
  const produced = new Promise((resolve) =>
    producer.on('close', (code) => resolve(code)),
  );
  const timeout = setTimeout(() => {
    producerError = true;
    producer.kill();
    consumer.kill();
  }, TOOL_TIMEOUT);
  try {
    consumer.stdin.write('BEGIN;\n');
    producer.stdout.pipe(consumer.stdin, { end: false });
    const code = await produced;
    if (code !== 0 || producerError) {
      consumer.stdin.end('\nROLLBACK;\n');
      await consumed;
      fail('Session restore failed; transaction was not committed');
    }
    if (!consumer.stdin.destroyed)
      consumer.stdin.end('\nTRUNCATE TABLE public.bff_sessions;\nCOMMIT;\n');
    if ((await consumed) !== 0 || consumerError)
      fail('Session restore failed; transaction was not committed');
  } finally {
    clearTimeout(timeout);
  }
}

export async function restoreSessions(context, input, env = process.env) {
  const opened = await openBackup(input, env);
  try {
    verifyDatabase(context, true);
    context.command('pg_restore', ['--list', opened.archive]);
    await restoreTransaction(context, opened.archive);
    return { restored: true, activeSessionsRestored: 0, requiresSignIn: true };
  } finally {
    opened.close();
  }
}

function writeStatus(value) {
  fs.mkdirSync(STATUS_DIRECTORY, { recursive: true, mode: 0o700 });
  const temporary = STATUS_FILE + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(temporary, STATUS_FILE);
}
export async function main(args = process.argv.slice(2), env = process.env) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      output: { type: 'string' },
      input: { type: 'string' },
      'batch-size': { type: 'string' },
      'max-batches': { type: 'string' },
      'interval-seconds': { type: 'string' },
    },
  });
  const [action] = positionals;
  if (positionals.length !== 1)
    fail('Choose keygen, backup, restore, cleanup, cleanup-loop or health');
  const interval = integer(
    values['interval-seconds'] ?? env.SESSION_CLEANUP_INTERVAL_SECONDS,
    300,
    1,
    86400,
  );
  if (action === 'keygen') {
    if (!values.output) fail('A new private environment filename is required');
    fs.writeFileSync(
      path.resolve(values.output),
      'SESSION_BACKUP_KEY=' + randomBytes(32).toString('hex') + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    return { keyFileCreated: true };
  }
  if (action === 'health') {
    const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    if (
      !status.ok ||
      Date.now() - Date.parse(status.at) > interval * 1000 + 150000
    )
      fail('Session cleanup is not healthy');
    return { healthy: true };
  }
  if (!['backup', 'restore', 'cleanup', 'cleanup-loop'].includes(action))
    fail('Unknown session maintenance command');
  if (
    (action === 'backup' && !values.output) ||
    (action === 'restore' && !values.input)
  )
    fail('A backup output or restore input directory is required');
  const context = databaseContext(env);
  try {
    const options = {
      batchSize: values['batch-size'] ?? env.SESSION_CLEANUP_BATCH_SIZE,
      maxBatches: values['max-batches'] ?? env.SESSION_CLEANUP_MAX_BATCHES,
    };
    if (action === 'backup')
      return await backupSessions(context, values.output, env);
    if (action === 'restore')
      return await restoreSessions(context, values.input, env);
    if (action === 'cleanup') return cleanupSessions(context, options);
    const controller = new AbortController(),
      stop = () => controller.abort();
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    try {
      while (!controller.signal.aborted) {
        try {
          const result = cleanupSessions(context, options);
          const status = { ok: true, at: new Date().toISOString(), ...result };
          writeStatus(status);
          console.log(JSON.stringify(status));
        } catch {
          const status = {
            ok: false,
            at: new Date().toISOString(),
            error: 'session_cleanup_failed',
          };
          writeStatus(status);
          console.error(JSON.stringify(status));
        }
        try {
          await pause(interval * 1000, undefined, {
            signal: controller.signal,
          });
        } catch {
          break;
        }
      }
    } finally {
      process.removeListener('SIGTERM', stop);
      process.removeListener('SIGINT', stop);
    }
    return { stopped: true };
  } finally {
    context.close();
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(
        JSON.stringify({
          error:
            error.code === 'EEXIST'
              ? 'Refusing to overwrite an existing file or backup directory'
              : error.safeMaintenanceMessage
                ? error.message
                : 'Session maintenance failed; verify private configuration and backup integrity',
        }),
      );
      process.exitCode = 1;
    });
}
