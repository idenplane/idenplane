import { Module, forwardRef } from '@nestjs/common';
import { LoginController } from './login.controller.js';
import { LoginService } from './login.service.js';
import { OAuthModule } from '../oauth/oauth.module.js';
import { UserFederationModule } from '../user-federation/user-federation.module.js';
import { ThemeModule } from '../theme/theme.module.js';
import { CustomAttributesModule } from '../custom-attributes/custom-attributes.module.js';
import { RiskAssessmentModule } from '../risk-assessment/risk-assessment.module.js';
import { MigrationModule } from '../migration/migration.module.js';
import { CsrfService } from '../common/csrf/csrf.service.js';

@Module({
  imports: [
    forwardRef(() => OAuthModule),
    UserFederationModule,
    ThemeModule,
    CustomAttributesModule,
    RiskAssessmentModule,
    MigrationModule,
  ],
  controllers: [LoginController],
  providers: [LoginService, CsrfService],
  exports: [LoginService, CsrfService],
})
export class LoginModule {}
