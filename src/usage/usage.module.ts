import { Global, Module } from '@nestjs/common';
import { UsageActivityRecorder } from './usage-activity.recorder.js';
import { UsageController } from './usage.controller.js';
import { UsageService } from './usage.service.js';
import { UsageRetentionService } from './usage-retention.service.js';

/**
 * Instance usage metering. Global so the sign-in, token and SAML paths can
 * record activity without importing this module (and its controller) into
 * each of theirs.
 */
@Global()
@Module({
  controllers: [UsageController],
  providers: [UsageService, UsageActivityRecorder, UsageRetentionService],
  exports: [UsageActivityRecorder],
})
export class UsageModule {}
