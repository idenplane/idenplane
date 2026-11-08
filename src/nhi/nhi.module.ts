import { Module } from '@nestjs/common';
import { NhiController } from './nhi.controller.js';
import { NhiService } from './nhi.service.js';
import { NhiAuditService } from './nhi-audit.service.js';
import { MtlsGuard } from './mtls.guard.js';
import { NhiCertificateGuard } from './mtls.guard.js';
import { NhiRotationScheduler } from './nhi-rotation.scheduler.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';

@Module({
  imports: [WebhooksModule],
  controllers: [NhiController],
  providers: [
    NhiService,
    NhiAuditService,
    MtlsGuard,
    NhiCertificateGuard,
    // Was never registered, so auto-rotate policies did nothing.
    NhiRotationScheduler,
  ],
  exports: [NhiService, NhiAuditService, MtlsGuard, NhiCertificateGuard],
})
export class NhiModule {}
