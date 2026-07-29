/**
 * Real pg_dump / pg_restore round-trip.
 *
 * Every other test of DatabaseBackupService mocks child_process, so they prove
 * the argument vector is *built* correctly and nothing about whether it *works*.
 * That gap matters here: the service's central defect (idenplane#1150) was that
 * it wrote a pg_dump custom-format archive into a file named .sql.gz and then
 * tried to gunzip it on restore — a mistake no amount of argv assertion catches,
 * because the argv was fine.
 *
 * This exercises the real binaries against a real server, in a scratch database
 * created and dropped per run. It never touches the application's own database.
 *
 * Skipped, loudly, when pg_dump/pg_restore are unavailable — a test that
 * silently no-ops is worse than one that does not exist.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Client } from 'pg';
import { DatabaseBackupService } from '../src/upgrade/database-backup.service';

const pgToolsPresent = (): boolean => {
  for (const tool of ['pg_dump', 'pg_restore']) {
    try {
      execFileSync(tool, ['--version'], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      return false;
    }
  }
  return true;
};

const adminUrl =
  process.env['TEST_DATABASE_URL'] ||
  process.env['DATABASE_URL'] ||
  'postgresql://postgres:testpass123@localhost:5432/postgres';

const HAVE_TOOLS = pgToolsPresent();
const describeMaybe = HAVE_TOOLS ? describe : describe.skip;

if (!HAVE_TOOLS) {
  // eslint-disable-next-line no-console
  console.warn(
    '[upgrade-backup-roundtrip] SKIPPED: pg_dump/pg_restore not on PATH. ' +
      'Install postgresql-client to exercise the real backup/restore path.',
  );
}

describeMaybe('upgrade backup/restore round-trip (real pg tools)', () => {
  const scratchDb = `idenplane_bkp_rt_${process.pid}`;
  let backupDir: string;
  let service: DatabaseBackupService;
  let scratchUrl: string;
  const savedEnv: Record<string, string | undefined> = {};

  const adminClient = () => new Client({ connectionString: adminUrl });

  const withScratch = async <T>(fn: (c: Client) => Promise<T>): Promise<T> => {
    const c = new Client({ connectionString: scratchUrl });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  };

  beforeAll(async () => {
    const base = new URL(adminUrl);
    base.pathname = `/${scratchDb}`;
    scratchUrl = base.toString();

    const admin = adminClient();
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${scratchDb}"`);
    await admin.query(`CREATE DATABASE "${scratchDb}"`);
    await admin.end();

    await withScratch(async (c) => {
      await c.query(`
        CREATE TABLE realms (
          id text PRIMARY KEY,
          name text NOT NULL UNIQUE,
          enabled boolean NOT NULL DEFAULT true
        )
      `);
      await c.query(`
        CREATE TABLE users (
          id text PRIMARY KEY,
          realm_id text NOT NULL REFERENCES realms(id),
          username text NOT NULL
        )
      `);
      await c.query(
        `INSERT INTO realms (id, name) VALUES ('r1', 'master'), ('r2', 'tenant')`,
      );
      await c.query(
        `INSERT INTO users (id, realm_id, username) VALUES ('u1','r1','admin'), ('u2','r2','alice')`,
      );
    });

    backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idenplane-bkp-'));

    // The service reads its connection details from the environment, so point
    // it at the scratch database only — never the app's own.
    for (const k of [
      'DATABASE_URL',
      'BACKUP_DIR',
      'PGHOST',
      'PGPORT',
      'PGUSER',
      'PGPASSWORD',
    ]) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    process.env['DATABASE_URL'] = scratchUrl;
    process.env['BACKUP_DIR'] = backupDir;

    service = new DatabaseBackupService();
  }, 60_000);

  afterAll(async () => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }

    try {
      const admin = adminClient();
      await admin.connect();
      // Terminate our own lingering sessions so DROP DATABASE is not blocked.
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [scratchDb],
      );
      await admin.query(`DROP DATABASE IF EXISTS "${scratchDb}"`);
      await admin.end();
    } catch {
      /* best effort */
    }

    try {
      fs.rmSync(backupDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }, 60_000);

  it('reports the pg tools as available', () => {
    expect(service.pgToolsAvailable().available).toBe(true);
  });

  it('writes a real custom-format archive', () => {
    const result = service.createBackup('roundtrip');

    expect(result.success).toBe(true);
    expect(result.backupPath).toMatch(/\.dump$/);
    expect(fs.existsSync(result.backupPath!)).toBe(true);

    // The assertion the whole slice turns on: pg_dump -Fc emits a custom-format
    // archive beginning "PGDMP". The previous code named this .sql.gz and then
    // gunzipped it on restore, which cannot work — gzip starts 1f 8b.
    const head = fs.readFileSync(result.backupPath!).subarray(0, 5).toString();
    expect(head).toBe('PGDMP');
  }, 60_000);

  it('verifies a good archive and rejects a truncated one', () => {
    const good = service.createBackup('verify-good');
    expect(service.verifyBackup(good.backupPath!)).toBe(true);

    // Simulate a dump cut short by a full disk: still large, but its table of
    // contents (written at the end) is gone. A size check would pass this.
    const truncated = path.join(backupDir, 'truncated.dump');
    const bytes = fs.readFileSync(good.backupPath!);
    fs.writeFileSync(
      truncated,
      bytes.subarray(0, Math.floor(bytes.length / 2)),
    );

    expect(fs.statSync(truncated).size).toBeGreaterThan(1024);
    expect(service.verifyBackup(truncated)).toBe(false);
  }, 60_000);

  it('restores data deleted after the backup was taken', async () => {
    const backup = service.createBackup('restore-me');
    expect(backup.success).toBe(true);

    await withScratch(async (c) => {
      await c.query(`DELETE FROM users WHERE id = 'u2'`);
      const { rows } = await c.query(`SELECT count(*)::int AS n FROM users`);
      expect(rows[0].n).toBe(1);
    });

    const restore = service.restoreBackup(backup.backupPath!);
    expect(restore.success).toBe(true);

    await withScratch(async (c) => {
      const { rows } = await c.query(`SELECT username FROM users ORDER BY id`);
      expect(rows.map((r) => r.username)).toEqual(['admin', 'alice']);
    });
  }, 120_000);

  it('restores into a populated database without duplicating rows', async () => {
    // This is what --clean --if-exists buys. Without it, pg_restore fails on
    // "relation already exists"; a naive fix that drops --clean would instead
    // duplicate every row. Restoring twice must be idempotent.
    const backup = service.createBackup('idempotent');

    expect(service.restoreBackup(backup.backupPath!).success).toBe(true);
    expect(service.restoreBackup(backup.backupPath!).success).toBe(true);

    await withScratch(async (c) => {
      const realms = await c.query(`SELECT count(*)::int AS n FROM realms`);
      const users = await c.query(`SELECT count(*)::int AS n FROM users`);
      expect(realms.rows[0].n).toBe(2);
      expect(users.rows[0].n).toBe(2);
    });
  }, 120_000);

  it('lists the archives it created', () => {
    const listed = service.listBackups();

    expect(listed.length).toBeGreaterThan(0);
    expect(listed.every((b) => b.filename.endsWith('.dump'))).toBe(true);
  });
});
