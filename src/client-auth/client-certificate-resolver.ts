import { Injectable } from '@nestjs/common';
import type { PresentedClientCertificate } from '../mtls/client-certificate.source.js';

/** Which RFC 8705 §2 method a resolver answers for. */
export type CertificateAuthMethod =
  'tls_client_auth' | 'self_signed_tls_client_auth';

export interface ClientCertificateResolution {
  /** The client the certificate authenticates. */
  clientId: string;
  method: CertificateAuthMethod;
  /** When the client's tokens must be bound to the certificate (`cnf`). */
  bindToCertificate: boolean;
}

/**
 * Decides whether a presented certificate authenticates a client: the client
 * table (PR 2) and NHI credentials (PR 4) each register one. A resolver
 * returns `null` when the certificate is not one it knows about.
 */
export interface ClientCertificateResolver {
  readonly name: string;
  resolve(input: {
    realmId: string;
    clientId: string;
    certificate: PresentedClientCertificate;
  }): Promise<ClientCertificateResolution | null>;
}

/**
 * The resolvers certificate authentication may consult. Empty in this
 * release, so no `tls_*` method can succeed: certificate authentication fails
 * closed until a resolver is registered.
 */
@Injectable()
export class ClientCertificateResolverRegistry {
  private readonly registered: ClientCertificateResolver[] = [];

  register(resolver: ClientCertificateResolver): void {
    if (this.registered.some((r) => r.name === resolver.name)) {
      throw new Error(
        `Client certificate resolver "${resolver.name}" is already registered`,
      );
    }
    this.registered.push(resolver);
  }

  resolvers(): readonly ClientCertificateResolver[] {
    return this.registered;
  }
}
