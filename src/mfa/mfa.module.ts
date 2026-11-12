import { Global, Module } from '@nestjs/common';
import { MfaService } from './mfa.service.js';
import { MfaController } from './mfa.controller.js';
import { StepUpCoreModule } from '../step-up/step-up-core.module.js';
import { LoginCoreModule } from '../login/login-core.module.js';

@Global()
@Module({
  controllers: [MfaController],
  imports: [StepUpCoreModule, LoginCoreModule],
  providers: [MfaService],
  exports: [MfaService],
})
export class MfaModule {}
