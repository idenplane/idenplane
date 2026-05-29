import { Module, forwardRef } from '@nestjs/common';
import { OAuthController } from './oauth.controller.js';
import { OAuthService } from './oauth.service.js';
import { LoginModule } from '../login/login.module.js';
import { StepUpModule } from '../step-up/step-up.module.js';
import { ThemeModule } from '../theme/theme.module.js';

@Module({
  imports: [
    forwardRef(() => LoginModule),
    forwardRef(() => StepUpModule),
    ThemeModule,
  ],
  controllers: [OAuthController],
  providers: [OAuthService],
  exports: [OAuthService],
})
export class OAuthModule {}
