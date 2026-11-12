import { Module } from '@nestjs/common';
import { AuthFlowController } from './auth-flow.controller.js';
import { AuthFlowService } from './auth-flow.service.js';
import { FlowExecutorService } from './flow-executor.service.js';
import { LoginCoreModule } from '../login/login-core.module.js';
import { MfaModule } from '../mfa/mfa.module.js';

@Module({
  imports: [LoginCoreModule, MfaModule],
  controllers: [AuthFlowController],
  providers: [AuthFlowService, FlowExecutorService],
  exports: [AuthFlowService, FlowExecutorService],
})
export class AuthFlowModule {}
