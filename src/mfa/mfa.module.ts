import { Global, Module } from '@nestjs/common';
import { MfaService } from './mfa.service.js';
import { RecoveryCodeRewrapService } from './recovery-code-rewrap.service.js';
import { MfaController } from './mfa.controller.js';
import { StepUpCoreModule } from '../step-up/step-up-core.module.js';
import { LoginCoreModule } from '../login/login-core.module.js';
import { SessionsModule } from '../sessions/sessions.module.js';

@Global()
@Module({
  controllers: [MfaController],
  imports: [StepUpCoreModule, LoginCoreModule, SessionsModule],
  providers: [MfaService, RecoveryCodeRewrapService],
  exports: [MfaService],
})
export class MfaModule {}
