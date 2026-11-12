import { Module } from '@nestjs/common';
import { LoginController } from './login.controller.js';
import { LoginCoreModule } from './login-core.module.js';
import { LoginFlowModule } from './login-flow.module.js';
import { OAuthCoreModule } from '../oauth/oauth-core.module.js';
import { ThemeModule } from '../theme/theme.module.js';
import { CustomAttributesModule } from '../custom-attributes/custom-attributes.module.js';
import { RiskAssessmentModule } from '../risk-assessment/risk-assessment.module.js';

@Module({
  imports: [
    LoginCoreModule,
    LoginFlowModule,
    OAuthCoreModule,
    ThemeModule,
    CustomAttributesModule,
    RiskAssessmentModule,
  ],
  controllers: [LoginController],
})
export class LoginModule {}
