import { Module } from '@nestjs/common';
import { WebAuthnController } from './webauthn.controller.js';
import { WebAuthnCoreModule } from './webauthn-core.module.js';
import { LoginCoreModule } from '../login/login-core.module.js';
import { OAuthCoreModule } from '../oauth/oauth-core.module.js';
import { ConsentModule } from '../consent/consent.module.js';
import { LoginFlowModule } from '../login/login-flow.module.js';
import { AuthFlowRuntimeModule } from '../auth-flow/auth-flow-runtime.module.js';

@Module({
  imports: [
    WebAuthnCoreModule,
    LoginCoreModule,
    OAuthCoreModule,
    ConsentModule,
    LoginFlowModule,
    AuthFlowRuntimeModule,
  ],
  controllers: [WebAuthnController],
})
export class WebAuthnModule {}
