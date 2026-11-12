import { Module } from '@nestjs/common';
import { StepUpController } from './step-up.controller.js';
import { StepUpCoreModule } from './step-up-core.module.js';
import { LoginCoreModule } from '../login/login-core.module.js';
import { WebAuthnCoreModule } from '../webauthn/webauthn-core.module.js';

@Module({
  imports: [StepUpCoreModule, LoginCoreModule, WebAuthnCoreModule],
  controllers: [StepUpController],
})
export class StepUpModule {}
