import { Global, Module } from '@nestjs/common';
import { SmsService } from './sms.service.js';
import { SmsOtpService } from './sms-otp.service.js';

@Global()
@Module({
  providers: [SmsService, SmsOtpService],
  exports: [SmsService, SmsOtpService],
})
export class SmsModule {}
