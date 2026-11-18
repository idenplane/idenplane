import { Module } from '@nestjs/common';
import { BackchannelLogoutService } from './backchannel-logout.service.js';

/**
 * Back-channel logout delivery on its own, so the sessions module can send
 * logout tokens without importing the token endpoint module. One instance
 * per application, so its concurrency bound is process-wide.
 */
@Module({
  providers: [BackchannelLogoutService],
  exports: [BackchannelLogoutService],
})
export class BackchannelLogoutModule {}
