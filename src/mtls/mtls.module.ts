import { Module } from '@nestjs/common';
import { MTLS_CONFIG, loadMtlsConfig } from './mtls-config.js';
import { ClientCertificateSource } from './client-certificate.source.js';
import { MtlsServerService } from './mtls-server.js';

/**
 * Client-certificate plumbing for RFC 8705: configuration, the certificate a
 * request presented, and the optional certificate listener. Inert unless
 * `MTLS_ENABLED=true`.
 */
@Module({
  providers: [
    // Read when the module is instantiated, not at import time.
    { provide: MTLS_CONFIG, useFactory: () => loadMtlsConfig(process.env) },
    ClientCertificateSource,
    MtlsServerService,
  ],
  exports: [MTLS_CONFIG, ClientCertificateSource, MtlsServerService],
})
export class MtlsModule {}
