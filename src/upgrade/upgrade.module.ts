import { Module } from '@nestjs/common';
import { UpgradeController } from './upgrade.controller.js';
import { UpgradeService } from './upgrade.service.js';
import { RollbackService } from './rollback.service.js';
import { PreUpgradeValidatorService } from './pre-upgrade-validator.service.js';
import { DatabaseBackupService } from './database-backup.service.js';
import { ConfigCompatibilityService } from './config-compatibility.service.js';
import { UpgradeHealthService } from './upgrade-health.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { UpgradeEnabledGuard } from './guards/upgrade-enabled.guard.js';

@Module({
  imports: [PrismaModule],
  controllers: [UpgradeController],
  providers: [
    UpgradeService,
    RollbackService,
    PreUpgradeValidatorService,
    DatabaseBackupService,
    ConfigCompatibilityService,
    UpgradeHealthService,
    UpgradeEnabledGuard,
  ],
  // Nothing outside this module consumes these services — the controller and
  // the CLI are the only entry points. Kept empty rather than re-exporting a
  // list that would drift.
  exports: [],
})
export class UpgradeModule {}
