import { Module } from '@nestjs/common';
import { LoginFlowService } from './login-flow.service.js';
import { PostAuthService } from './post-auth.service.js';
import { SecondFactorVerifier } from './second-factor-verifier.service.js';
import { LoginCoreModule } from './login-core.module.js';
import { OAuthCoreModule } from '../oauth/oauth-core.module.js';

/** What follows a first factor, shared by the login pages and brokering. */
@Module({
  imports: [LoginCoreModule, OAuthCoreModule],
  providers: [LoginFlowService, PostAuthService, SecondFactorVerifier],
  exports: [LoginFlowService, PostAuthService, SecondFactorVerifier],
})
export class LoginFlowModule {}
