import { Module } from '@nestjs/common';
import { AuthFlowController } from './auth-flow.controller.js';
import { AuthFlowService } from './auth-flow.service.js';
import { FlowExecutorService } from './flow-executor.service.js';
import { FlowBindingResolver } from './flow-binding.resolver.js';
import { LoginCoreModule } from '../login/login-core.module.js';
import { MfaModule } from '../mfa/mfa.module.js';

@Module({
  imports: [LoginCoreModule, MfaModule],
  controllers: [AuthFlowController],
  // FlowBindingResolver is provided for the upcoming runtime; nothing in the
  // login path injects it yet.
  providers: [AuthFlowService, FlowExecutorService, FlowBindingResolver],
  exports: [AuthFlowService, FlowExecutorService, FlowBindingResolver],
})
export class AuthFlowModule {}
