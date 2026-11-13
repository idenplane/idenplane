import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { X509Certificate } from 'node:crypto';
import type { Client } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { MTLS_CONFIG, type MtlsConfig } from '../mtls/mtls-config.js';
import {
  ClientCertificateResolverRegistry,
  type CertificateBindingInput,
  type ClientCertificateRejection,
  type ClientCertificateResolution,
  type ClientCertificateResolveInput,
  type ClientCertificateResolver,
} from '../client-auth/client-certificate-resolver.js';
import { PkiPathValidator } from '../client-auth/pki-path-validator.js';
import { TlsTrustStore } from '../client-auth/tls-trust-store.js';
import { matchesTlsClientAuthRule } from '../client-auth/certificate-checks.js';
import {
  authenticates,
  isIdentityActive,
  nhiCredentialStatus,
  type NhiCredentialStatus,
} from './nhi-credential-status.js';

/** What status and matching need of a credential. */
const CREDENTIAL_SELECT = {
  id: true,
  enabled: true,
  revoked: true,
  expiresAt: true,
  certNotBefore: true,
  certNotAfter: true,
  supersededById: true,
  rotationGraceUntil: true,
  certificatePem: true,
  tlsClientAuthSubjectDn: true,
  tlsClientAuthSanDns: true,
  tlsClientAuthSanUri: true,
  tlsClientAuthSanIp: true,
  tlsClientAuthSanEmail: true,
} as const;

type Rejection = ClientCertificateRejection;

/**
 * RFC 8705 §2 for NHI-backed OAuth clients (`Client.nhiIdentityId`): the
 * certificate authenticates the client when one of its identity's
 * certificate credentials accepts it.
 *
 * - `self_signed_tls_client_auth`: a SELF_SIGNED credential whose
 *   `certThumbprintS256` is the certificate's `x5t#S256`.
 * - `tls_client_auth`: the certificate chains to the realm's trust anchors
 *   (PkiPathValidator), then matches the one subject/SAN rule of a PKI
 *   credential.
 *
 * The credential's computed status must be `active` or `grace`, the
 * identity must be enabled and ACTIVE, and the certificate must not be on
 * the realm's deny-list. Everything else fails closed: a legacy credential
 * without a `tlsAuthMode` never matches, and with MTLS_ENABLED or the
 * realm's `mtlsClientAuthEnabled` off nothing authenticates. Tokens of an
 * NHI-backed client are always certificate-bound.
 *
 * Every query is scoped by the realm. Registers itself on startup; returns
 * `null` for any client that is not NHI-backed.
 */
@Injectable()
export class NhiClientCertificateResolver
  implements ClientCertificateResolver, OnModuleInit
{
  readonly name = 'nhi';

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
  ): Promise<ClientCertificateResolution | Rejection | null> {
    const { client, realm } = input;
    if (!client.nhiIdentityId) return null;
    const precondition = await this.precondition(realm, client);
    if (precondition) return precondition;
    const result =
      input.method === 'self_signed_tls_client_auth'
        ? await this.selfSigned(input)
        : await this.pki(input);
    if (result) return result;
    return {
      clientId: client.clientId,
      method: input.method,
      bindToCertificate: true,
    };
  }

  /**
   * Whether a token bound to `x5tS256` may still be used: the realm still
   * allows certificate authentication, the identity is still active, and
   * the binding still holds.
   *
   * - SELF_SIGNED: a credential with that thumbprint is `active` or
   *   `grace`, and its certificate is not on the deny-list.
   * - PKI: no certificate is stored, so the thumbprint is checked against
   *   the deny-list and the identity must still have an `active` or `grace`
   *   PKI credential. An issuer-and-serial deny-list entry cannot be checked
   *   from the thumbprint alone; it takes effect at the next token request.
   */
  async bindingActive(input: CertificateBindingInput): Promise<boolean | null> {
    const { client, realm, x5tS256 } = input;
    if (!client.nhiIdentityId) return null;
    if (!x5tS256) return false;
    if (await this.precondition(realm, client)) return false;
    if (await this.thumbprintRevoked(realm.id, x5tS256)) return false;

    if (client.tokenEndpointAuthMethod === 'self_signed_tls_client_auth') {
      const rows = await this.prisma.nhiCredential.findMany({
        where: {
          realmId: realm.id,
          nhiIdentityId: client.nhiIdentityId,
          tlsAuthMode: 'SELF_SIGNED',
          certThumbprintS256: x5tS256,
        },
        select: CREDENTIAL_SELECT,
      });
      const usable = rows.find((row) =>
        authenticates(nhiCredentialStatus(row, null)),
      );
      if (!usable?.certificatePem) return false;
      let certificate: X509Certificate;
      try {
        certificate = new X509Certificate(usable.certificatePem);
      } catch {
        return false;
      }
      const revoked = await this.trust.revocationCheck(realm.id, [certificate]);
      return !revoked(certificate);
    }

    if (client.tokenEndpointAuthMethod === 'tls_client_auth') {
      const rows = await this.prisma.nhiCredential.findMany({
        where: {
          realmId: realm.id,
          nhiIdentityId: client.nhiIdentityId,
          tlsAuthMode: 'PKI',
        },
        select: CREDENTIAL_SELECT,
      });
      return rows.some((row) => authenticates(nhiCredentialStatus(row, null)));
    }
    return false;
  }

  /** Why nothing of this client can authenticate now, or `undefined`. */
  private async precondition(
    realm: CertificateBindingInput['realm'],
    client: Client,
  ): Promise<Rejection | undefined> {
    if (!this.config.enabled || realm.mtlsClientAuthEnabled !== true) {
      return { rejected: 'mtls_disabled' };
    }
    if (client.realmId !== realm.id) return { rejected: 'realm_mismatch' };
    const identity = await this.prisma.nhiIdentity.findFirst({
      where: { id: client.nhiIdentityId!, realmId: realm.id },
      select: { enabled: true, lifecycleStatus: true },
    });
    if (!identity) return { rejected: 'identity_not_found' };
    if (!isIdentityActive(identity)) return { rejected: 'identity_inactive' };
    return undefined;
  }

  private async selfSigned(
    input: ClientCertificateResolveInput,
  ): Promise<Rejection | undefined> {
    const { certificate, client, realm } = input;
    const rows = await this.prisma.nhiCredential.findMany({
      where: {
        realmId: realm.id,
        nhiIdentityId: client.nhiIdentityId!,
        tlsAuthMode: 'SELF_SIGNED',
        certThumbprintS256: certificate.x5tS256,
      },
      select: CREDENTIAL_SELECT,
    });
    const status = bestStatus(rows);
    if (!status) return { rejected: 'no_matching_credential' };
    if (!authenticates(status)) return { rejected: `credential_${status}` };
    // The certificate is the credential's (same thumbprint, same DER), so its
    // validity window is the credential's; check it anyway.
    const now = Date.now();
    if (now < certificate.certificate.validFromDate.getTime()) {
      return { rejected: 'not_yet_valid' };
    }
    if (now > certificate.certificate.validToDate.getTime()) {
      return { rejected: 'expired' };
    }
    const revoked = await this.trust.revocationCheck(realm.id, [
      certificate.certificate,
    ]);
    if (revoked(certificate.certificate)) return { rejected: 'revoked' };
    return undefined;
  }

  private async pki(
    input: ClientCertificateResolveInput,
  ): Promise<Rejection | undefined> {
    const { certificate, client, realm } = input;
    const rows = await this.prisma.nhiCredential.findMany({
      where: {
        realmId: realm.id,
        nhiIdentityId: client.nhiIdentityId!,
        tlsAuthMode: 'PKI',
      },
      select: CREDENTIAL_SELECT,
    });
    if (rows.length === 0) return { rejected: 'no_matching_credential' };

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

    const matching = rows.filter((row) =>
      matchesTlsClientAuthRule(certificate.certificate, row),
    );
    const status = bestStatus(matching);
    if (!status) return { rejected: 'subject_mismatch' };
    if (!authenticates(status)) return { rejected: `credential_${status}` };
    return undefined;
  }

  private async thumbprintRevoked(
    realmId: string,
    x5tS256: string,
  ): Promise<boolean> {
    const count = await this.prisma.tlsRevokedCertificate.count({
      where: { realmId, x5tS256 },
    });
    return count > 0;
  }
}

/**
 * The status that decides for a set of matching credentials: an
 * authenticating one if any, else the first one's, else `undefined`.
 */
function bestStatus(
  rows: Parameters<typeof nhiCredentialStatus>[0][],
): NhiCredentialStatus | undefined {
  const statuses = rows.map((row) => nhiCredentialStatus(row, null));
  return statuses.find(authenticates) ?? statuses[0];
}
