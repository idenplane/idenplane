// Mock Prisma client
const mockPrisma = {
  $connect: jest.fn(),
  $queryRaw: jest.fn(),
  $disconnect: jest.fn(),
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => mockPrisma),
}));

// Mock child_process execSync
jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));

import { PreUpgradeValidatorService } from './pre-upgrade-validator.service.js';
import { execSync } from 'child_process';

describe('PreUpgradeValidatorService', () => {
  let validatorService: PreUpgradeValidatorService;

  beforeEach(() => {
    jest.clearAllMocks();
    validatorService = new PreUpgradeValidatorService();
  });

  afterEach(async () => {
    await validatorService.onModuleDestroy();
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

  describe('checkPendingMigrations', () => {
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
        const err = new Error('Migration pending') as NodeJS.ErrnoException & { stdout: string };
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
    it('should return pass when sufficient disk space (>=1GB)', async () => {
      (execSync as jest.Mock).mockReturnValue(
        'Filesystem  1K-blocks  Used Available Use% Mounted on\n/dev/sda1  100000000  50000000  50000000  50% /',
      );

      const check = await (validatorService as any).checkDiskSpace();

      expect(check.name).toBe('disk_space');
      expect(check.status).toBe('pass');
      expect(check.message).toContain('GB');
    });

    it('should return warn when low disk space (256MB-1GB)', async () => {
      // 500MB available
      (execSync as jest.Mock).mockReturnValue(
        'Filesystem  1K-blocks  Used Available Use% Mounted on\n/dev/sda1  1000000  500000  500000  50% /',
      );

      const check = await (validatorService as any).checkDiskSpace();

      expect(check.name).toBe('disk_space');
      expect(check.status).toBe('warn');
    });

    it('should return fail when insufficient disk space (<256MB)', async () => {
      // 100MB available
      (execSync as jest.Mock).mockReturnValue(
        'Filesystem  1K-blocks  Used Available Use% Mounted on\n/dev/sda1  1000000  900000  100000  90% /',
      );

      const check = await (validatorService as any).checkDiskSpace();

      expect(check.name).toBe('disk_space');
      expect(check.status).toBe('fail');
      expect(check.message).toContain('Insufficient');
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
