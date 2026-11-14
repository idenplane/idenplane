import { Global, Module } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminAuthController } from './admin-auth.controller.js';
import { AdminSeedService } from './admin-seed.service.js';
import { AdminRolesGuard } from '../common/guards/admin-roles.guard.js';
import { MtlsModule } from '../mtls/mtls.module.js';

@Global()
@Module({
  // MtlsModule: a certificate-bound admin token needs the presented certificate.
  imports: [MtlsModule],
  controllers: [AdminAuthController],
  providers: [AdminAuthService, AdminSeedService, AdminRolesGuard],
  exports: [AdminAuthService, AdminRolesGuard],
})
export class AdminAuthModule {}
