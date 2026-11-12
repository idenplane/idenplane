import { Module } from '@nestjs/common';
import { StepUpService } from './step-up.service.js';

/** The step-up service, without the step-up endpoints. */
@Module({
  providers: [StepUpService],
  exports: [StepUpService],
})
export class StepUpCoreModule {}
