import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Realm } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { ClientsService } from '../clients/clients.service.js';
import {
  CertificatePemError,
  normalizeSerial,
  parseSingleCertificatePem,
  summarizeCertificate,
  type CertificateSummary,
} from '../client-auth/certificate-pem.js';
import { isCaCertificate } from '../client-auth/certificate-checks.js';
import {
  canonicalDn,
  certificateNames,
  DistinguishedNameError,
  parseDerName,
  parseRfc4514,
} from '../client-auth/distinguished-name.js';
import type { CreateRevokedCertificateDto } from './dto/tls-admin.dto.js';

/** Live certificates one client may register (rotation needs at least two). */
const MAX_CLIENT_CERTIFICATES = 10;
const MAX_TRUST_ANCHORS = 50;

const CLIENT_CERT_SELECT = {
  id: true,
  x5tS256: true,
  subject: true,
  notBefore: true,
  notAfter: true,
  createdAt: true,
} as const;

const ANCHOR_SELECT = {
  id: true,
  x5tS256: true,
  subject: true,
  notAfter: true,
  createdAt: true,
} as const;

function readCertificate(pem: unknown): CertificateSummary {
  try {
    return summarizeCertificate(parseSingleCertificatePem(pem));
  } catch (err) {
    if (err instanceof CertificatePemError) {
      throw new BadRequestException(err.message);
    }
    if (err instanceof DistinguishedNameError) {
      throw new BadRequestException(`certificatePem: ${err.message}`);
    }
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === 'P2002';
}

/**
 * The admin side of RFC 8705 client authentication: certificates registered
 * for `self_signed_tls_client_auth`, a realm's trust anchors for
 * `tls_client_auth`, and its certificate deny-list.
 */
@Injectable()
export class TlsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
  ) {}

  // ─── Client certificates ───────────────────────────────────────────────

  private async clientRow(realm: Realm, clientIdOrUuid: string) {
    const client = await this.clients.findByClientId(realm, clientIdOrUuid);
    return { id: client.id, clientId: client.clientId };
  }

  /** An NHI-backed client's certificates are its identity's credentials. */
  private async assertNotNhiBacked(clientDbId: string): Promise<void> {
    const row = await this.prisma.client.findUnique({
      where: { id: clientDbId },
      select: { nhiIdentityId: true },
    });
    if (row?.nhiIdentityId) {
      throw new ConflictException(
        "This client is the OAuth client of an NHI identity; register its certificates as the identity's credentials",
      );
    }
  }

  async listClientCertificates(realm: Realm, clientIdOrUuid: string) {
    const client = await this.clientRow(realm, clientIdOrUuid);
    return this.prisma.clientTlsCertificate.findMany({
      where: { clientId: client.id, realmId: realm.id },
      select: CLIENT_CERT_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  async getClientCertificate(realm: Realm, clientIdOrUuid: string, id: string) {
    const client = await this.clientRow(realm, clientIdOrUuid);
    const row = await this.prisma.clientTlsCertificate.findFirst({
      where: { id, clientId: client.id, realmId: realm.id },
      select: { ...CLIENT_CERT_SELECT, certificatePem: true },
    });
    if (!row) throw new NotFoundException('Certificate not found');
    return row;
  }

  async addClientCertificate(
    realm: Realm,
    clientIdOrUuid: string,
    pem: string,
  ) {
    const client = await this.clientRow(realm, clientIdOrUuid);
    await this.assertNotNhiBacked(client.id);
    const certificate = readCertificate(pem);
    if (certificate.notAfter.getTime() <= Date.now()) {
      throw new BadRequestException('The certificate has expired');
    }
    const count = await this.prisma.clientTlsCertificate.count({
      where: { clientId: client.id },
    });
    if (count >= MAX_CLIENT_CERTIFICATES) {
      throw new ConflictException(
        `A client can register at most ${MAX_CLIENT_CERTIFICATES} certificates`,
      );
    }
    try {
      return await this.prisma.clientTlsCertificate.create({
        data: {
          clientId: client.id,
          realmId: realm.id,
          x5tS256: certificate.x5tS256,
          certificatePem: certificate.pem,
          subject: certificate.subject,
          notBefore: certificate.notBefore,
          notAfter: certificate.notAfter,
        },
        select: CLIENT_CERT_SELECT,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          'This certificate is already registered for the client',
        );
      }
      throw err;
    }
  }

  async removeClientCertificate(
    realm: Realm,
    clientIdOrUuid: string,
    id: string,
  ): Promise<void> {
    const client = await this.clientRow(realm, clientIdOrUuid);
    const { count } = await this.prisma.clientTlsCertificate.deleteMany({
      where: { id, clientId: client.id, realmId: realm.id },
    });
    if (count === 0) throw new NotFoundException('Certificate not found');
  }

  // ─── Trust anchors ─────────────────────────────────────────────────────

  listTrustAnchors(realm: Realm) {
    return this.prisma.realmTlsTrustAnchor.findMany({
      where: { realmId: realm.id },
      select: ANCHOR_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  async getTrustAnchor(realm: Realm, id: string) {
    const row = await this.prisma.realmTlsTrustAnchor.findFirst({
      where: { id, realmId: realm.id },
      select: { ...ANCHOR_SELECT, certificatePem: true },
    });
    if (!row) throw new NotFoundException('Trust anchor not found');
    return row;
  }

  async addTrustAnchor(realm: Realm, pem: string) {
    const certificate = readCertificate(pem);
    const problem = isCaCertificate(parseSingleCertificatePem(pem));
    if (problem) {
      throw new BadRequestException(`Not a usable trust anchor: ${problem}`);
    }
    if (certificate.notAfter.getTime() <= Date.now()) {
      throw new BadRequestException('The certificate has expired');
    }
    const count = await this.prisma.realmTlsTrustAnchor.count({
      where: { realmId: realm.id },
    });
    if (count >= MAX_TRUST_ANCHORS) {
      throw new ConflictException(
        `A realm can have at most ${MAX_TRUST_ANCHORS} trust anchors`,
      );
    }
    try {
      return await this.prisma.realmTlsTrustAnchor.create({
        data: {
          realmId: realm.id,
          certificatePem: certificate.pem,
          subject: certificate.subject,
          x5tS256: certificate.x5tS256,
          notAfter: certificate.notAfter,
        },
        select: ANCHOR_SELECT,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('This trust anchor is already present');
      }
      throw err;
    }
  }

  async removeTrustAnchor(realm: Realm, id: string): Promise<void> {
    const { count } = await this.prisma.realmTlsTrustAnchor.deleteMany({
      where: { id, realmId: realm.id },
    });
    if (count === 0) throw new NotFoundException('Trust anchor not found');
  }

  // ─── Deny-list ─────────────────────────────────────────────────────────

  listRevoked(realm: Realm) {
    return this.prisma.tlsRevokedCertificate.findMany({
      where: { realmId: realm.id },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getRevoked(realm: Realm, id: string) {
    const row = await this.prisma.tlsRevokedCertificate.findFirst({
      where: { id, realmId: realm.id },
    });
    if (!row) throw new NotFoundException('Deny-list entry not found');
    return row;
  }

  async addRevoked(realm: Realm, dto: CreateRevokedCertificateDto) {
    let x5tS256 = dto.x5tS256 ?? null;
    let issuerDn: string | null = null;
    let serialNumber: string | null = null;

    if (dto.certificatePem !== undefined) {
      const certificate = readCertificate(dto.certificatePem);
      if (dto.x5tS256 && dto.x5tS256 !== certificate.x5tS256) {
        throw new BadRequestException(
          'x5tS256 does not match the certificate; send one or the other',
        );
      }
      x5tS256 = certificate.x5tS256;
      const der = parseSingleCertificatePem(dto.certificatePem).raw;
      issuerDn = canonicalDn(parseDerName(certificateNames(der).issuer));
      serialNumber = certificate.serialNumber || null;
    }
    if (dto.issuerDn !== undefined || dto.serialNumber !== undefined) {
      if (dto.certificatePem !== undefined) {
        throw new BadRequestException(
          'Send certificatePem, or issuerDn with serialNumber, not both',
        );
      }
      if (!dto.issuerDn || !dto.serialNumber) {
        throw new BadRequestException('issuerDn and serialNumber go together');
      }
      try {
        const parsed = parseRfc4514(dto.issuerDn);
        if (parsed.length === 0) throw new DistinguishedNameError('empty');
        issuerDn = canonicalDn(parsed);
      } catch (err) {
        if (err instanceof DistinguishedNameError) {
          throw new BadRequestException(
            `issuerDn is not an RFC 4514 distinguished name: ${err.message}`,
          );
        }
        throw err;
      }
      serialNumber = normalizeSerial(dto.serialNumber) ?? null;
      if (!serialNumber) {
        throw new BadRequestException('serialNumber must be hexadecimal');
      }
    }
    if (!x5tS256 && !(issuerDn && serialNumber)) {
      throw new BadRequestException(
        'Name the certificate: certificatePem, x5tS256, or issuerDn with serialNumber',
      );
    }
    return this.prisma.tlsRevokedCertificate.create({
      data: {
        realmId: realm.id,
        x5tS256,
        issuerDn,
        serialNumber,
        reason: dto.reason ?? null,
      },
    });
  }

  async removeRevoked(realm: Realm, id: string): Promise<void> {
    const { count } = await this.prisma.tlsRevokedCertificate.deleteMany({
      where: { id, realmId: realm.id },
    });
    if (count === 0) throw new NotFoundException('Deny-list entry not found');
  }
}
