import { Module } from '@nestjs/common';
import { AuthFlowCoreModule } from './auth-flow-core.module.js';
import { AuthnTransactionStore } from './authn-transaction.store.js';
import { FlowStepHandlers } from './flow-step-handlers.service.js';
import { FlowRuntimeService } from './flow-runtime.service.js';
import { LoginCoreModule } from '../login/login-core.module.js';
import { LoginFlowModule } from '../login/login-flow.module.js';
import { OAuthCoreModule } from '../oauth/oauth-core.module.js';
import { StepUpCoreModule } from '../step-up/step-up-core.module.js';
import { WebAuthnCoreModule } from '../webauthn/webauthn-core.module.js';
import { ThemeModule } from '../theme/theme.module.js';

/**
 * The custom auth-flow runtime (behind AUTH_FLOW_RUNTIME_ENABLED). It has
 * no controllers: the login, second-factor, passkey and authorization
 * endpoints call into it, so it depends only on core modules.
 */
@Module({
  imports: [
    AuthFlowCoreModule,
    LoginCoreModule,
    LoginFlowModule,
    OAuthCoreModule,
    StepUpCoreModule,
    WebAuthnCoreModule,
    ThemeModule,
  ],
  providers: [AuthnTransactionStore, FlowStepHandlers, FlowRuntimeService],
  exports: [FlowRuntimeService],
})
export class AuthFlowRuntimeModule {}
