import { Module } from '@nestjs/common';
import { UpgradeController } from './upgrade.controller.js';
import { UpgradeService } from './upgrade.service.js';
import { RollbackService } from './rollback.service.js';
import { PreUpgradeValidatorService } from './pre-upgrade-validator.service.js';
import { DatabaseBackupService } from './database-backup.service.js';
import { ConfigCompatibilityService } from './config-compatibility.service.js';
import { UpgradeHealthService } from './upgrade-health.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';

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
  ],
  exports: [
    UpgradeService,
    RollbackService,
    PreUpgradeValidatorService,
    DatabaseBackupService,
    ConfigCompatibilityService,
    UpgradeHealthService,
  ],
})
export class UpgradeModule {}
