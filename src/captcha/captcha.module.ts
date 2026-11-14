import { Module } from '@nestjs/common';
import {
  CaptchaService,
  CAPTCHA_VERIFY_ENDPOINTS,
  DEFAULT_CAPTCHA_VERIFY_ENDPOINTS,
} from './captcha.service.js';

/**
 * Server-side CAPTCHA verification for self-registration, shared by the
 * registration API and the hosted registration page. Tests override
 * CAPTCHA_VERIFY_ENDPOINTS to point at a local fake provider.
 */
@Module({
  providers: [
    CaptchaService,
    {
      provide: CAPTCHA_VERIFY_ENDPOINTS,
      useValue: DEFAULT_CAPTCHA_VERIFY_ENDPOINTS,
    },
  ],
  exports: [CaptchaService],
})
export class CaptchaModule {}
