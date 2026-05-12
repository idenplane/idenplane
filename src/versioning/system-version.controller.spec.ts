import { Test, TestingModule } from '@nestjs/testing';
import { SystemVersionController } from './system-version.controller.js';
import { MigrationCheckService } from './migration-check.service.js';
import type { MigrationStatus } from './migration-check.service.js';

function makeMigrationCheckService(status: MigrationStatus) {
  return { getStatus: jest.fn().mockResolvedValue(status) };
}

describe('SystemVersionController', () => {
  let controller: SystemVersionController;
  let migrationCheck: ReturnType<typeof makeMigrationCheckService>;

  async function build(status: MigrationStatus) {
    migrationCheck = makeMigrationCheckService(status);
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SystemVersionController],
      providers: [{ provide: MigrationCheckService, useValue: migrationCheck }],
    }).compile();

    controller = module.get<SystemVersionController>(SystemVersionController);
  }

  describe('when database is up to date', () => {
    beforeEach(async () => {
      await build({
        appliedCount: 5,
        pendingCount: 0,
        pendingMigrations: [],
        schemaVersion: '20260324400000_add_plugin_system',
      });
    });

    it('should be defined', () => {
      expect(controller).toBeDefined();
    });

    it('returns databaseUpToDate: true', async () => {
      const result = await controller.getVersion();
      expect(result.databaseUpToDate).toBe(true);
    });

    it('returns empty pendingMigrations array', async () => {
      const result = await controller.getVersion();
      expect(result.pendingMigrations).toEqual([]);
    });

    it('returns the last applied migration as schemaVersion', async () => {
      const result = await controller.getVersion();
      expect(result.schemaVersion).toBe('20260324400000_add_plugin_system');
    });

    it('includes an application version string', async () => {
      const result = await controller.getVersion();
      expect(typeof result.version).toBe('string');
      expect(result.version.length).toBeGreaterThan(0);
    });
  });

  describe('when there are pending migrations', () => {
    const pending = ['20260401000000_new_feature', '20260402000000_another'];

    beforeEach(async () => {
      await build({
        appliedCount: 3,
        pendingCount: 2,
        pendingMigrations: pending,
        schemaVersion: '20260324300000_add_custom_user_attributes',
      });
    });

    it('returns databaseUpToDate: false', async () => {
      const result = await controller.getVersion();
      expect(result.databaseUpToDate).toBe(false);
    });

    it('lists pending migration names', async () => {
      const result = await controller.getVersion();
      expect(result.pendingMigrations).toEqual(pending);
    });
  });

  describe('when no migrations have been applied yet', () => {
    beforeEach(async () => {
      await build({
        appliedCount: 0,
        pendingCount: 0,
        pendingMigrations: [],
        schemaVersion: null,
      });
    });

    it('returns null schemaVersion', async () => {
      const result = await controller.getVersion();
      expect(result.schemaVersion).toBeNull();
    });
  });
});
