import { Module } from '@nestjs/common';
import { LoginFlowService } from './login-flow.service.js';
import { LoginCoreModule } from './login-core.module.js';
import { OAuthCoreModule } from '../oauth/oauth-core.module.js';

/** What follows a first factor, shared by the login pages and brokering. */
@Module({
  imports: [LoginCoreModule, OAuthCoreModule],
  providers: [LoginFlowService],
  exports: [LoginFlowService],
})
export class LoginFlowModule {}
