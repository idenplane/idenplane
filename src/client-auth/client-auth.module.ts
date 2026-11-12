import { Module } from '@nestjs/common';
import { ClientSecretModule } from '../clients/client-secret.module.js';
import { MtlsModule } from '../mtls/mtls.module.js';
import { ClientAuthenticator } from './client-authenticator.js';
import { ClientCertificateResolverRegistry } from './client-certificate-resolver.js';

/**
 * OAuth client authentication for every endpoint that needs it. Re-exports
 * {@link MtlsModule} so a controller can read the presented certificate.
 */
@Module({
  imports: [ClientSecretModule, MtlsModule],
  providers: [ClientAuthenticator, ClientCertificateResolverRegistry],
  exports: [ClientAuthenticator, ClientCertificateResolverRegistry, MtlsModule],
})
export class ClientAuthModule {}
