import { Module } from '@nestjs/common';
import { SetupWizardController } from './setup-wizard.controller.js';
import { SetupWizardService } from './setup-wizard.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';

// AdminApiKeyGuard and AdminRolesGuard resolve their dependencies from the
// global AdminAuthModule and RateLimitModule, as on every admin controller.
@Module({
  imports: [PrismaModule],
  controllers: [SetupWizardController],
  providers: [SetupWizardService],
  exports: [SetupWizardService],
})
export class SetupWizardModule {}
