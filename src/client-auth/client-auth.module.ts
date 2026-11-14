import { Module } from '@nestjs/common';
import { ClientSecretModule } from '../clients/client-secret.module.js';
import { MtlsModule } from '../mtls/mtls.module.js';
import { ClientAuthenticator } from './client-authenticator.js';
import { ClientCertificateResolverRegistry } from './client-certificate-resolver.js';
import { ClientTableCertificateResolver } from './client-table-certificate.resolver.js';
import { CertificateAuthFailureBudget } from './certificate-auth-failure-budget.js';
import { PkiPathValidator } from './pki-path-validator.js';
import { TlsTrustStore } from './tls-trust-store.js';

/**
 * OAuth client authentication for every endpoint that needs it, including
 * RFC 8705 certificate authentication. Re-exports {@link MtlsModule} so a
 * controller can read the presented certificate.
 */
@Module({
  imports: [ClientSecretModule, MtlsModule],
  providers: [
    ClientAuthenticator,
    ClientCertificateResolverRegistry,
    ClientTableCertificateResolver,
    CertificateAuthFailureBudget,
    PkiPathValidator,
    TlsTrustStore,
  ],
  exports: [
    ClientAuthenticator,
    ClientCertificateResolverRegistry,
    PkiPathValidator,
    TlsTrustStore,
    MtlsModule,
  ],
})
export class ClientAuthModule {}
