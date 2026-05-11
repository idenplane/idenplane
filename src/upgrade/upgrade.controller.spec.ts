import { UpgradeController } from './upgrade.controller.js';
import { UpgradeService, UpgradeResult, UpgradeState } from './upgrade.service.js';
import { RollbackService, RollbackCapability, RollbackResult, UpgradeAuditEntry } from './rollback.service.js';
import { PreUpgradeValidatorService, PreUpgradeValidationResult } from './pre-upgrade-validator.service.js';
import { ConfigCompatibilityService, ConfigCompatibilityResult } from './config-compatibility.service.js';
import { UpgradeHealthService, UpgradeHealthResult } from './upgrade-health.service.js';

describe('UpgradeController', () => {
  let controller: UpgradeController;
  let mockUpgradeService: jest.Mocked<UpgradeService>;
  let mockRollbackService: jest.Mocked<RollbackService>;
  let mockPreUpgradeValidator: jest.Mocked<PreUpgradeValidatorService>;
  let mockConfigCompatibility: jest.Mocked<ConfigCompatibilityService>;
  let mockUpgradeHealthService: jest.Mocked<UpgradeHealthService>;

  beforeEach(() => {
    mockUpgradeService = {
      upgrade: jest.fn(),
      getUpgradeState: jest.fn(),
      getLatestUpgradeStatus: jest.fn(),
      getCurrentVersion: jest.fn(),
    } as unknown as jest.Mocked<UpgradeService>;

    mockRollbackService = {
      checkRollbackCapability: jest.fn(),
      executeRollback: jest.fn(),
      getUpgradeHistory: jest.fn(),
      getLatestUpgradeStatus: jest.fn(),
    } as unknown as jest.Mocked<RollbackService>;

    mockPreUpgradeValidator = {
      validate: jest.fn(),
    } as unknown as jest.Mocked<PreUpgradeValidatorService>;

    mockConfigCompatibility = {
      checkCompatibility: jest.fn(),
    } as unknown as jest.Mocked<ConfigCompatibilityService>;

    mockUpgradeHealthService = {
      checkHealth: jest.fn(),
    } as unknown as jest.Mocked<UpgradeHealthService>;

    controller = new UpgradeController(
      mockUpgradeService,
      mockRollbackService,
      mockPreUpgradeValidator,
      mockConfigCompatibility,
      mockUpgradeHealthService,
    );
  });

  describe('startUpgrade', () => {
    it('should call upgradeService.upgrade with correct parameters', async () => {
      const mockResult: UpgradeResult = {
        success: true,
        upgradeId: 'upg-123',
        toVersion: '2.1.0',
        stages: [],
        rollbackTriggered: false,
        duration: 5000,
      };

      mockUpgradeService.upgrade.mockResolvedValue(mockResult);

      const result = await controller.startUpgrade({
        toVersion: '2.1.0',
        dryRun: true,
        force: false,
        initiatedBy: 'Test',
      });

      expect(mockUpgradeService.upgrade).toHaveBeenCalledWith('2.1.0', {
        dryRun: true,
        force: false,
        initiatedBy: 'Test',
      });
      expect(result).toEqual(mockResult);
    });

    it('should use defaults when optional parameters not provided', async () => {
      const mockResult: UpgradeResult = {
        success: true,
        toVersion: '2.1.0',
        stages: [],
        rollbackTriggered: false,
        duration: 5000,
      };

      mockUpgradeService.upgrade.mockResolvedValue(mockResult);

      const result = await controller.startUpgrade({ toVersion: '2.1.0' });

      expect(mockUpgradeService.upgrade).toHaveBeenCalledWith('2.1.0', {
        dryRun: false,
        force: false,
        initiatedBy: 'API',
      });
      expect(result).toEqual(mockResult);
    });
  });

  describe('getUpgradeStatus', () => {
    it('should return latest upgrade status from rollbackService', async () => {
      const mockEntry: UpgradeAuditEntry = {
        id: 'upg-123',
        fromVersion: '2.0.0',
        toVersion: '2.1.0',
        status: 'COMPLETED',
        startedAt: new Date(),
        completedAt: new Date(),
        backupId: null,
        errorMessage: null,
        checksPassed: null,
      };

      mockRollbackService.getLatestUpgradeStatus.mockResolvedValue(mockEntry);

      const result = await controller.getUpgradeStatus();

      expect(mockRollbackService.getLatestUpgradeStatus).toHaveBeenCalled();
      expect(result).toEqual(mockEntry);
    });

    it('should return null when no upgrade status exists', async () => {
      mockRollbackService.getLatestUpgradeStatus.mockResolvedValue(null);

      const result = await controller.getUpgradeStatus();

      expect(result).toBeNull();
    });
  });

  describe('getUpgradeHistory', () => {
    it('should return upgrade history from rollbackService', async () => {
      const mockHistory: UpgradeAuditEntry[] = [
        {
          id: 'upg-123',
          fromVersion: '2.0.0',
          toVersion: '2.1.0',
          status: 'COMPLETED',
          startedAt: new Date(),
          completedAt: new Date(),
          backupId: null,
          errorMessage: null,
          checksPassed: null,
        },
      ];

      mockRollbackService.getUpgradeHistory.mockResolvedValue(mockHistory);

      const result = await controller.getUpgradeHistory();

      expect(mockRollbackService.getUpgradeHistory).toHaveBeenCalled();
      expect(result).toEqual(mockHistory);
    });
  });

  describe('getUpgradeState', () => {
    it('should return upgrade state for specific upgrade ID', async () => {
      const mockState: UpgradeState = {
        upgradeId: 'upg-123',
        stage: 'PRE_VALIDATION',
        fromVersion: '2.0.0',
        toVersion: '2.1.0',
        startedAt: new Date(),
        stages: [],
      };

      mockUpgradeService.getUpgradeState.mockResolvedValue(mockState);

      const result = await controller.getUpgradeState('upg-123');

      expect(mockUpgradeService.getUpgradeState).toHaveBeenCalledWith('upg-123');
      expect(result).toEqual(mockState);
    });

    it('should return null when upgrade not found', async () => {
      mockUpgradeService.getUpgradeState.mockResolvedValue(null);

      const result = await controller.getUpgradeState('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('checkRollbackCapability', () => {
    it('should return rollback capability from rollbackService', async () => {
      const mockCapability: RollbackCapability = {
        canRollback: true,
        lastSuccessfulUpgrade: {
          id: 'upg-123',
          fromVersion: '2.0.0',
          toVersion: '2.1.0',
          backupId: 'backup-456',
          completedAt: new Date(),
        },
      };

      mockRollbackService.checkRollbackCapability.mockResolvedValue(mockCapability);

      const result = await controller.checkRollbackCapability();

      expect(mockRollbackService.checkRollbackCapability).toHaveBeenCalled();
      expect(result).toEqual(mockCapability);
    });

    it('should return cannot rollback when no backup available', async () => {
      const mockCapability: RollbackCapability = {
        canRollback: false,
        reason: 'No successful upgrade with a backup found',
      };

      mockRollbackService.checkRollbackCapability.mockResolvedValue(mockCapability);

      const result = await controller.checkRollbackCapability();

      expect(result.canRollback).toBe(false);
      expect(result.reason).toBe('No successful upgrade with a backup found');
    });
  });

  describe('executeRollback', () => {
    it('should execute rollback for specific upgrade', async () => {
      const mockResult: RollbackResult = {
        success: true,
        rollbackVersion: '2.0.0',
        previousVersion: '2.1.0',
        backupRestored: true,
        duration: 5000,
        timestamp: new Date(),
      };

      mockRollbackService.executeRollback.mockResolvedValue(mockResult);

      const result = await controller.executeRollback({ upgradeId: 'upg-123' });

      expect(mockRollbackService.executeRollback).toHaveBeenCalledWith('upg-123');
      expect(result).toEqual(mockResult);
    });

    it('should execute rollback without upgradeId (uses most recent)', async () => {
      const mockResult: RollbackResult = {
        success: true,
        rollbackVersion: '2.0.0',
        previousVersion: '2.1.0',
        backupRestored: true,
        duration: 5000,
        timestamp: new Date(),
      };

      mockRollbackService.executeRollback.mockResolvedValue(mockResult);

      const result = await controller.executeRollback({});

      expect(mockRollbackService.executeRollback).toHaveBeenCalledWith(undefined);
      expect(result).toEqual(mockResult);
    });

    it('should return error result when rollback fails', async () => {
      const mockResult: RollbackResult = {
        success: false,
        error: 'Backup file not found',
        timestamp: new Date(),
      };

      mockRollbackService.executeRollback.mockResolvedValue(mockResult);

      const result = await controller.executeRollback({ upgradeId: 'upg-123' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Backup file not found');
    });
  });

  describe('runPreValidation', () => {
    it('should run pre-upgrade validation checks', async () => {
      const mockResult: PreUpgradeValidationResult = {
        canProceed: true,
        checks: [
          { name: 'database_connection', status: 'pass', message: 'Database connection is healthy' },
          { name: 'disk_space', status: 'pass', message: 'Sufficient disk space' },
        ],
        summary: { passed: 6, warnings: 0, failures: 0 },
      };

      mockPreUpgradeValidator.validate.mockResolvedValue(mockResult);

      const result = await controller.runPreValidation();

      expect(mockPreUpgradeValidator.validate).toHaveBeenCalled();
      expect(result).toEqual(mockResult);
      expect(result.canProceed).toBe(true);
    });

    it('should return canProceed=false when validation fails', async () => {
      const mockResult: PreUpgradeValidationResult = {
        canProceed: false,
        checks: [
          { name: 'database_connection', status: 'fail', message: 'Cannot connect to database' },
        ],
        summary: { passed: 5, warnings: 0, failures: 1 },
      };

      mockPreUpgradeValidator.validate.mockResolvedValue(mockResult);

      const result = await controller.runPreValidation();

      expect(result.canProceed).toBe(false);
      expect(result.summary.failures).toBe(1);
    });
  });

  describe('runHealthCheck', () => {
    it('should run post-upgrade health checks', async () => {
      const mockResult: UpgradeHealthResult = {
        healthy: true,
        version: '2.1.0',
        checks: [
          { name: 'database_connection', status: 'pass', message: 'Database connection healthy' },
          { name: 'migrations_applied', status: 'pass', message: 'All migrations applied' },
        ],
        summary: { passed: 7, warnings: 0, failures: 0 },
      };

      mockUpgradeHealthService.checkHealth.mockResolvedValue(mockResult);

      const result = await controller.runHealthCheck();

      expect(mockUpgradeHealthService.checkHealth).toHaveBeenCalled();
      expect(result).toEqual(mockResult);
      expect(result.healthy).toBe(true);
    });

    it('should return unhealthy when any check fails', async () => {
      const mockResult: UpgradeHealthResult = {
        healthy: false,
        version: '2.1.0',
        checks: [
          { name: 'database_connection', status: 'fail', message: 'Cannot connect' },
        ],
        summary: { passed: 6, warnings: 0, failures: 1 },
      };

      mockUpgradeHealthService.checkHealth.mockResolvedValue(mockResult);

      const result = await controller.runHealthCheck();

      expect(result.healthy).toBe(false);
      expect(result.summary.failures).toBe(1);
    });
  });

  describe('checkConfigCompatibility', () => {
    it('should check configuration compatibility for target version', async () => {
      const mockResult: ConfigCompatibilityResult = {
        compatible: true,
        version: '2.1.0',
        issues: [],
        summary: { errors: 0, warnings: 0 },
      };

      mockUpgradeService.getCurrentVersion.mockResolvedValue('2.0.0');
      mockConfigCompatibility.checkCompatibility.mockResolvedValue(mockResult);

      const result = await controller.checkConfigCompatibility('2.1.0');

      expect(mockConfigCompatibility.checkCompatibility).toHaveBeenCalledWith('2.1.0');
      expect(result).toEqual(mockResult);
      expect(result.compatible).toBe(true);
    });

    it('should use current version when version not provided', async () => {
      const mockResult: ConfigCompatibilityResult = {
        compatible: true,
        version: '2.0.0',
        issues: [],
        summary: { errors: 0, warnings: 0 },
      };

      mockUpgradeService.getCurrentVersion.mockResolvedValue('2.0.0');
      mockConfigCompatibility.checkCompatibility.mockResolvedValue(mockResult);

      const result = await controller.checkConfigCompatibility();

      expect(mockUpgradeService.getCurrentVersion).toHaveBeenCalled();
      expect(mockConfigCompatibility.checkCompatibility).toHaveBeenCalledWith('2.0.0');
      expect(result.compatible).toBe(true);
    });

    it('should return incompatible when issues found', async () => {
      const mockResult: ConfigCompatibilityResult = {
        compatible: false,
        version: '2.1.0',
        issues: [
          {
            type: 'error',
            path: 'DATABASE_URL',
            message: 'Missing required DATABASE_URL',
          },
        ],
        summary: { errors: 1, warnings: 0 },
      };

      mockConfigCompatibility.checkCompatibility.mockResolvedValue(mockResult);

      const result = await controller.checkConfigCompatibility('2.1.0');

      expect(result.compatible).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].type).toBe('error');
    });

    it('should return warnings when deprecated vars used', async () => {
      const mockResult: ConfigCompatibilityResult = {
        compatible: true,
        version: '2.1.0',
        issues: [
          {
            type: 'warning',
            path: 'OLD_AUTH_VAR',
            message: 'Using deprecated environment variable',
          },
        ],
        summary: { errors: 0, warnings: 1 },
      };

      mockConfigCompatibility.checkCompatibility.mockResolvedValue(mockResult);

      const result = await controller.checkConfigCompatibility('2.1.0');

      expect(result.compatible).toBe(true);
      expect(result.summary.warnings).toBe(1);
    });
  });
});