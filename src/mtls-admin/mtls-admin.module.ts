import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module.js';
import {
  ClientTlsCertificatesController,
  RealmTlsTrustAnchorsController,
  TlsRevokedCertificatesController,
} from './tls-admin.controllers.js';
import { TlsAdminService } from './tls-admin.service.js';

/**
 * Admin API for RFC 8705 client authentication: client certificates, realm
 * trust anchors and the deny-list. Admin events are recorded by the global
 * AdminEventInterceptor, as for every other admin write.
 */
@Module({
  imports: [ClientsModule],
  controllers: [
    ClientTlsCertificatesController,
    RealmTlsTrustAnchorsController,
    TlsRevokedCertificatesController,
  ],
  providers: [TlsAdminService],
})
export class MtlsAdminModule {}
