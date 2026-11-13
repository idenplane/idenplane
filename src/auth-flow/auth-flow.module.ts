import { Module } from '@nestjs/common';
import { AuthFlowController } from './auth-flow.controller.js';
import { AuthFlowService } from './auth-flow.service.js';
import { AuthFlowCoreModule } from './auth-flow-core.module.js';

/**
 * The flow admin API (definitions, validation and bindings). The login
 * runtime lives in AuthFlowRuntimeModule.
 */
@Module({
  imports: [AuthFlowCoreModule],
  controllers: [AuthFlowController],
  providers: [AuthFlowService],
  exports: [AuthFlowService, AuthFlowCoreModule],
})
export class AuthFlowModule {}
