import { Global, Module, forwardRef } from '@nestjs/common';
import { EventsService } from './events.service.js';
import { EventsController } from './events.controller.js';
import { EventsCleanupService } from './events-cleanup.service.js';
import { AuditExportService } from './audit-export.service.js';
import { AuditStreamsService } from './audit-streams.service.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';

@Global()
@Module({
  imports: [forwardRef(() => WebhooksModule)],
  controllers: [EventsController],
  providers: [
    EventsService,
    EventsCleanupService,
    AuditExportService,
    AuditStreamsService,
  ],
  exports: [EventsService, AuditStreamsService],
})
export class EventsModule {}
