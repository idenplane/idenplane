// Mock Prisma client
const mockPrisma = {
  $disconnect: jest.fn(),
  upgradeAuditLog: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => mockPrisma),
}));

import {
  RollbackService,
  RollbackResult,
  RollbackCapability,
} from './rollback.service.js';
import { DatabaseBackupService } from './database-backup.service.js';

describe('RollbackService', () => {
  let rollbackService: RollbackService;
  let mockDatabaseBackupService: jest.Mocked<DatabaseBackupService>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockDatabaseBackupService = {
      listBackups: jest.fn(),
      verifyBackup: jest.fn(),
      restoreBackup: jest.fn(),
      createBackup: jest.fn(),
    } as unknown as jest.Mocked<DatabaseBackupService>;

    rollbackService = new RollbackService(mockDatabaseBackupService);
  });

  afterEach(async () => {
    await rollbackService.onModuleDestroy();
  });

  describe('checkRollbackCapability', () => {
    it('should return canRollback=true when successful upgrade with backup exists', async () => {
      const now = new Date();
      mockPrisma.upgradeAuditLog.findFirst.mockResolvedValue({
        id: 'upg-123',
        fromVersion: '2.0.0',
        toVersion: '2.1.0',
        status: 'COMPLETED',
        startedAt: now,
        completedAt: now,
        initiatedBy: 'CLI',
        backupId: 'backup-456',
        rollbackFromVersion: null,
        errorMessage: null,
        checksPassed: {},
        checksFailed: {},
        stepsCompleted: [],
        stepsFailed: [],
        durationMs: null,
        metadata: {},
      });

      const capability = await rollbackService.checkRollbackCapability();

      expect(capability.canRollback).toBe(true);
      expect(capability.lastSuccessfulUpgrade).toEqual({
        id: 'upg-123',
        fromVersion: '2.0.0',
        toVersion: '2.1.0',
        backupId: 'backup-456',
        completedAt: now,
      });
    });

    it('should return canRollback=false when no successful upgrade found', async () => {
      mockPrisma.upgradeAuditLog.findFirst.mockResolvedValue(null);

      const capability = await rollbackService.checkRollbackCapability();

      expect(capability.canRollback).toBe(false);
      expect(capability.reason).toBe(
        'No successful upgrade with a backup found',
      );
    });

    it('should return canRollback=false when upgrade has no backup', async () => {
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

      const capability = await rollbackService.checkRollbackCapability();

      expect(capability.canRollback).toBe(false);
      expect(capability.reason).toBe(
        'No successful upgrade with a backup found',
      );
    });

    it('should handle database errors gracefully', async () => {
      mockPrisma.upgradeAuditLog.findFirst.mockRejectedValue(
        new Error('Connection failed'),
      );

      const capability = await rollbackService.checkRollbackCapability();

      expect(capability.canRollback).toBe(false);
      expect(capability.reason).toContain('Database error');
    });
  });

  describe('executeRollback', () => {
    it('should successfully execute rollback when backup exists', async () => {
      const now = new Date();

      // Mock the upgrade lookup
      mockPrisma.upgradeAuditLog.findUnique.mockResolvedValue({
        id: 'upg-123',
        fromVersion: '2.0.0',
        toVersion: '2.1.0',
        status: 'COMPLETED',
        startedAt: now,
        completedAt: now,
        initiatedBy: 'CLI',
        backupId: 'backup-456',
        rollbackFromVersion: null,
        errorMessage: null,
        checksPassed: {},
        checksFailed: {},
        stepsCompleted: [],
        stepsFailed: [],
        durationMs: null,
        metadata: {},
      });

      // Mock backup listing
      mockDatabaseBackupService.listBackups.mockReturnValue([
        {
          path: '/backups/authme-backup-456.sql.gz',
          filename: 'authme-backup-456.sql.gz',
          size: '50 MB',
          created: now,
          age: 1,
        },
      ]);

      // Mock backup verification
      mockDatabaseBackupService.verifyBackup.mockReturnValue(true);

      // Mock backup restore
      mockDatabaseBackupService.restoreBackup.mockResolvedValue({
        success: true,
        backupPath: '/backups/authme-backup-456.sql.gz',
        duration: 5000,
        timestamp: new Date(),
      });

      // Mock the rollback audit log entry creation
      mockPrisma.upgradeAuditLog.create.mockResolvedValue({
        id: 'upg-rollback-789',
        fromVersion: '2.1.0',
        toVersion: '2.0.0',
        status: 'ROLLBACK_COMPLETED',
        startedAt: now,
        completedAt: new Date(),
        initiatedBy: 'ROLLBACK_SERVICE',
        backupId: '/backups/authme-backup-456.sql.gz',
        rollbackFromVersion: '2.1.0',
        errorMessage: null,
        checksPassed: {},
        checksFailed: {},
        stepsCompleted: [],
        stepsFailed: [],
        durationMs: null,
        metadata: {},
      });

      const result = await rollbackService.executeRollback('upg-123');

      expect(result.success).toBe(true);
      expect(result.rollbackVersion).toBe('2.0.0');
      expect(result.previousVersion).toBe('2.1.0');
      expect(result.backupRestored).toBe(true);
    });

    it('should return error when no upgrade found', async () => {
      mockPrisma.upgradeAuditLog.findUnique.mockResolvedValue(null);

      const result = await rollbackService.executeRollback('non-existent');

      expect(result.success).toBe(false);
      expect(result.error).toBe('No upgrade found to roll back');
    });

    it('should return error when upgrade has no backup ID', async () => {
      const now = new Date();
      mockPrisma.upgradeAuditLog.findUnique.mockResolvedValue({
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

      const result = await rollbackService.executeRollback('upg-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        'Upgrade does not have an associated backup for rollback',
      );
    });

    it('should return error when backup file not found', async () => {
      const now = new Date();
      mockPrisma.upgradeAuditLog.findUnique.mockResolvedValue({
        id: 'upg-123',
        fromVersion: '2.0.0',
        toVersion: '2.1.0',
        status: 'COMPLETED',
        startedAt: now,
        completedAt: now,
        initiatedBy: 'CLI',
        backupId: 'backup-456',
        rollbackFromVersion: null,
        errorMessage: null,
        checksPassed: {},
        checksFailed: {},
        stepsCompleted: [],
        stepsFailed: [],
        durationMs: null,
        metadata: {},
      });

      mockDatabaseBackupService.listBackups.mockReturnValue([]);

      const result = await rollbackService.executeRollback('upg-123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Backup file not found');
    });

    it('should return error when backup file is invalid', async () => {
      const now = new Date();
      mockPrisma.upgradeAuditLog.findUnique.mockResolvedValue({
        id: 'upg-123',
        fromVersion: '2.0.0',
        toVersion: '2.1.0',
        status: 'COMPLETED',
        startedAt: now,
        completedAt: now,
        initiatedBy: 'CLI',
        backupId: 'backup-456',
        rollbackFromVersion: null,
        errorMessage: null,
        checksPassed: {},
        checksFailed: {},
        stepsCompleted: [],
        stepsFailed: [],
        durationMs: null,
        metadata: {},
      });

      mockDatabaseBackupService.listBackups.mockReturnValue([
        {
          path: '/backups/authme-backup-456.sql.gz',
          filename: 'authme-backup-456.sql.gz',
          size: '50 MB',
          created: now,
          age: 1,
        },
      ]);

      mockDatabaseBackupService.verifyBackup.mockReturnValue(false);

      const result = await rollbackService.executeRollback('upg-123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Backup file is invalid or corrupted');
    });

    it('should return error when restore fails', async () => {
      const now = new Date();
      mockPrisma.upgradeAuditLog.findUnique.mockResolvedValue({
        id: 'upg-123',
        fromVersion: '2.0.0',
        toVersion: '2.1.0',
        status: 'COMPLETED',
        startedAt: now,
        completedAt: now,
        initiatedBy: 'CLI',
        backupId: 'backup-456',
        rollbackFromVersion: null,
        errorMessage: null,
        checksPassed: {},
        checksFailed: {},
        stepsCompleted: [],
        stepsFailed: [],
        durationMs: null,
        metadata: {},
      });

      mockDatabaseBackupService.listBackups.mockReturnValue([
        {
          path: '/backups/authme-backup-456.sql.gz',
          filename: 'authme-backup-456.sql.gz',
          size: '50 MB',
          created: now,
          age: 1,
        },
      ]);

      mockDatabaseBackupService.verifyBackup.mockReturnValue(true);
      mockDatabaseBackupService.restoreBackup.mockResolvedValue({
        success: false,
        error: 'pg_restore failed',
        timestamp: new Date(),
      });

      // Mock rollback failure audit entry
      mockPrisma.upgradeAuditLog.create.mockResolvedValue({
        id: 'upg-rollback-fail',
        fromVersion: '2.1.0',
        toVersion: '2.0.0',
        status: 'ROLLBACK_FAILED',
        startedAt: now,
        completedAt: new Date(),
        initiatedBy: 'ROLLBACK_SERVICE',
        backupId: null,
        rollbackFromVersion: '2.1.0',
        errorMessage: 'pg_restore failed',
        checksPassed: {},
        checksFailed: {},
        stepsCompleted: [],
        stepsFailed: [],
        durationMs: null,
        metadata: {},
      });

      const result = await rollbackService.executeRollback('upg-123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('pg_restore failed');
    });

    it('should use most recent upgrade when upgradeId not provided', async () => {
      const now = new Date();

      // Mock findFirst for most recent upgrade
      mockPrisma.upgradeAuditLog.findFirst.mockResolvedValue({
        id: 'upg-123',
        fromVersion: '2.0.0',
        toVersion: '2.1.0',
        status: 'COMPLETED',
        startedAt: now,
        completedAt: now,
        initiatedBy: 'CLI',
        backupId: 'backup-456',
        rollbackFromVersion: null,
        errorMessage: null,
        checksPassed: {},
        checksFailed: {},
        stepsCompleted: [],
        stepsFailed: [],
        durationMs: null,
        metadata: {},
      });

      mockDatabaseBackupService.listBackups.mockReturnValue([
        {
          path: '/backups/authme-backup-456.sql.gz',
          filename: 'authme-backup-456.sql.gz',
          size: '50 MB',
          created: now,
          age: 1,
        },
      ]);

      mockDatabaseBackupService.verifyBackup.mockReturnValue(true);
      mockDatabaseBackupService.restoreBackup.mockResolvedValue({
        success: true,
        backupPath: '/backups/authme-backup-456.sql.gz',
        duration: 5000,
        timestamp: new Date(),
      });

      mockPrisma.upgradeAuditLog.create.mockResolvedValue({
        id: 'upg-rollback-789',
        fromVersion: '2.1.0',
        toVersion: '2.0.0',
        status: 'ROLLBACK_COMPLETED',
        startedAt: now,
        completedAt: new Date(),
        initiatedBy: 'ROLLBACK_SERVICE',
        backupId: '/backups/authme-backup-456.sql.gz',
        rollbackFromVersion: '2.1.0',
        errorMessage: null,
        checksPassed: {},
        checksFailed: {},
        stepsCompleted: [],
        stepsFailed: [],
        durationMs: null,
        metadata: {},
      });

      const result = await rollbackService.executeRollback();

      expect(result.success).toBe(true);
      expect(mockPrisma.upgradeAuditLog.findFirst).toHaveBeenCalled();
    });
  });

  describe('getUpgradeHistory', () => {
    it('should return upgrade history with limit', async () => {
      const now = new Date();
      mockPrisma.upgradeAuditLog.findMany.mockResolvedValue([
        {
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
        },
        {
          id: 'upg-456',
          fromVersion: '1.9.0',
          toVersion: '2.0.0',
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
        },
      ]);

      const history = await rollbackService.getUpgradeHistory(10);

      expect(history).toHaveLength(2);
      expect(history[0].id).toBe('upg-123');
      expect(history[1].id).toBe('upg-456');
      expect(mockPrisma.upgradeAuditLog.findMany).toHaveBeenCalledWith({
        orderBy: { startedAt: 'desc' },
        take: 10,
      });
    });

    it('should return empty array on database error', async () => {
      mockPrisma.upgradeAuditLog.findMany.mockRejectedValue(
        new Error('Database error'),
      );

      const history = await rollbackService.getUpgradeHistory();

      expect(history).toEqual([]);
    });
  });

  describe('getLatestUpgradeStatus', () => {
    it('should return most recent upgrade', async () => {
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

      const status = await rollbackService.getLatestUpgradeStatus();

      expect(status).not.toBeNull();
      expect(status?.id).toBe('upg-123');
    });

    it('should return null when no upgrades exist', async () => {
      mockPrisma.upgradeAuditLog.findFirst.mockResolvedValue(null);

      const status = await rollbackService.getLatestUpgradeStatus();

      expect(status).toBeNull();
    });
  });
});
