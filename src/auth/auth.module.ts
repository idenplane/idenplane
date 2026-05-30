import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { CustomAttributesModule } from '../custom-attributes/custom-attributes.module.js';
import { StepUpModule } from '../step-up/step-up.module.js';
import { UserFederationModule } from '../user-federation/user-federation.module.js';

@Module({
  imports: [CustomAttributesModule, StepUpModule, UserFederationModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
