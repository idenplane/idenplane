// Mock Prisma client
const mockPrisma = {
  $connect: jest.fn(),
  $queryRaw: jest.fn(),
  $disconnect: jest.fn(),
  upgradeAuditLog: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => mockPrisma),
}));

// runDatabaseMigration uses execFileSync (no shell); getCurrentVersion no
// longer shells out at all.
jest.mock('child_process', () => ({
  execSync: jest.fn(),
  execFileSync: jest.fn(),
}));

import { UpgradeService, UpgradeStage } from './upgrade.service.js';
import { PreUpgradeValidatorService } from './pre-upgrade-validator.service.js';
import {
  DatabaseBackupService,
  BackupResult,
} from './database-backup.service.js';
import { ConfigCompatibilityService } from './config-compatibility.service.js';
import { RollbackService } from './rollback.service.js';
import { UpgradeHealthService } from './upgrade-health.service.js';
import { execSync, execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('UpgradeService', () => {
  let upgradeService: UpgradeService;
  let mockPreUpgradeValidator: jest.Mocked<PreUpgradeValidatorService>;
  let mockDatabaseBackupService: jest.Mocked<DatabaseBackupService>;
  let mockConfigCompatibility: jest.Mocked<ConfigCompatibilityService>;
  let mockRollbackService: jest.Mocked<RollbackService>;
  let mockUpgradeHealthService: jest.Mocked<UpgradeHealthService>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock services
    mockPreUpgradeValidator = {
      validate: jest.fn(),
    } as unknown as jest.Mocked<PreUpgradeValidatorService>;

    mockDatabaseBackupService = {
      createBackup: jest.fn(),
    } as unknown as jest.Mocked<DatabaseBackupService>;

    mockConfigCompatibility = {
      checkCompatibility: jest.fn(),
    } as unknown as jest.Mocked<ConfigCompatibilityService>;

    mockRollbackService = {
      executeRollback: jest.fn(),
    } as unknown as jest.Mocked<RollbackService>;

    mockUpgradeHealthService = {
      checkHealth: jest.fn(),
    } as unknown as jest.Mocked<UpgradeHealthService>;

    // Mock execSync for getCurrentVersion
    (execSync as jest.Mock).mockReturnValue('2.0.0');

    upgradeService = new UpgradeService(
      mockPrisma as any,
      mockPreUpgradeValidator,
      mockDatabaseBackupService,
      mockConfigCompatibility,
      mockRollbackService,
      mockUpgradeHealthService,
    );
  });

  describe('upgrade', () => {
    describe('dry-run mode', () => {
      it('should skip backup and migration steps in dry-run mode', async () => {
        // Setup mocks for successful validation
        mockPreUpgradeValidator.validate.mockResolvedValue({
          canProceed: true,
          checks: [],
          summary: { passed: 6, warnings: 0, failures: 0 },
        });

        mockConfigCompatibility.checkCompatibility.mockResolvedValue({
          compatible: true,
          version: '2.1.0',
          issues: [],
          summary: { errors: 0, warnings: 0 },
        });

        mockUpgradeHealthService.checkHealth.mockResolvedValue({
          healthy: true,
          version: '2.1.0',
          checks: [],
          summary: { passed: 7, warnings: 0, failures: 0 },
        });

        mockPrisma.upgradeAuditLog.create.mockResolvedValue({
          id: 'upg-123',
          fromVersion: '2.0.0',
          toVersion: '2.1.0',
          status: 'IN_PROGRESS',
          startedAt: new Date(),
          completedAt: null,
          initiatedBy: 'CLI',
          backupId: null,
          rollbackFromVersion: null,
          errorMessage: null,
          checksPassed: {},
          checksFailed: {},
          stepsCompleted: [],
          stepsFailed: [],
          durationMs: null,
          metadata: {},
        });

        mockPrisma.upgradeAuditLog.update.mockResolvedValue({
          id: 'upg-123',
          fromVersion: '2.0.0',
          toVersion: '2.1.0',
          status: 'COMPLETED',
          startedAt: new Date(),
          completedAt: new Date(),
          initiatedBy: 'CLI',
          backupId: null,
          rollbackFromVersion: null,
          errorMessage: null,
          checksPassed: {},
          checksFailed: {},
          stepsCompleted: [],
          stepsFailed: [],
          durationMs: null,
          metadata: {},
        });

        const result = await upgradeService.upgrade('2.1.0', { dryRun: true });

        expect(result.success).toBe(true);
        expect(result.toVersion).toBe('2.1.0');
        // In dry-run, backup should NOT be called
        expect(mockDatabaseBackupService.createBackup).not.toHaveBeenCalled();
        // Migration step should be skipped
        expect(execFileSync).not.toHaveBeenCalledWith(
          expect.stringContaining('prisma migrate deploy'),
          expect.any(Object),
        );
      });

      it('should record audit log entries in dry-run mode', async () => {
        mockPreUpgradeValidator.validate.mockResolvedValue({
          canProceed: true,
          checks: [],
          summary: { passed: 6, warnings: 0, failures: 0 },
        });

        mockConfigCompatibility.checkCompatibility.mockResolvedValue({
          compatible: true,
          version: '2.1.0',
          issues: [],
          summary: { errors: 0, warnings: 0 },
        });

        mockUpgradeHealthService.checkHealth.mockResolvedValue({
          healthy: true,
          version: '2.1.0',
          checks: [],
          summary: { passed: 7, warnings: 0, failures: 0 },
        });

        mockPrisma.upgradeAuditLog.create.mockResolvedValue({
          id: 'upg-123',
          fromVersion: '2.0.0',
          toVersion: '2.1.0',
          status: 'IN_PROGRESS',
          startedAt: new Date(),
          completedAt: null,
          initiatedBy: 'CLI',
          backupId: null,
          rollbackFromVersion: null,
          errorMessage: null,
          checksPassed: {},
          checksFailed: {},
          stepsCompleted: [],
          stepsFailed: [],
          durationMs: null,
          metadata: {},
        });

        mockPrisma.upgradeAuditLog.update.mockResolvedValue({
          id: 'upg-123',
          fromVersion: '2.0.0',
          toVersion: '2.1.0',
          status: 'COMPLETED',
          startedAt: new Date(),
          completedAt: new Date(),
          initiatedBy: 'CLI',
          backupId: null,
          rollbackFromVersion: null,
          errorMessage: null,
          checksPassed: {},
          checksFailed: {},
          stepsCompleted: [],
          stepsFailed: [],
          durationMs: null,
          metadata: {},
        });

        await upgradeService.upgrade('2.1.0', { dryRun: true });

        // Verify audit log was created
        expect(mockPrisma.upgradeAuditLog.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              toVersion: '2.1.0',
              status: 'IN_PROGRESS',
              dryRun: true,
            }),
          }),
        );
      });
    });

    describe('backup identity persistence', () => {
      // Regression guard for the defect that made automatic rollback
      // unreachable: backupId used to be recovered at COMPLETION by regexing
      // the stage's own log message. An upgrade that fails never reaches
      // completion, so the audit row still had backupId = null when
      // attemptRollback() looked it up — and RollbackService refuses with
      // "Upgrade does not have an associated backup for rollback".
      const arrangeSuccessfulBackup = () => {
        mockPreUpgradeValidator.validate.mockResolvedValue({
          canProceed: true,
          checks: [],
          summary: { passed: 8, warnings: 0, failures: 0 },
        });
        mockConfigCompatibility.checkCompatibility.mockResolvedValue({
          compatible: true,
          version: '2.1.0',
          issues: [],
          summary: { errors: 0, warnings: 0 },
        });
        mockDatabaseBackupService.createBackup.mockReturnValue({
          success: true,
          backupPath: '/backups/idenplane-backup-x.dump',
          backupSize: '12.5 MB',
          timestamp: new Date(),
        } as BackupResult);
        mockPrisma.upgradeAuditLog.create.mockResolvedValue({ id: 'upg-123' });
        mockPrisma.upgradeAuditLog.update.mockResolvedValue({ id: 'upg-123' });
      };

      it('persists the backup path on the audit row during the BACKUP stage', async () => {
        arrangeSuccessfulBackup();
        mockUpgradeHealthService.checkHealth.mockResolvedValue({
          healthy: true,
          version: '2.1.0',
          checks: [],
          summary: { passed: 7, warnings: 0, failures: 0 },
        });

        await upgradeService.upgrade('2.1.0');

        expect(mockPrisma.upgradeAuditLog.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              backupId: '/backups/idenplane-backup-x.dump',
              backupPath: '/backups/idenplane-backup-x.dump',
              backupSize: '12.5 MB',
            }),
          }),
        );
      });

      it('persists it even when a later stage fails — the rollback path depends on it', async () => {
        arrangeSuccessfulBackup();
        // Health check fails, so the upgrade never reaches completeUpgrade().
        mockUpgradeHealthService.checkHealth.mockResolvedValue({
          healthy: false,
          version: '2.1.0',
          checks: [
            {
              name: 'schema_integrity',
              status: 'fail',
              message: 'boom',
            },
          ],
          summary: { passed: 0, warnings: 0, failures: 1 },
        });
        mockRollbackService.executeRollback.mockResolvedValue({
          success: true,
          timestamp: new Date(),
        } as never);

        const result = await upgradeService.upgrade('2.1.0');

        expect(result.success).toBe(false);
        const wroteBackupId = mockPrisma.upgradeAuditLog.update.mock.calls.some(
          (call) =>
            (call[0] as { data?: { backupId?: string } })?.data?.backupId ===
            '/backups/idenplane-backup-x.dump',
        );
        expect(wroteBackupId).toBe(true);
      });
    });

    describe('pre-validation', () => {
      it('should fail upgrade if pre-validation fails', async () => {
        mockPreUpgradeValidator.validate.mockResolvedValue({
          canProceed: false,
          checks: [
            {
              name: 'disk_space',
              status: 'fail',
              message: 'Insufficient disk space',
            },
          ],
          summary: { passed: 5, warnings: 0, failures: 1 },
        });

        mockPrisma.upgradeAuditLog.create.mockResolvedValue({
          id: 'upg-123',
          fromVersion: '2.0.0',
          toVersion: '2.1.0',
          status: 'IN_PROGRESS',
          startedAt: new Date(),
          completedAt: null,
          initiatedBy: 'CLI',
          backupId: null,
          rollbackFromVersion: null,
          errorMessage: null,
          checksPassed: {},
          checksFailed: {},
          stepsCompleted: [],
          stepsFailed: [],
          durationMs: null,
          metadata: {},
        });

        mockPrisma.upgradeAuditLog.update.mockResolvedValue({
          id: 'upg-123',
          fromVersion: '2.0.0',
          toVersion: '2.1.0',
          status: 'FAILED',
          startedAt: new Date(),
          completedAt: new Date(),
          initiatedBy: 'CLI',
          backupId: null,
          rollbackFromVersion: null,
          errorMessage: 'Pre-upgrade validation failed',
          checksPassed: {},
          checksFailed: {},
          stepsCompleted: [],
          stepsFailed: [],
          durationMs: null,
          metadata: {},
        });

        const result = await upgradeService.upgrade('2.1.0');

        expect(result.success).toBe(false);
        expect(result.stages).toContainEqual(
          expect.objectContaining({
            stage: UpgradeStage.PRE_VALIDATION,
            success: false,
          }),
        );
        // Backup should not be called if pre-validation fails
        expect(mockDatabaseBackupService.createBackup).not.toHaveBeenCalled();
      });

      it('should proceed with warnings if pre-validation has warnings but no failures', async () => {
        mockPreUpgradeValidator.validate.mockResolvedValue({
          canProceed: true,
          checks: [
            { name: 'disk_space', status: 'warn', message: 'Low disk space' },
          ],
          summary: { passed: 5, warnings: 1, failures: 0 },
        });

        mockDatabaseBackupService.createBackup.mockReturnValue({
          success: true,
          backupPath: '/backups/backup.sql.gz',
          backupSize: '10 MB',
          duration: 1000,
          timestamp: new Date(),
        });

        mockConfigCompatibility.checkCompatibility.mockResolvedValue({
          compatible: true,
          version: '2.1.0',
          issues: [],
          summary: { errors: 0, warnings: 0 },
        });

        (execFileSync as jest.Mock).mockReturnValue('Database reset completed');

        mockUpgradeHealthService.checkHealth.mockResolvedValue({
          healthy: true,
          version: '2.1.0',
          checks: [],
          summary: { passed: 7, warnings: 0, failures: 0 },
        });

        mockPrisma.upgradeAuditLog.create.mockResolvedValue({
          id: 'upg-123',
          fromVersion: '2.0.0',
          toVersion: '2.1.0',
          status: 'IN_PROGRESS',
          startedAt: new Date(),
          completedAt: null,
          initiatedBy: 'CLI',
          backupId: null,
          rollbackFromVersion: null,
          errorMessage: null,
          checksPassed: {},
          checksFailed: {},
          stepsCompleted: [],
          stepsFailed: [],
          durationMs: null,
          metadata: {},
        });

        mockPrisma.upgradeAuditLog.update.mockResolvedValue({
          id: 'upg-123',
          fromVersion: '2.0.0',
          toVersion: '2.1.0',
          status: 'COMPLETED',
          startedAt: new Date(),
          completedAt: new Date(),
          initiatedBy: 'CLI',
          backupId: null,
          rollbackFromVersion: null,
          errorMessage: null,
          checksPassed: {},
          checksFailed: {},
          stepsCompleted: [],
          stepsFailed: [],
          durationMs: null,
          metadata: {},
        });

        const result = await upgradeService.upgrade('2.1.0');

        expect(result.success).toBe(true);
        expect(mockDatabaseBackupService.createBackup).toHaveBeenCalled();
      });
    });

    describe('backup creation', () => {
      it('should create backup before migration', async () => {
        mockPreUpgradeValidator.validate.mockResolvedValue({
          canProceed: true,
          checks: [],
          summary: { passed: 6, warnings: 0, failures: 0 },
        });

        mockDatabaseBackupService.createBackup.mockReturnValue({
          success: true,
          backupPath: '/backups/pre-upgrade-2.1.0.sql.gz',
          backupSize: '50 MB',
          duration: 5000,
          timestamp: new Date(),
        });

        mockConfigCompatibility.checkCompatibility.mockResolvedValue({
          compatible: true,
          version: '2.1.0',
          issues: [],
          summary: { errors: 0, warnings: 0 },
        });

        (execFileSync as jest.Mock).mockReturnValue('Migration applied');

        mockUpgradeHealthService.checkHealth.mockResolvedValue({
          healthy: true,
          version: '2.1.0',
          checks: [],
          summary: { passed: 7, warnings: 0, failures: 0 },
        });

        mockPrisma.upgradeAuditLog.create.mockResolvedValue({
          id: 'upg-123',
          fromVersion: '2.0.0',
          toVersion: '2.1.0',
          status: 'IN_PROGRESS',
          startedAt: new Date(),
          completedAt: null,
          initiatedBy: 'CLI',
          backupId: null,
          rollbackFromVersion: null,
          errorMessage: null,
          checksPassed: {},
          checksFailed: {},
          stepsCompleted: [],
          stepsFailed: [],
          durationMs: null,
          metadata: {},
        });

        mockPrisma.upgradeAuditLog.update.mockResolvedValue({
          id: 'upg-123',
          fromVersion: '2.0.0',
          toVersion: '2.1.0',
          status: 'COMPLETED',
          startedAt: new Date(),
          completedAt: new Date(),
          initiatedBy: 'CLI',
          backupId: null,
          rollbackFromVersion: null,
          errorMessage: null,
          checksPassed: {},
          checksFailed: {},
          stepsCompleted: [],
          stepsFailed: [],
          durationMs: null,
          metadata: {},
        });

        await upgradeService.upgrade('2.1.0');

        // Verify backup was created with correct label
        expect(mockDatabaseBackupService.createBackup).toHaveBeenCalledWith(
          'pre-upgrade-2.1.0',
        );
      });

      it('should abort upgrade if backup creation fails', async () => {
        mockPreUpgradeValidator.validate.mockResolvedValue({
          canProceed: true,
          checks: [],
          summary: { passed: 6, warnings: 0, failures: 0 },
        });

        mockDatabaseBackupService.createBackup.mockReturnValue({
          success: false,
          error: 'pg_dump not found',
          timestamp: new Date(),
        });

        mockConfigCompatibility.checkCompatibility.mockResolvedValue({
          compatible: true,
          version: '2.1.0',
          issues: [],
          summary: { errors: 0, warnings: 0 },
        });

        mockPrisma.upgradeAuditLog.create.mockResolvedValue({
          id: 'upg-123',
          fromVersion: '2.0.0',
          toVersion: '2.1.0',
          status: 'IN_PROGRESS',
          startedAt: new Date(),
          completedAt: null,
          initiatedBy: 'CLI',
          backupId: null,
          rollbackFromVersion: null,
          errorMessage: null,
          checksPassed: {},
          checksFailed: {},
          stepsCompleted: [],
          stepsFailed: [],
          durationMs: null,
          metadata: {},
        });

        mockPrisma.upgradeAuditLog.update.mockResolvedValue({
          id: 'upg-123',
          fromVersion: '2.0.0',
          toVersion: '2.1.0',
          status: 'FAILED',
          startedAt: new Date(),
          completedAt: new Date(),
          initiatedBy: 'CLI',
          backupId: null,
          rollbackFromVersion: null,
          errorMessage: 'Backup failed',
          checksPassed: {},
          checksFailed: {},
          stepsCompleted: [],
          stepsFailed: [],
          durationMs: null,
          metadata: {},
        });

        const result = await upgradeService.upgrade('2.1.0');

        expect(result.success).toBe(false);
        expect(result.stages).toContainEqual(
          expect.objectContaining({
            stage: UpgradeStage.BACKUP,
            success: false,
          }),
        );
        // Migration should not be attempted
        expect(execFileSync).not.toHaveBeenCalledWith(
          expect.stringContaining('prisma migrate deploy'),
          expect.any(Object),
        );
      });
    });

    describe('rollback on failure', () => {
      it('should trigger rollback when migration fails', async () => {
        mockPreUpgradeValidator.validate.mockResolvedValue({
          canProceed: true,
          checks: [],
          summary: { passed: 6, warnings: 0, failures: 0 },
        });

        mockDatabaseBackupService.createBackup.mockReturnValue({
          success: true,
          backupPath: '/backups/backup.sql.gz',
          backupSize: '50 MB',
          duration: 5000,
          timestamp: new Date(),
        });

        mockConfigCompatibility.checkCompatibility.mockResolvedValue({
          compatible: true,
          version: '2.1.0',
          issues: [],
          summary: { errors: 0, warnings: 0 },
        });

        // Simulate migration failure
        (execSync as jest.Mock).mockImplementation(() => {
          throw new Error('Migration failed');
        });

        mockRollbackService.executeRollback.mockResolvedValue({
          success: true,
          rollbackVersion: '2.0.0',
          previousVersion: '2.1.0',
          backupRestored: true,
          backupPath: '/backups/backup.sql.gz',
          duration: 3000,
          timestamp: new Date(),
        });

        mockPrisma.upgradeAuditLog.create.mockResolvedValue({
          id: 'upg-123',
          fromVersion: '2.0.0',
          toVersion: '2.1.0',
          status: 'IN_PROGRESS',
          startedAt: new Date(),
          completedAt: null,
          initiatedBy: 'CLI',
          backupId: '/backups/backup.sql.gz',
          rollbackFromVersion: null,
          errorMessage: null,
          checksPassed: {},
          checksFailed: {},
          stepsCompleted: [],
          stepsFailed: [],
          durationMs: null,
          metadata: {},
        });

        mockPrisma.upgradeAuditLog.update.mockResolvedValue({
          id: 'upg-123',
          fromVersion: '2.0.0',
          toVersion: '2.1.0',
          status: 'FAILED',
          startedAt: new Date(),
          completedAt: new Date(),
          initiatedBy: 'CLI',
          backupId: '/backups/backup.sql.gz',
          rollbackFromVersion: null,
          errorMessage: 'Database migration failed',
          checksPassed: {},
          checksFailed: {},
          stepsCompleted: [],
          stepsFailed: [],
          durationMs: null,
          metadata: {},
        });

        const result = await upgradeService.upgrade('2.1.0');

        expect(result.success).toBe(false);
        expect(result.rollbackTriggered).toBe(true);
        expect(mockRollbackService.executeRollback).toHaveBeenCalled();
      });

      it('should trigger rollback when health check fails after migration', async () => {
        mockPreUpgradeValidator.validate.mockResolvedValue({
          canProceed: true,
          checks: [],
          summary: { passed: 6, warnings: 0, failures: 0 },
        });

        mockDatabaseBackupService.createBackup.mockReturnValue({
          success: true,
          backupPath: '/backups/backup.sql.gz',
          backupSize: '50 MB',
          duration: 5000,
          timestamp: new Date(),
        });

        mockConfigCompatibility.checkCompatibility.mockResolvedValue({
          compatible: true,
          version: '2.1.0',
          issues: [],
          summary: { errors: 0, warnings: 0 },
        });

        (execFileSync as jest.Mock).mockReturnValue('Migration applied');

        // Health check fails
        mockUpgradeHealthService.checkHealth.mockResolvedValue({
          healthy: false,
          version: '2.1.0',
          checks: [
            {
              name: 'database_connection',
              status: 'fail',
              message: 'Cannot connect',
            },
          ],
          summary: { passed: 6, warnings: 0, failures: 1 },
        });

        mockRollbackService.executeRollback.mockResolvedValue({
          success: true,
          rollbackVersion: '2.0.0',
          previousVersion: '2.1.0',
          backupRestored: true,
          backupPath: '/backups/backup.sql.gz',
          duration: 3000,
          timestamp: new Date(),
        });

        mockPrisma.upgradeAuditLog.create.mockResolvedValue({
          id: 'upg-123',
          fromVersion: '2.0.0',
          toVersion: '2.1.0',
          status: 'IN_PROGRESS',
          startedAt: new Date(),
          completedAt: null,
          initiatedBy: 'CLI',
          backupId: '/backups/backup.sql.gz',
          rollbackFromVersion: null,
          errorMessage: null,
          checksPassed: {},
          checksFailed: {},
          stepsCompleted: [],
          stepsFailed: [],
          durationMs: null,
          metadata: {},
        });

        mockPrisma.upgradeAuditLog.update.mockResolvedValue({
          id: 'upg-123',
          fromVersion: '2.0.0',
          toVersion: '2.1.0',
          status: 'FAILED',
          startedAt: new Date(),
          completedAt: new Date(),
          initiatedBy: 'CLI',
          backupId: '/backups/backup.sql.gz',
          rollbackFromVersion: null,
          errorMessage: 'Post-upgrade health check failed',
          checksPassed: {},
          checksFailed: {},
          stepsCompleted: [],
          stepsFailed: [],
          durationMs: null,
          metadata: {},
        });

        const result = await upgradeService.upgrade('2.1.0');

        expect(result.success).toBe(false);
        expect(result.rollbackTriggered).toBe(true);
        expect(mockRollbackService.executeRollback).toHaveBeenCalled();
      });

      it('should not attempt rollback if no backup exists', async () => {
        mockPreUpgradeValidator.validate.mockResolvedValue({
          canProceed: true,
          checks: [],
          summary: { passed: 6, warnings: 0, failures: 0 },
        });

        mockDatabaseBackupService.createBackup.mockReturnValue({
          success: false,
          error: 'Backup failed',
          timestamp: new Date(),
        });

        mockConfigCompatibility.checkCompatibility.mockResolvedValue({
          compatible: true,
          version: '2.1.0',
          issues: [],
          summary: { errors: 0, warnings: 0 },
        });

        mockPrisma.upgradeAuditLog.create.mockResolvedValue({
          id: 'upg-123',
          fromVersion: '2.0.0',
          toVersion: '2.1.0',
          status: 'IN_PROGRESS',
          startedAt: new Date(),
          completedAt: null,
          initiatedBy: 'CLI',
          backupId: null,
          rollbackFromVersion: null,
          errorMessage: null,
          checksPassed: {},
          checksFailed: {},
          stepsCompleted: [],
          stepsFailed: [],
          durationMs: null,
          metadata: {},
        });

        mockPrisma.upgradeAuditLog.update.mockResolvedValue({
          id: 'upg-123',
          fromVersion: '2.0.0',
          toVersion: '2.1.0',
          status: 'FAILED',
          startedAt: new Date(),
          completedAt: new Date(),
          initiatedBy: 'CLI',
          backupId: null,
          rollbackFromVersion: null,
          errorMessage: 'Backup failed',
          checksPassed: {},
          checksFailed: {},
          stepsCompleted: [],
          stepsFailed: [],
          durationMs: null,
          metadata: {},
        });

        const result = await upgradeService.upgrade('2.1.0');

        expect(result.success).toBe(false);
        expect(result.rollbackTriggered).toBe(false);
        expect(mockRollbackService.executeRollback).not.toHaveBeenCalled();
      });
    });

    describe('getCurrentVersion', () => {
      // These used to assert against a mocked execSync return value, which is
      // why the broken shell quoting in the old implementation went unnoticed:
      // in production it threw every time and the catch returned 'unknown'.
      // getCurrentVersion now returns APP_VERSION, read from package.json at
      // module load, so assert against that real value.
      it('should return the real application version', () => {
        const pkg = JSON.parse(
          readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'),
        ) as { version: string };

        expect(upgradeService.getCurrentVersion()).toBe(pkg.version);
      });

      it('should never return the placeholder the old implementation returned', () => {
        expect(upgradeService.getCurrentVersion()).not.toBe('unknown');
      });

      it('should not shell out', () => {
        (execSync as jest.Mock).mockClear();

        upgradeService.getCurrentVersion();

        expect(execSync).not.toHaveBeenCalled();
      });
    });

    describe('getUpgradeState', () => {
      it('should return upgrade state for existing upgrade', async () => {
        mockPrisma.upgradeAuditLog.findUnique.mockResolvedValue({
          id: 'upg-123',
          fromVersion: '2.0.0',
          toVersion: '2.1.0',
          status: 'IN_PROGRESS',
          startedAt: new Date(),
          completedAt: null,
          initiatedBy: 'CLI',
          backupId: null,
          rollbackFromVersion: null,
          errorMessage: null,
          checksPassed: {},
          checksFailed: {},
          stepsCompleted: [],
          stepsFailed: [],
          durationMs: null,
          metadata: {},
        });

        const state = await upgradeService.getUpgradeState('upg-123');

        expect(state).not.toBeNull();
        expect(state?.upgradeId).toBe('upg-123');
        expect(state?.fromVersion).toBe('2.0.0');
        expect(state?.toVersion).toBe('2.1.0');
      });

      it('should return null for non-existent upgrade', async () => {
        mockPrisma.upgradeAuditLog.findUnique.mockResolvedValue(null);

        const state = await upgradeService.getUpgradeState('non-existent');

        expect(state).toBeNull();
      });
    });

    describe('getLatestUpgradeStatus', () => {
      it('should return most recent upgrade entry', async () => {
        const now = new Date();
        mockPrisma.upgradeAuditLog.findFirst.mockResolvedValue({
          id: 'upg-123',
          fromVersion: '2.0.0',
          toVersion: '2.1.0',
          status: 'COMPLETED',
          startedAt: now,
          completedAt: now,
          initiatedBy: 'CLI',
          backupId: null,
          rollbackFromVersion: null,
          errorMessage: null,
          checksPassed: {},
          checksFailed: {},
          stepsCompleted: [],
          stepsFailed: [],
          durationMs: null,
          metadata: {},
        });

        const status = await upgradeService.getLatestUpgradeStatus();

        expect(status).not.toBeNull();
        expect(status?.id).toBe('upg-123');
        expect(status?.status).toBe('COMPLETED');
      });

      it('should return null when no upgrades exist', async () => {
        mockPrisma.upgradeAuditLog.findFirst.mockResolvedValue(null);

        const status = await upgradeService.getLatestUpgradeStatus();

        expect(status).toBeNull();
      });
    });
  });
});
