import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { ClientAuthModule } from '../client-auth/client-auth.module.js';
import { CustomAttributesModule } from '../custom-attributes/custom-attributes.module.js';
import { StepUpCoreModule } from '../step-up/step-up-core.module.js';
import { UserFederationModule } from '../user-federation/user-federation.module.js';

@Module({
  imports: [
    ClientAuthModule,
    CustomAttributesModule,
    StepUpCoreModule,
    UserFederationModule,
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
