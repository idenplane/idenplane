import { Module } from '@nestjs/common';
import { OAuthController } from './oauth.controller.js';
import { OAuthCoreModule } from './oauth-core.module.js';
import { LoginCoreModule } from '../login/login-core.module.js';
import { StepUpCoreModule } from '../step-up/step-up-core.module.js';
import { ThemeModule } from '../theme/theme.module.js';

@Module({
  imports: [OAuthCoreModule, LoginCoreModule, StepUpCoreModule, ThemeModule],
  controllers: [OAuthController],
})
export class OAuthModule {}
