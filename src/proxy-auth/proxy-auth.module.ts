import { Module } from '@nestjs/common';
import { ProxyAuthController } from './proxy-auth.controller.js';
import { ProxyAuthService } from './proxy-auth.service.js';
import { ProxyApplicationsController } from './proxy-applications.controller.js';
import { ProxyApplicationsService } from './proxy-applications.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { TokensModule } from '../tokens/tokens.module.js';

/**
 * Reverse-proxy / forward-auth mode (#1314).
 *
 * Imports AuthModule and TokensModule rather than reimplementing their work:
 * the login handshake runs through the ordinary authorize endpoint and token
 * grant, and the resulting access token is resolved back to a user through the
 * ordinary introspection path. That is what makes MFA, step-up, SSO, consent
 * and token revocation apply here for free.
 */
@Module({
  imports: [AuthModule, TokensModule],
  controllers: [ProxyAuthController, ProxyApplicationsController],
  providers: [ProxyAuthService, ProxyApplicationsService],
  exports: [ProxyAuthService],
})
export class ProxyAuthModule {}
