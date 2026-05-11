import { Module } from '@nestjs/common';
import { SetupWizardController } from './setup-wizard.controller.js';
import { SetupWizardService } from './setup-wizard.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { EmailModule } from '../email/email.module.js';

@Module({
  imports: [PrismaModule, EmailModule],
  controllers: [SetupWizardController],
  providers: [SetupWizardService],
  exports: [SetupWizardService],
})
export class SetupWizardModule {}
