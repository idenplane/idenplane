jest.mock('child_process', () => ({
  execFileSync: jest.fn(),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  statSync: jest.fn(),
  readdirSync: jest.fn(),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import { DatabaseBackupService } from './database-backup.service.js';

const mockExec = execFileSync as jest.Mock;
const mockFs = fs as jest.Mocked<typeof fs>;

/** Flatten an execFileSync call into "cmd arg arg …" for readable assertions. */
const callToString = (call: unknown[]) =>
  `${String(call[0])} ${(call[1] as string[]).join(' ')}`;

const findCall = (cmd: string) =>
  mockExec.mock.calls.find((c) => c[0] === cmd) as unknown[] | undefined;

describe('DatabaseBackupService', () => {
  const ORIGINAL_ENV = process.env;

  const buildService = (env: Record<string, string | undefined> = {}) => {
    process.env = { ...ORIGINAL_ENV, ...env } as NodeJS.ProcessEnv;
    return new DatabaseBackupService();
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockExec.mockReturnValue('');
    mockFs.existsSync.mockReturnValue(true);
    mockFs.statSync.mockReturnValue({ size: 5_000_000 } as fs.Stats);
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('connection parameters', () => {
    // The bug this guards: only the database *name* was read from DATABASE_URL.
    // Host/port/user fell back to localhost/5432/postgres, so in Docker — where
    // DATABASE_URL points at host `db` — pg_dump dialled localhost and failed.
    it('takes host, port, user and database from DATABASE_URL', () => {
      const service = buildService({
        DATABASE_URL: 'postgresql://appuser:secret@db:6543/idenplane',
        PGHOST: undefined,
        PGPORT: undefined,
        PGUSER: undefined,
        PGPASSWORD: undefined,
        DATABASE_USERNAME: undefined,
        DATABASE_PASSWORD: undefined,
      });

      service.createBackup('test');

      const args = callToString(findCall('pg_dump')!);
      expect(args).toContain('-h db');
      expect(args).toContain('-p 6543');
      expect(args).toContain('-U appuser');
      expect(args).toContain('-d idenplane');
      expect(args).not.toContain('localhost');
    });

    it('decodes percent-encoded credentials', () => {
      // A password of  p@ss/w:rd  must round-trip, or auth fails in a way that
      // looks like a wrong password rather than a parsing bug.
      const service = buildService({
        DATABASE_URL:
          'postgresql://user%40corp:p%40ss%2Fw%3Ard@db:5432/idenplane',
        PGUSER: undefined,
        PGPASSWORD: undefined,
        DATABASE_USERNAME: undefined,
        DATABASE_PASSWORD: undefined,
      });

      service.createBackup();

      const call = findCall('pg_dump')!;
      expect(callToString(call)).toContain('-U user@corp');
      expect((call[2] as { env: NodeJS.ProcessEnv }).env.PGPASSWORD).toBe(
        'p@ss/w:rd',
      );
    });

    it('never puts the password in argv', () => {
      const service = buildService({
        DATABASE_URL: 'postgresql://u:hunter2@db:5432/idenplane',
      });

      service.createBackup();

      expect(callToString(findCall('pg_dump')!)).not.toContain('hunter2');
    });

    it('treats PGHOST as an override, not a default', () => {
      const service = buildService({
        DATABASE_URL: 'postgresql://u:p@db:5432/idenplane',
        PGHOST: 'pgbouncer',
      });

      service.createBackup();

      expect(callToString(findCall('pg_dump')!)).toContain('-h pgbouncer');
    });

    it('fails loudly on a non-postgres DATABASE_URL rather than dumping the wrong database', () => {
      const service = buildService({
        DATABASE_URL: 'mysql://u:p@db:3306/idenplane',
      });

      const result = service.createBackup();

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/PostgreSQL/i);
      expect(findCall('pg_dump')).toBeUndefined();
    });
  });

  describe('archive format', () => {
    // pg_dump -Fc writes a custom-format archive whose magic bytes are "PGDMP".
    // It was being written to a file named .sql.gz, and restoreBackup branched
    // on that suffix and ran gunzipSync — which throws on every archive this
    // service has ever produced.
    it('writes a .dump file, not .sql.gz', () => {
      const service = buildService({
        DATABASE_URL: 'postgresql://u:p@db:5432/idenplane',
      });

      const result = service.createBackup('pre-upgrade-1.0.0');

      expect(result.backupPath).toMatch(/\.dump$/);
      expect(result.backupPath).not.toMatch(/\.gz$/);
    });

    it('restores straight from the file with no decompression step', () => {
      const service = buildService({
        DATABASE_URL: 'postgresql://u:p@db:5432/idenplane',
      });

      service.restoreBackup('/backups/idenplane-backup-x.dump');

      const call = findCall('pg_restore')!;
      expect((call[1] as string[]).at(-1)).toBe(
        '/backups/idenplane-backup-x.dump',
      );
      // No stdin piping — the previous zlib path fed decompressed bytes in.
      expect((call[2] as { input?: unknown }).input).toBeUndefined();
      expect(mockFs.readFileSync).not.toHaveBeenCalled();
    });

    it('restores with --clean so a populated database does not reject it', () => {
      const service = buildService({
        DATABASE_URL: 'postgresql://u:p@db:5432/idenplane',
      });

      service.restoreBackup('/backups/x.dump');

      const args = callToString(findCall('pg_restore')!);
      // Without --clean every restore into a live database dies on
      // "relation already exists" — i.e. exactly when a rollback is needed.
      expect(args).toContain('--clean');
      expect(args).toContain('--if-exists');
      // A rollback that half-applies is worse than one that fails cleanly.
      expect(args).toContain('--single-transaction');
      expect(args).toContain('--exit-on-error');
    });

    it('lists only .dump archives', () => {
      const service = buildService({ BACKUP_DIR: '/backups' });
      mockFs.readdirSync.mockReturnValue([
        'idenplane-backup-new.dump',
        'idenplane-backup-legacy.sql.gz', // never actually gzip, unrestorable
        'notes.txt',
      ] as unknown as fs.Dirent[]);
      mockFs.statSync.mockReturnValue({
        size: 1000,
        birthtime: new Date(),
      } as fs.Stats);

      const listed = service.listBackups().map((b) => b.filename);

      expect(listed).toEqual(['idenplane-backup-new.dump']);
    });
  });

  describe('verifyBackup', () => {
    it('reads the archive table of contents, not just the file size', () => {
      const service = buildService();

      expect(service.verifyBackup('/backups/x.dump')).toBe(true);

      const args = callToString(findCall('pg_restore')!);
      expect(args).toContain('--list');
    });

    it('rejects an archive whose table of contents cannot be read', () => {
      // A file truncated by a full disk still passes a size check but has no
      // readable TOC — and this runs immediately before a rollback trusts it.
      const service = buildService();
      mockExec.mockImplementation(() => {
        throw new Error('pg_restore: error: did not find magic string');
      });

      expect(service.verifyBackup('/backups/truncated.dump')).toBe(false);
    });

    it('rejects a missing or trivially small file without shelling out', () => {
      const service = buildService();
      mockFs.existsSync.mockReturnValue(false);

      expect(service.verifyBackup('/backups/missing.dump')).toBe(false);
      expect(mockExec).not.toHaveBeenCalled();
    });
  });

  describe('pgToolsAvailable', () => {
    it('reports available when both binaries respond', () => {
      expect(buildService().pgToolsAvailable().available).toBe(true);
    });

    it('reports unavailable, naming the missing binary', () => {
      const service = buildService();
      mockExec.mockImplementation((cmd: string) => {
        if (cmd === 'pg_restore') throw new Error('ENOENT');
        return '';
      });

      const { available, detail } = service.pgToolsAvailable();

      expect(available).toBe(false);
      expect(detail).toContain('pg_restore');
    });
  });
});
