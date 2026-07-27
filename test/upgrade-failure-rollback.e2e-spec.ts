/**
 * The failure path, end to end, against a real database.
 *
 * #1200 proved the backup/restore mechanics in isolation: pg_dump writes a real
 * archive and pg_restore puts deleted rows back. What no test covered was the
 * thing the whole feature exists for — an upgrade that gets past the backup and
 * then fails, and whether the automatic rollback actually runs and completes.
 *
 * That path had three independent defects fixed across #1197-#1199 (the audit
 * row never carried a backupId when it was needed; the archive could not be
 * restored; the health check could never pass), each of which would have made
 * this scenario fail. None of them were caught by a test that mocked the shell.
 *
 * The migration is made to fail the way it fails in production: Prisma refuses
 * to deploy when a previous migration is recorded as started-but-not-finished
 * (error P3009). Nothing here is mocked — real pg_dump, real pg_restore, real
 * `prisma migrate deploy`, real Postgres.
 *
 * Skipped, loudly, when the pg tools are unavailable.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Client } from 'pg';
import { PrismaService } from '../src/prisma/prisma.service';
import { UpgradeService, UpgradeStage } from '../src/upgrade/upgrade.service';
import { DatabaseBackupService } from '../src/upgrade/database-backup.service';
import { RollbackService } from '../src/upgrade/rollback.service';
import { PreUpgradeValidatorService } from '../src/upgrade/pre-upgrade-validator.service';
import { ConfigCompatibilityService } from '../src/upgrade/config-compatibility.service';
import { UpgradeHealthService } from '../src/upgrade/upgrade-health.service';

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
    '[upgrade-failure-rollback] SKIPPED: pg_dump/pg_restore not on PATH.',
  );
}

describeMaybe('upgrade failure triggers a real rollback', () => {
  const scratchDb = `idenplane_rb_${process.pid}`;
  let scratchUrl: string;
  let backupDir: string;
  let prisma: PrismaService;
  let upgradeService: UpgradeService;
  const savedEnv: Record<string, string | undefined> = {};

  const onScratch = async <T>(fn: (c: Client) => Promise<T>): Promise<T> => {
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

    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${scratchDb}"`);
    await admin.query(`CREATE DATABASE "${scratchDb}"`);
    await admin.end();

    backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idenplane-rb-'));

    for (const k of [
      'DATABASE_URL',
      'BACKUP_DIR',
      'UPGRADE_ALLOW_LIVE_RESTORE',
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
    // The rollback path refuses to restore over a live database unless this is
    // set (#1199) — the scratch database is the only thing it can reach here.
    process.env['UPGRADE_ALLOW_LIVE_RESTORE'] = 'true';

    // Real schema, applied by the real migration runner — invoked the same
    // shell-free way UpgradeService.runDatabaseMigration does.
    execFileSync(
      process.execPath,
      [
        require.resolve('prisma/build/index.js'),
        'migrate',
        'deploy',
        '--schema',
        'prisma/schema.prisma',
      ],
      { env: process.env, stdio: ['pipe', 'pipe', 'pipe'], timeout: 300_000 },
    );

    // PrismaService reads DATABASE_URL (set to the scratch database above) and
    // builds the same PrismaPg driver adapter production uses — Prisma 7 has no
    // `datasources` constructor option.
    prisma = new PrismaService();
    await prisma.$connect();

    const backup = new DatabaseBackupService();
    const rollback = new RollbackService(prisma, backup);
    upgradeService = new UpgradeService(
      prisma,
      new PreUpgradeValidatorService(prisma, backup),
      backup,
      new ConfigCompatibilityService(prisma),
      rollback,
      new UpgradeHealthService(prisma),
    );
  }, 300_000);

  afterAll(async () => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }

    try {
      await prisma?.$disconnect();
    } catch {
      /* best effort */
    }

    try {
      const admin = new Client({ connectionString: adminUrl });
      await admin.connect();
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
  }, 120_000);

  beforeAll(async () => {
    // Seed something recognisable so the restore has real data to put back.
    await onScratch(async (c) => {
      await c.query(
        `INSERT INTO realms (id, name, display_name, created_at, updated_at)
         VALUES ('rb-realm', 'rollback-test', 'Rollback Test', now(), now())`,
      );
    });

    // Break the database the way it breaks in production: a migration recorded
    // as started and never finished. `prisma migrate deploy` then refuses with
    // P3009 rather than applying anything.
    await onScratch(async (c) => {
      await c.query(
        `INSERT INTO _prisma_migrations
           (id, checksum, migration_name, started_at, applied_steps_count)
         VALUES ($1, $2, $3, now(), 0)`,
        [
          'deadbeef-0000-4000-8000-000000000000',
          'x'.repeat(64),
          '99999999999999_deliberately_failed',
        ],
      );
    });
  }, 60_000);

  it('refuses to start at all, before touching anything', async () => {
    // The safe path: pre-validation notices the broken migration state and
    // aborts at stage 2 — no backup, no migration. Worth asserting explicitly,
    // because it is the reason the next test has to pass force.
    const result = await upgradeService.upgrade('9.9.9', {
      initiatedBy: 'e2e-failure-test',
    });

    expect(result.success).toBe(false);
    expect(
      result.stages.find((s) => s.stage === UpgradeStage.PRE_VALIDATION)
        ?.success,
    ).toBe(false);
    expect(
      result.stages.find((s) => s.stage === UpgradeStage.BACKUP),
    ).toBeUndefined();
    expect(result.rollbackTriggered).toBe(false);
  }, 300_000);

  it('backs up, fails the migration, and rolls back — all for real', async () => {
    // force skips pre-validation, which is precisely the situation the rollback
    // exists for: an operator overrode the warning, the migration then failed,
    // and the only thing standing between them and a half-migrated database is
    // the backup taken moments earlier.
    const result = await upgradeService.upgrade('9.9.9', {
      initiatedBy: 'e2e-failure-test',
      force: true,
    });

    const stageOf = (s: UpgradeStage) =>
      result.stages.find((x) => x.stage === s);

    // The backup must have been taken before the failure — otherwise there is
    // nothing to roll back to, which was the original defect.
    expect(stageOf(UpgradeStage.BACKUP)?.success).toBe(true);

    // The migration must genuinely have failed, not been skipped.
    expect(stageOf(UpgradeStage.DATABASE_MIGRATION)?.success).toBe(false);

    // …and that failure must have triggered a rollback that completed.
    expect(result.rollbackTriggered).toBe(true);
    expect(stageOf(UpgradeStage.ROLLBACK)?.success).toBe(true);
    expect(result.success).toBe(false);

    // The audit row carries the archive, written at BACKUP rather than at
    // completion — an upgrade that fails never reaches completion.
    const audit = await prisma.upgradeAuditLog.findUnique({
      where: { id: result.upgradeId! },
    });
    expect(audit?.backupId).toBeTruthy();
    expect(audit?.backupPath).toMatch(/\.dump$/);

    // The archive is a real custom-format dump on disk.
    const head = fs.readFileSync(audit!.backupPath!).subarray(0, 5).toString();
    expect(head).toBe('PGDMP');

    // The seeded realm survived the restore.
    await onScratch(async (c) => {
      const { rows } = await c.query(
        `SELECT name FROM realms WHERE id = 'rb-realm'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('rollback-test');
    });
  }, 300_000);
});
