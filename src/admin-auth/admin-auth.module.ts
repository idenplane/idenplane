import { Global, Module } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminAuthController } from './admin-auth.controller.js';
import { AdminSeedService } from './admin-seed.service.js';
import { AdminRolesGuard } from '../common/guards/admin-roles.guard.js';
import { MtlsModule } from '../mtls/mtls.module.js';
import { AdminRbacModule } from '../admin-rbac/admin-rbac.module.js';
import { AdminMfaModule } from '../admin-mfa/admin-mfa.module.js';

@Global()
@Module({
  // MtlsModule: a certificate-bound admin token needs the presented certificate.
  // AdminRbacModule: who-am-I reads the admin's roles and realm scope.
  // AdminMfaModule: the second factor of a console sign-in.
  imports: [MtlsModule, AdminRbacModule, AdminMfaModule],
  controllers: [AdminAuthController],
  providers: [AdminAuthService, AdminSeedService, AdminRolesGuard],
  exports: [AdminAuthService, AdminRolesGuard],
})
export class AdminAuthModule {}
