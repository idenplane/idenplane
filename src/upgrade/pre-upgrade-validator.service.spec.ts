// Mock Prisma client
const mockPrisma = {
  $connect: jest.fn(),
  $queryRaw: jest.fn(),
  $disconnect: jest.fn(),
};

// Mock child_process execSync
jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));

// fs is mocked as a module rather than spied on: its exports are
// non-configurable under Node 22, so jest.spyOn throws "Cannot redefine
// property". Mocking keeps the suite hermetic — checkBackupDirectory writes a
// probe file, which must not touch the real working tree.
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  statfsSync: jest.fn(),
}));

import { PreUpgradeValidatorService } from './pre-upgrade-validator.service.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import { PrismaService } from '../prisma/prisma.service.js';
import { DatabaseBackupService } from './database-backup.service.js';

describe('PreUpgradeValidatorService', () => {
  let validatorService: PreUpgradeValidatorService;
  let mockBackupService: jest.Mocked<DatabaseBackupService>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockBackupService = {
      pgToolsAvailable: jest
        .fn()
        .mockReturnValue({ available: true, detail: 'ok' }),
      // Matching majors by default; the version-match tests override this.
      clientMajorVersion: jest.fn().mockReturnValue(16),
    } as unknown as jest.Mocked<DatabaseBackupService>;

    // Defaults: directory usable, plenty of space. Individual tests override.
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.statfsSync as jest.Mock).mockReturnValue({
      bavail: 5_000_000,
      bsize: 4096,
    });

    validatorService = new PreUpgradeValidatorService(
      mockPrisma as unknown as PrismaService,
      mockBackupService,
    );
  });

  describe('validate', () => {
    it('should return canProceed=true when all checks pass', async () => {
      // Mock successful database connection
      mockPrisma.$connect.mockResolvedValue(undefined);
      mockPrisma.$queryRaw.mockResolvedValue([]);

      // Mock successful migration status (no pending)
      (execSync as jest.Mock).mockReturnValue('All migrations are up to date.');

      // Mock disk space check (2GB available)
      (execSync as jest.Mock).mockImplementation((cmd: string) => {
        if (cmd === 'npx prisma migrate status 2>&1') {
          return 'All migrations are up to date.';
        }
        if (cmd.startsWith('df -k')) {
          return 'Filesystem  1K-blocks  Used Available Use% Mounted on\n/dev/sda1  100000000  50000000  50000000  50% /';
        }
        return '';
      });

      // Mock database size query
      mockPrisma.$queryRaw.mockResolvedValue([
        { pg_size_pretty: '100 MB', size_bytes: BigInt(104857600) },
      ]);

      const result = await validatorService.validate('2.1.0');

      expect(result.canProceed).toBe(true);
      expect(result.summary.failures).toBe(0);
    });

    it('should return canProceed=false when any check fails', async () => {
      // Mock database connection failure
      mockPrisma.$connect.mockRejectedValue(new Error('Connection refused'));
      mockPrisma.$queryRaw.mockRejectedValue(new Error('Connection refused'));

      // Other checks will fail too
      (execSync as jest.Mock).mockImplementation((cmd: string) => {
        if (cmd === 'npx prisma migrate status 2>&1') {
          return 'All migrations are up to date.';
        }
        if (cmd.startsWith('df -k')) {
          return 'Filesystem  1K-blocks  Used Available Use% Mounted on\n/dev/sda1  100000000  50000000  50000000  50% /';
        }
        return '';
      });

      mockPrisma.$queryRaw.mockResolvedValue([
        { pg_size_pretty: '100 MB', size_bytes: BigInt(104857600) },
      ]);

      const result = await validatorService.validate('2.1.0');

      expect(result.canProceed).toBe(false);
      expect(result.summary.failures).toBeGreaterThan(0);
      expect(
        result.checks.some(
          (c) => c.name === 'database_connection' && c.status === 'fail',
        ),
      ).toBe(true);
    });
  });

  describe('checkDatabaseConnection', () => {
    it('should return pass when database connection succeeds', async () => {
      mockPrisma.$connect.mockResolvedValue(undefined);
      mockPrisma.$queryRaw.mockResolvedValue([]);

      // Access private method via any type
      const check = await (validatorService as any).checkDatabaseConnection();

      expect(check.name).toBe('database_connection');
      expect(check.status).toBe('pass');
      expect(check.message).toBe('Database connection is healthy');
    });

    it('should return fail when database connection fails', async () => {
      mockPrisma.$connect.mockRejectedValue(new Error('Connection refused'));

      const check = await (validatorService as any).checkDatabaseConnection();

      expect(check.name).toBe('database_connection');
      expect(check.status).toBe('fail');
      expect(check.message).toBe('Cannot connect to database');
    });
  });

  describe('checkPgVersionMatch', () => {
    // Measured against a real PostgreSQL 16 server: pg_dump 18 writes an
    // archive fine, but pg_restore 18 fails with "unrecognized configuration
    // parameter transaction_timeout" (a PG 17 GUC) and pg_restore 16 fails with
    // "unsupported version (1.16) in file header". A newer client therefore
    // produces backups nothing can restore onto that server — no rollback, and
    // you only find out when you need one. Equality is the requirement.
    const withVersions = (client: number | null, serverNum: string | null) => {
      mockBackupService.clientMajorVersion = jest.fn().mockReturnValue(client);
      mockPrisma.$queryRaw.mockImplementation(() =>
        serverNum === null
          ? Promise.reject(new Error('no server version'))
          : Promise.resolve([{ server_version_num: serverNum }]),
      );
    };

    it('passes when the majors match', async () => {
      withVersions(16, '160014');

      const check = await (validatorService as any).checkPgVersionMatch();

      expect(check.status).toBe('pass');
      expect(check.message).toContain('16');
    });

    it('fails when the client is newer than the server', async () => {
      withVersions(18, '160014');

      const check = await (validatorService as any).checkPgVersionMatch();

      expect(check.status).toBe('fail');
      expect(check.message).toMatch(/18.*16/);
      // The remedy must name the version to install, not just state the problem.
      expect(check.details).toContain('postgresql-client 16');
    });

    it('fails when the client is older than the server', async () => {
      withVersions(16, '180004');

      const check = await (validatorService as any).checkPgVersionMatch();

      expect(check.status).toBe('fail');
    });

    it('warns rather than fails when either version is unknown', async () => {
      withVersions(null, '160014');
      expect(
        (await (validatorService as any).checkPgVersionMatch()).status,
      ).toBe('warn');

      withVersions(16, null);
      expect(
        (await (validatorService as any).checkPgVersionMatch()).status,
      ).toBe('warn');
    });
  });

  describe('checkPendingMigrations', () => {
    // Verbatim `prisma migrate status` output, captured from a real database
    // with one pending migration during an upgrade rehearsal. The previous
    // parser looked for a `[ ]` checkbox that Prisma does not emit, so it found
    // nothing, fell through to the "cannot determine status" branch and
    // reported a hard failure — making canProceed false in exactly the
    // situation an upgrade exists for. The fixture is real output rather than
    // invented text precisely so the parser cannot drift away from it again.
    const REAL_PENDING_OUTPUT = [
      'Loaded Prisma config from prisma.config.ts.',
      '',
      'Prisma schema loaded from prisma\\schema.prisma.',
      'Datasource "db": PostgreSQL database "idenplane_rehearsal", schema "public" at "localhost:5432"',
      '',
      '45 migrations found in prisma/migrations',
      'Following migration have not yet been applied:',
      '99990101000000_rehearsal_add_column',
      '',
      'To apply migrations in development run prisma migrate dev.',
      'To apply migrations in production run prisma migrate deploy.',
    ].join('\n');

    it('reports a pending migration as a warning, not a failure', () => {
      (execSync as jest.Mock).mockImplementation(() => {
        const err = new Error('exit 1') as NodeJS.ErrnoException & {
          stdout: string;
        };
        err.stdout = REAL_PENDING_OUTPUT;
        throw err;
      });

      const check = (validatorService as any).checkPendingMigrations();

      expect(check.status).toBe('warn');
      expect(check.message).toContain('1 pending migration');
      expect(check.details).toContain('99990101000000_rehearsal_add_column');
    });

    it('does not swallow the prose that follows the list', () => {
      (execSync as jest.Mock).mockImplementation(() => {
        const err = new Error('exit 1') as NodeJS.ErrnoException & {
          stdout: string;
        };
        err.stdout = REAL_PENDING_OUTPUT;
        throw err;
      });

      const check = (validatorService as any).checkPendingMigrations();

      // "To apply migrations in development run prisma migrate dev." must not
      // be mistaken for a migration name.
      expect(check.details).not.toMatch(/To apply|prisma migrate/);
    });

    it('should return pass when no pending migrations', async () => {
      (execSync as jest.Mock).mockReturnValue('All migrations are up to date.');

      const check = await (validatorService as any).checkPendingMigrations();

      expect(check.name).toBe('pending_migrations');
      expect(check.status).toBe('pass');
      expect(check.message).toBe('No pending migrations');
    });

    it('should return warn when pending migrations exist', async () => {
      // Prisma exits non-zero when there are pending migrations; execSync throws.
      // The service reads err.stdout to parse which migrations are pending.
      const output = `
migration-1   [ ] Pending
migration-2   [ ] Pending
migration-3   [x] Applied
      `;

      (execSync as jest.Mock).mockImplementation(() => {
        const err = new Error('Migration pending') as NodeJS.ErrnoException & {
          stdout: string;
        };
        err.stdout = output;
        throw err;
      });

      const check = await (validatorService as any).checkPendingMigrations();

      expect(check.name).toBe('pending_migrations');
      expect(check.status).toBe('warn');
      expect(check.message).toContain('pending migration');
    });

    it('should return fail when unable to determine migration status', async () => {
      (execSync as jest.Mock).mockImplementation(() => {
        throw new Error('Unknown error');
      });

      const check = await (validatorService as any).checkPendingMigrations();

      expect(check.name).toBe('pending_migrations');
      expect(check.status).toBe('fail');
    });
  });

  describe('checkDiskSpace', () => {
    // These used to mock `df -k .`. That shell-out is gone: `df` does not exist
    // on Windows, and `.` is the process cwd rather than BACKUP_DIR, so the
    // check could pass on a roomy root while the backup volume was full.
    // statfsSync measures the filesystem the backups actually land on.
    const withFreeBytes = (bytes: number) => {
      (fs.statfsSync as jest.Mock).mockReturnValue({
        bavail: bytes / 4096,
        bsize: 4096,
      });
      (fs.existsSync as jest.Mock).mockReturnValue(true);
    };

    it('should return pass when sufficient disk space (>=1GB)', () => {
      withFreeBytes(50 * 1024 * 1024 * 1024);

      const check = (validatorService as any).checkDiskSpace();

      expect(check.name).toBe('disk_space');
      expect(check.status).toBe('pass');
      expect(check.message).toContain('GB');
    });

    it('should return warn when low disk space (256MB-1GB)', () => {
      withFreeBytes(500 * 1024 * 1024);

      const check = (validatorService as any).checkDiskSpace();

      expect(check.status).toBe('warn');
    });

    it('should return fail when insufficient disk space (<256MB)', () => {
      withFreeBytes(100 * 1024 * 1024);

      const check = (validatorService as any).checkDiskSpace();

      expect(check.status).toBe('fail');
      expect(check.message).toContain('Insufficient');
    });

    it('measures BACKUP_DIR rather than the process working directory', () => {
      process.env.BACKUP_DIR = '/var/lib/idenplane/backups';
      withFreeBytes(50 * 1024 * 1024 * 1024);

      (validatorService as any).checkDiskSpace();

      expect(fs.statfsSync).toHaveBeenCalledWith(
        expect.stringContaining('backups'),
      );
      delete process.env.BACKUP_DIR;
    });
  });

  describe('checkDatabaseSize', () => {
    it('should return pass for small database (<10GB)', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        { pg_size_pretty: '500 MB', size_bytes: BigInt(524288000) },
      ]);

      const check = await (validatorService as any).checkDatabaseSize();

      expect(check.name).toBe('database_size');
      expect(check.status).toBe('pass');
    });

    it('should return warn for large database (10-50GB)', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        { pg_size_pretty: '15 GB', size_bytes: BigInt(16106127360) },
      ]);

      const check = await (validatorService as any).checkDatabaseSize();

      expect(check.name).toBe('database_size');
      expect(check.status).toBe('warn');
    });

    it('should return fail for very large database (>50GB)', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        { pg_size_pretty: '60 GB', size_bytes: BigInt(64424509440) },
      ]);

      const check = await (validatorService as any).checkDatabaseSize();

      expect(check.name).toBe('database_size');
      expect(check.status).toBe('fail');
    });

    it('should return warn on query error', async () => {
      mockPrisma.$queryRaw.mockRejectedValue(new Error('Query failed'));

      const check = await (validatorService as any).checkDatabaseSize();

      expect(check.name).toBe('database_size');
      expect(check.status).toBe('warn');
    });
  });

  describe('checkActiveConnections', () => {
    it('should return pass when active connections are low (<=100)', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ count: BigInt(25) }]);

      const check = await (validatorService as any).checkActiveConnections();

      expect(check.name).toBe('active_connections');
      expect(check.status).toBe('pass');
      expect(check.message).toContain('25');
    });

    it('should return warn when active connections are high (>100)', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ count: BigInt(150) }]);

      const check = await (validatorService as any).checkActiveConnections();

      expect(check.name).toBe('active_connections');
      expect(check.status).toBe('warn');
      expect(check.message).toContain('150');
    });
  });

  describe('checkLongRunningTransactions', () => {
    it('should return pass when no long-running transactions', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      const check = await (
        validatorService as any
      ).checkLongRunningTransactions();

      expect(check.name).toBe('long_running_transactions');
      expect(check.status).toBe('pass');
      expect(check.message).toBe('No long-running transactions detected');
    });

    it('should return warn when long-running transactions exist', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        { pid: 1234, duration_seconds: 45, state: 'active' },
        { pid: 5678, duration_seconds: 60, state: 'active' },
      ]);

      const check = await (
        validatorService as any
      ).checkLongRunningTransactions();

      expect(check.name).toBe('long_running_transactions');
      expect(check.status).toBe('warn');
      expect(check.message).toContain('2 long-running transaction');
    });
  });
});
