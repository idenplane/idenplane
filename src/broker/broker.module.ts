import { Module } from '@nestjs/common';
import { BrokerController } from './broker.controller.js';
import { BrokerCoreModule } from './broker-core.module.js';
import { ThemeModule } from '../theme/theme.module.js';
import { LoginFlowModule } from '../login/login-flow.module.js';
import { AuthFlowRuntimeModule } from '../auth-flow/auth-flow-runtime.module.js';

@Module({
  imports: [
    BrokerCoreModule,
    ThemeModule,
    LoginFlowModule,
    AuthFlowRuntimeModule,
  ],
  controllers: [BrokerController],
})
export class BrokerModule {}
