import { Module } from '@nestjs/common';
import { NhiController } from './nhi.controller.js';
import { NhiService } from './nhi.service.js';
import { NhiAuditService } from './nhi-audit.service.js';
import { NhiRotationScheduler } from './nhi-rotation.scheduler.js';
import { NhiOAuthClientService } from './nhi-oauth-client.service.js';
import { NhiClientCertificateResolver } from './nhi-client-certificate.resolver.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
import { ClientAuthModule } from '../client-auth/client-auth.module.js';
import { ClientsModule } from '../clients/clients.module.js';

/**
 * Non-human identities. An identity can have an OAuth client
 * (NhiOAuthClientService) that authenticates at the realm's token endpoint
 * with the identity's certificate credentials: NhiClientCertificateResolver
 * registers itself with ClientAuthModule's resolver registry on startup.
 */
@Module({
  imports: [WebhooksModule, ClientAuthModule, ClientsModule],
  controllers: [NhiController],
  providers: [
    NhiService,
    NhiAuditService,
    NhiOAuthClientService,
    NhiClientCertificateResolver,
    // Was never registered, so auto-rotate policies did nothing.
    NhiRotationScheduler,
  ],
  exports: [NhiService, NhiAuditService],
})
export class NhiModule {}
