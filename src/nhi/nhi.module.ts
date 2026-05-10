import { Module } from '@nestjs/common';
import { NhiController } from './nhi.controller.js';
import { NhiService } from './nhi.service.js';
import { NhiAuditService } from './nhi-audit.service.js';
import { MtlsGuard } from './mtls.guard.js';
import { NhiCertificateGuard } from './mtls.guard.js';

@Module({
  controllers: [NhiController],
  providers: [NhiService, NhiAuditService, MtlsGuard, NhiCertificateGuard],
  exports: [NhiService, NhiAuditService, MtlsGuard, NhiCertificateGuard],
})
export class NhiModule {}