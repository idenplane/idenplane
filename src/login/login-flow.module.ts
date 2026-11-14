import { Module } from '@nestjs/common';
import { LoginFlowService } from './login-flow.service.js';
import { PostAuthService } from './post-auth.service.js';
import { SecondFactorVerifier } from './second-factor-verifier.service.js';
import { LoginCoreModule } from './login-core.module.js';
import { OAuthCoreModule } from '../oauth/oauth-core.module.js';
import { PrimaryAuthGatesService } from './primary-auth-gates.service.js';
import { RiskAssessmentModule } from '../risk-assessment/risk-assessment.module.js';

/**
 * What follows a first factor, shared by the login pages, brokering and the
 * custom-flow runtime. The password sign-in's gates need
 * RiskAssessmentModule, imported here.
 */
@Module({
  imports: [LoginCoreModule, OAuthCoreModule, RiskAssessmentModule],
  providers: [
    LoginFlowService,
    PostAuthService,
    SecondFactorVerifier,
    PrimaryAuthGatesService,
  ],
  exports: [
    LoginFlowService,
    PostAuthService,
    SecondFactorVerifier,
    PrimaryAuthGatesService,
  ],
})
export class LoginFlowModule {}
