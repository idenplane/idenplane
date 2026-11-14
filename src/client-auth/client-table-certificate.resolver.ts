import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MTLS_CONFIG, type MtlsConfig } from '../mtls/mtls-config.js';
import {
  ClientCertificateResolverRegistry,
  type ClientCertificateRejection,
  type ClientCertificateResolution,
  type ClientCertificateResolveInput,
  type ClientCertificateResolver,
} from './client-certificate-resolver.js';
import { PkiPathValidator } from './pki-path-validator.js';
import { TlsTrustStore } from './tls-trust-store.js';
import {
  configuredRules,
  matchesTlsClientAuthRule,
} from './certificate-checks.js';

/**
 * RFC 8705 §2 for ordinary OAuth clients, from the client table:
 *
 * - `self_signed_tls_client_auth`: the certificate's `x5t#S256` is one of the
 *   client's registered certificates and inside that row's validity window.
 * - `tls_client_auth`: the certificate chains to one of the realm's trust
 *   anchors (PkiPathValidator), then matches the client's one subject rule.
 *
 * Both consult the realm's deny-list. Registers itself on startup. An
 * NHI-backed client (`nhiIdentityId`) is not this resolver's: its
 * certificates are its identity's credentials (NhiClientCertificateResolver).
 */
@Injectable()
export class ClientTableCertificateResolver
  implements ClientCertificateResolver, OnModuleInit
{
  readonly name = 'client-table';

  constructor(
    private readonly prisma: PrismaService,
    private readonly trust: TlsTrustStore,
    private readonly validator: PkiPathValidator,
    private readonly registry: ClientCertificateResolverRegistry,
    @Inject(MTLS_CONFIG) private readonly config: MtlsConfig,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async resolve(
    input: ClientCertificateResolveInput,
  ): Promise<ClientCertificateResolution | ClientCertificateRejection | null> {
    if (input.client.nhiIdentityId) return null;
    return input.method === 'self_signed_tls_client_auth'
      ? this.selfSigned(input)
      : this.pki(input);
  }

  private resolution(
    input: ClientCertificateResolveInput,
  ): ClientCertificateResolution {
    return {
      clientId: input.client.clientId,
      method: input.method,
      bindToCertificate: input.client.tlsClientCertificateBoundAccessTokens,
    };
  }

  private async selfSigned(
    input: ClientCertificateResolveInput,
  ): Promise<ClientCertificateResolution | ClientCertificateRejection> {
    const { certificate, client, realm } = input;
    const row = await this.prisma.clientTlsCertificate.findUnique({
      where: {
        clientId_x5tS256: { clientId: client.id, x5tS256: certificate.x5tS256 },
      },
      select: { realmId: true, notBefore: true, notAfter: true },
    });
    if (!row || row.realmId !== realm.id) return { rejected: 'unregistered' };
    const now = new Date();
    if (now < row.notBefore) return { rejected: 'not_yet_valid' };
    if (now > row.notAfter) return { rejected: 'expired' };
    const revoked = await this.trust.revocationCheck(realm.id, [
      certificate.certificate,
    ]);
    if (revoked(certificate.certificate)) return { rejected: 'revoked' };
    return this.resolution(input);
  }

  private async pki(
    input: ClientCertificateResolveInput,
  ): Promise<ClientCertificateResolution | ClientCertificateRejection> {
    const { certificate, client, realm } = input;
    if (configuredRules(client).length !== 1) {
      return { rejected: 'subject_rule_not_configured' };
    }
    const anchors = await this.trust.anchors(realm);
    if (anchors.length === 0) return { rejected: 'no_trust_anchors' };
    const isRevoked = await this.trust.revocationCheck(realm.id, [
      certificate.certificate,
      ...certificate.chain,
      ...anchors,
    ]);
    const result = this.validator.validate({
      leaf: certificate.certificate,
      intermediates: certificate.chain,
      anchors,
      maxChainDepth: this.config.maxChainDepth,
      isRevoked,
    });
    if (!result.ok) return { rejected: result.reason };
    if (!matchesTlsClientAuthRule(certificate.certificate, client)) {
      return { rejected: 'subject_mismatch' };
    }
    return this.resolution(input);
  }
}
