import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { X509Certificate } from 'node:crypto';
import type { Client } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { MTLS_CONFIG, type MtlsConfig } from '../mtls/mtls-config.js';
import {
  ClientCertificateResolverRegistry,
  type CertificateBindingClaims,
  type CertificateBindingInput,
  type ClientCertificateRejection,
  type ClientCertificateResolution,
  type ClientCertificateResolveInput,
  type ClientCertificateResolver,
} from '../client-auth/client-certificate-resolver.js';
import { PkiPathValidator } from '../client-auth/pki-path-validator.js';
import {
  revocationKey,
  TlsTrustStore,
} from '../client-auth/tls-trust-store.js';
import { matchesTlsClientAuthRule } from '../client-auth/certificate-checks.js';
import { NhiAuditService } from './nhi-audit.service.js';
import {
  authenticates,
  isIdentityActive,
  nhiCredentialStatus,
} from './nhi-credential-status.js';

/** What status and matching need of a credential. */
const CREDENTIAL_SELECT = {
  id: true,
  tlsAuthMode: true,
  certThumbprintS256: true,
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

type CredentialRow = {
  id: string;
} & Parameters<typeof nhiCredentialStatus>[0];

type Rejection = ClientCertificateRejection;

/** Which credential accepted the certificate, and the token claims for it. */
interface Accepted {
  credentialId: string;
  claims: CertificateBindingClaims;
}

/** Rejections that say nothing about the identity, so are not audited. */
const NOT_AUDITED = new Set([
  'mtls_disabled',
  'realm_mismatch',
  'identity_not_found',
]);

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
 * realm's `mtlsClientAuthEnabled` off nothing authenticates.
 *
 * Tokens of an NHI-backed client are always certificate-bound and carry the
 * id of the credential that accepted the certificate (`nhi_cid`; for PKI
 * also the certificate's issuer and serial, `nhi_crt`), so introspection
 * checks exactly that credential.
 *
 * A use updates the credential's `lastUsedAt`/`requestCount` and the NHI
 * audit log (ACCESS_GRANTED / ACCESS_DENIED), without delaying the answer.
 *
 * Every query is scoped by the realm. Registers itself on startup; returns
 * `null` for any client that is not NHI-backed.
 */
@Injectable()
export class NhiClientCertificateResolver
  implements ClientCertificateResolver, OnModuleInit
{
  readonly name = 'nhi';
  private readonly logger = new Logger(NhiClientCertificateResolver.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trust: TlsTrustStore,
    private readonly validator: PkiPathValidator,
    private readonly registry: ClientCertificateResolverRegistry,
    @Inject(MTLS_CONFIG) private readonly config: MtlsConfig,
    private readonly audit: NhiAuditService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async resolve(
    input: ClientCertificateResolveInput,
  ): Promise<ClientCertificateResolution | Rejection | null> {
    const { client, realm } = input;
    if (!client.nhiIdentityId) return null;
    const result =
      (await this.precondition(realm, client)) ??
      (input.method === 'self_signed_tls_client_auth'
        ? await this.selfSigned(input)
        : await this.pki(input));
    this.recordUse(input, result);
    if ('rejected' in result) return result;
    return {
      clientId: client.clientId,
      method: input.method,
      bindToCertificate: true,
      bindingClaims: result.claims,
    };
  }

  /**
   * Whether a token bound to `x5tS256` may still be used: the realm still
   * allows certificate authentication, the identity is still active, and
   * the credential that issued it (`nhi_cid`) still accepts it:
   *
   * - its computed status is `active` or `grace` (a rotated-out credential
   *   stops when its grace period ends; a revoked one at once);
   * - its mode is the client's method, and for SELF_SIGNED its thumbprint
   *   is the token's;
   * - the certificate is not on the realm's deny-list, by thumbprint or by
   *   issuer and serial number (from the stored certificate, or for PKI from
   *   the token's `nhi_crt`).
   *
   * A token without `nhi_cid` is not active.
   */
  async bindingActive(input: CertificateBindingInput): Promise<boolean | null> {
    const { client, realm, x5tS256, claims } = input;
    if (!client.nhiIdentityId) return null;
    const credentialId = claims.nhi_cid;
    if (!x5tS256 || typeof credentialId !== 'string') return false;
    if (await this.precondition(realm, client)) return false;

    const credential = await this.prisma.nhiCredential.findFirst({
      where: {
        id: credentialId,
        realmId: realm.id,
        nhiIdentityId: client.nhiIdentityId,
      },
      select: CREDENTIAL_SELECT,
    });
    if (!credential) return false;
    if (!authenticates(nhiCredentialStatus(credential, null))) return false;

    if (client.tokenEndpointAuthMethod === 'self_signed_tls_client_auth') {
      if (
        credential.tlsAuthMode !== 'SELF_SIGNED' ||
        credential.certThumbprintS256 !== x5tS256 ||
        !credential.certificatePem
      ) {
        return false;
      }
      let certificate: X509Certificate;
      try {
        certificate = new X509Certificate(credential.certificatePem);
      } catch {
        return false;
      }
      return !(await this.trust.isRevokedKey(
        realm.id,
        revocationKey(certificate),
      ));
    }

    if (client.tokenEndpointAuthMethod === 'tls_client_auth') {
      if (credential.tlsAuthMode !== 'PKI') return false;
      const crt = claims.nhi_crt as { iss?: unknown; sn?: unknown } | undefined;
      return !(await this.trust.isRevokedKey(realm.id, {
        x5t: x5tS256,
        issuer: typeof crt?.iss === 'string' ? crt.iss : '',
        serial: typeof crt?.sn === 'string' ? crt.sn : '',
      }));
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
  ): Promise<Accepted | Rejection> {
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
    const chosen = choose(rows);
    if ('rejected' in chosen) {
      return chosen.rejected === 'none'
        ? { rejected: 'no_matching_credential' }
        : chosen;
    }
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
    return { credentialId: chosen.id, claims: { nhi_cid: chosen.id } };
  }

  private async pki(
    input: ClientCertificateResolveInput,
  ): Promise<Accepted | Rejection> {
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

    const chosen = choose(
      rows.filter((row) =>
        matchesTlsClientAuthRule(certificate.certificate, row),
      ),
    );
    if ('rejected' in chosen) {
      return chosen.rejected === 'none'
        ? { rejected: 'subject_mismatch' }
        : chosen;
    }
    const key = revocationKey(certificate.certificate);
    return {
      credentialId: chosen.id,
      claims: {
        nhi_cid: chosen.id,
        nhi_crt: { iss: key.issuer, sn: key.serial },
      },
    };
  }

  /**
   * Records a decision without delaying it: the credential's use (one
   * update) and an NHI audit entry. Failures are logged, never thrown.
   */
  private recordUse(
    input: ClientCertificateResolveInput,
    result: Accepted | Rejection,
  ): void {
    const { client, realm, method, certificate } = input;
    const base = {
      realmId: realm.id,
      nhiIdentityId: client.nhiIdentityId!,
      details: {
        clientId: client.clientId,
        method,
        x5tS256: certificate.x5tS256,
      },
    };
    if ('rejected' in result) {
      if (NOT_AUDITED.has(result.rejected)) return;
      void this.audit.recordAudit({
        ...base,
        action: 'ACCESS_DENIED',
        success: false,
        errorCode: result.rejected,
      });
      return;
    }
    void this.prisma.nhiCredential
      .update({
        where: { id: result.credentialId, realmId: realm.id },
        data: { lastUsedAt: new Date(), requestCount: { increment: 1 } },
        select: { id: true },
      })
      .catch((err: Error) =>
        this.logger.warn(
          `Could not record the use of NHI credential ${result.credentialId}: ${err.message}`,
        ),
      );
    void this.audit.recordAudit({
      ...base,
      action: 'ACCESS_GRANTED',
      credentialId: result.credentialId,
    });
  }
}

/**
 * The credential that decides among matching ones: an `active` one first,
 * then one in `grace`; otherwise the rejection for the first one's status,
 * or `none` when nothing matched.
 */
function choose<T extends CredentialRow>(rows: T[]): T | { rejected: string } {
  const statuses = rows.map((row) => nhiCredentialStatus(row, null));
  const index =
    statuses.indexOf('active') >= 0
      ? statuses.indexOf('active')
      : statuses.indexOf('grace');
  if (index >= 0) return rows[index];
  return statuses.length > 0
    ? { rejected: `credential_${statuses[0]}` }
    : { rejected: 'none' };
}
