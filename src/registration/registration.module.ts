import { Module } from '@nestjs/common';
import { RegistrationController } from './registration.controller.js';
import { RegistrationService } from './registration.service.js';
import { CaptchaService } from './captcha.service.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
import { EmailModule } from '../email/email.module.js';
import { CryptoModule } from '../crypto/crypto.module.js';
import { VerificationModule } from '../verification/verification.module.js';
import { PasswordPolicyModule } from '../password-policy/password-policy.module.js';
import { ThemeModule } from '../theme/theme.module.js';

@Module({
  imports: [
    WebhooksModule,
    EmailModule,
    CryptoModule,
    VerificationModule,
    PasswordPolicyModule,
    ThemeModule,
  ],
  controllers: [RegistrationController],
  providers: [RegistrationService, CaptchaService],
  exports: [RegistrationService],
})
export class RegistrationModule {}
