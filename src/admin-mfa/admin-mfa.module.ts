import { Module } from '@nestjs/common';
import { WebAuthnCoreModule } from '../webauthn/webauthn-core.module.js';
import { AdminRbacModule } from '../admin-rbac/admin-rbac.module.js';
import { AdminMfaService } from './admin-mfa.service.js';
import {
  AdminMfaController,
  AdminMfaManagementController,
} from './admin-mfa.controller.js';

/**
 * Admin console MFA: the admins' second factors, the server-wide
 * requirement and the super-admin reset (docs/docs/security/admin-mfa.md).
 * AdminAuthModule imports it for the sign-in; tokens are signed there
 * (AdminAuthService, a global provider), never here.
 */
@Module({
  imports: [WebAuthnCoreModule, AdminRbacModule],
  controllers: [AdminMfaController, AdminMfaManagementController],
  providers: [AdminMfaService],
  exports: [AdminMfaService],
})
export class AdminMfaModule {}
