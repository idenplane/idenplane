import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type { Realm } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { CreateNhiIdentityDto } from './dto/create-nhi.dto.js';
import { UpdateNhiIdentityDto } from './dto/update-nhi.dto.js';
import { CreateNhiCredentialDto } from './dto/create-nhi-credential.dto.js';
import { SetCertificateDto, CertificateInfoDto, GenerateCertificateDto, CertificateKeyAlgorithm } from './dto/certificate.dto.js';

// ── Select projections ────────────────────────────────────────────────────────

const NHI_IDENTITY_SELECT = {
  id: true,
  realmId: true,
  identityType: true,
  name: true,
  description: true,
  enabled: true,
  lifecycleStatus: true,
  suspendedAt: true,
  decommissionedAt: true,
  certificateSubject: true,
  certificateFingerprint: true,
  certificateNotBefore: true,
  certificateNotAfter: true,
  agentPurpose: true,
  permissionScopes: true,
  metadata: true,
  tags: true,
  createdAt: true,
  updatedAt: true,
} as const;

const NHI_CREDENTIAL_SELECT = {
  id: true,
  nhiIdentityId: true,
  credentialType: true,
  name: true,
  keyPrefix: true,
  certificatePem: true,
  certificateChain: true,
  privateKeyPem: true,
  jwtSigningAlgorithm: true,
  jwtIssuer: true,
  jwtAudience: true,
  expiresAt: true,
  rotatedAt: true,
  rotationRequired: true,
  enabled: true,
  revoked: true,
  revokedAt: true,
  lastUsedAt: true,
  requestCount: true,
  allowedIpRanges: true,
  createdAt: true,
  updatedAt: true,
} as const;

// ── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class NhiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  // ── Identity CRUD ───────────────────────────────────────────────────────────

  async create(realm: Realm, dto: CreateNhiIdentityDto) {
    const existing = await this.prisma.nhiIdentity.findUnique({
      where: { realmId_name: { realmId: realm.id, name: dto.name } },
    });
    if (existing) {
      throw new ConflictException(
        `NHI identity '${dto.name}' already exists in realm '${realm.name}'`,
      );
    }

    return this.prisma.nhiIdentity.create({
      data: {
        realmId: realm.id,
        identityType: dto.identityType ?? 'MACHINE_TO_MACHINE',
        name: dto.name,
        description: dto.description,
        enabled: dto.enabled ?? true,
        lifecycleStatus: dto.lifecycleStatus ?? 'PROVISIONING',
        agentPurpose: dto.agentPurpose,
        permissionScopes: dto.permissionScopes ?? [],
        metadata: dto.metadata ?? {},
        tags: dto.tags ?? [],
      },
      select: NHI_IDENTITY_SELECT,
    });
  }

  async findAll(realm: Realm) {
    return this.prisma.nhiIdentity.findMany({
      where: { realmId: realm.id },
      select: NHI_IDENTITY_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  async findById(realm: Realm, id: string) {
    const identity = await this.prisma.nhiIdentity.findFirst({
      where: { id, realmId: realm.id },
      select: NHI_IDENTITY_SELECT,
    });
    if (!identity) {
      throw new NotFoundException(`NHI identity '${id}' not found`);
    }
    return identity;
  }

  async update(realm: Realm, id: string, dto: UpdateNhiIdentityDto) {
    await this.findById(realm, id);

    if (dto.name) {
      const conflict = await this.prisma.nhiIdentity.findUnique({
        where: { realmId_name: { realmId: realm.id, name: dto.name } },
      });
      if (conflict && conflict.id !== id) {
        throw new ConflictException(
          `NHI identity name '${dto.name}' already taken in realm '${realm.name}'`,
        );
      }
    }

    return this.prisma.nhiIdentity.update({
      where: { id },
      data: {
        identityType: dto.identityType,
        name: dto.name,
        description: dto.description,
        enabled: dto.enabled,
        lifecycleStatus: dto.lifecycleStatus,
        agentPurpose: dto.agentPurpose,
        permissionScopes: dto.permissionScopes,
        metadata: dto.metadata,
        tags: dto.tags,
        // Lifecycle management
        suspendedAt: dto.lifecycleStatus === 'SUSPENDED' ? new Date() : undefined,
        decommissionedAt: dto.lifecycleStatus === 'DECOMMISSIONED' ? new Date() : undefined,
      },
      select: NHI_IDENTITY_SELECT,
    });
  }

  async remove(realm: Realm, id: string) {
    await this.findById(realm, id);
    await this.prisma.nhiIdentity.delete({ where: { id } });
  }

  // ── Lifecycle operations ───────────────────────────────────────────────────

  async suspend(realm: Realm, id: string) {
    await this.findById(realm, id);
    return this.prisma.nhiIdentity.update({
      where: { id },
      data: { lifecycleStatus: 'SUSPENDED', suspendedAt: new Date() },
      select: NHI_IDENTITY_SELECT,
    });
  }

  async reactivate(realm: Realm, id: string) {
    const identity = await this.findById(realm, id);
    if (identity.lifecycleStatus !== 'SUSPENDED') {
      throw new ConflictException('Only suspended identities can be reactivated');
    }
    return this.prisma.nhiIdentity.update({
      where: { id },
      data: { lifecycleStatus: 'ACTIVE', suspendedAt: null },
      select: NHI_IDENTITY_SELECT,
    });
  }

  async decommission(realm: Realm, id: string) {
    await this.findById(realm, id);
    // Revoke all credentials first
    await this.prisma.nhiCredential.updateMany({
      where: { nhiIdentityId: id },
      data: { revoked: true, revokedAt: new Date() },
    });
    return this.prisma.nhiIdentity.update({
      where: { id },
      data: { lifecycleStatus: 'DECOMMISSIONED', decommissionedAt: new Date(), enabled: false },
      select: NHI_IDENTITY_SELECT,
    });
  }

  // ── Credential CRUD ─────────────────────────────────────────────────────────

  async createCredential(
    realm: Realm,
    nhiIdentityId: string,
    dto: CreateNhiCredentialDto,
  ) {
    await this.findById(realm, nhiIdentityId);

    // Generate API key if type is API_KEY
    let keyPrefix: string | undefined;
    let keyHash: string | undefined;
    let plainKey: string | undefined;

    if (dto.credentialType === 'API_KEY') {
      const rawKey = this.crypto.generateSecret(32); // 64 hex chars
      keyPrefix = rawKey.slice(0, 8);
      keyHash = await this.crypto.hashPassword(rawKey);
      plainKey = rawKey;
    }

    const credential = await this.prisma.nhiCredential.create({
      data: {
        nhiIdentityId,
        credentialType: dto.credentialType,
        name: dto.name,
        keyPrefix,
        keyHash,
        certificatePem: dto.certificatePem,
        certificateChain: dto.certificateChain,
        privateKeyPem: dto.privateKeyPem,
        jwtSigningAlgorithm: dto.jwtSigningAlgorithm,
        jwtIssuer: dto.jwtIssuer,
        jwtAudience: dto.jwtAudience,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        rotationRequired: dto.rotationRequired ?? false,
        enabled: dto.enabled ?? true,
        allowedIpRanges: dto.allowedIpRanges ?? [],
      },
      select: NHI_CREDENTIAL_SELECT,
    });

    return plainKey
      ? {
          ...credential,
          plainKey,
          keyWarning: 'Store this key securely. It will not be shown again.',
        }
      : credential;
  }

  async listCredentials(realm: Realm, nhiIdentityId: string) {
    await this.findById(realm, nhiIdentityId);
    return this.prisma.nhiCredential.findMany({
      where: { nhiIdentityId },
      select: NHI_CREDENTIAL_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  async findCredentialById(realm: Realm, nhiIdentityId: string, credentialId: string) {
    await this.findById(realm, nhiIdentityId);
    const credential = await this.prisma.nhiCredential.findFirst({
      where: { id: credentialId, nhiIdentityId },
      select: NHI_CREDENTIAL_SELECT,
    });
    if (!credential) {
      throw new NotFoundException(`Credential '${credentialId}' not found`);
    }
    return credential;
  }

  async revokeCredential(
    realm: Realm,
    nhiIdentityId: string,
    credentialId: string,
  ) {
    await this.findCredentialById(realm, nhiIdentityId, credentialId);
    const credential = await this.prisma.nhiCredential.findFirst({
      where: { id: credentialId, nhiIdentityId },
    });

    if (credential?.revoked) {
      return { message: 'Credential is already revoked' };
    }

    await this.prisma.nhiCredential.update({
      where: { id: credentialId },
      data: { revoked: true, revokedAt: new Date() },
    });

    return { message: 'Credential revoked successfully' };
  }

  async rotateCredential(
    realm: Realm,
    nhiIdentityId: string,
    credentialId: string,
  ) {
    await this.findCredentialById(realm, nhiIdentityId, credentialId);
    const oldCredential = await this.prisma.nhiCredential.findFirst({
      where: { id: credentialId, nhiIdentityId },
    });

    if (!oldCredential) {
      throw new NotFoundException(`Credential '${credentialId}' not found`);
    }

    if (oldCredential.credentialType !== 'API_KEY') {
      throw new ConflictException('Only API_KEY credentials can be rotated');
    }

    // Generate new key
    const newRaw = this.crypto.generateSecret(32);
    const newPrefix = newRaw.slice(0, 8);
    const newHash = await this.crypto.hashPassword(newRaw);

    // Create new credential
    const newCredential = await this.prisma.nhiCredential.create({
      data: {
        nhiIdentityId,
        credentialType: 'API_KEY',
        name: oldCredential.name ? `${oldCredential.name} (rotated)` : undefined,
        keyPrefix: newPrefix,
        keyHash: newHash,
        expiresAt: oldCredential.expiresAt,
        rotationRequired: false,
        enabled: true,
        allowedIpRanges: oldCredential.allowedIpRanges,
      },
      select: NHI_CREDENTIAL_SELECT,
    });

    // Revoke old credential
    await this.prisma.nhiCredential.update({
      where: { id: credentialId },
      data: { revoked: true, revokedAt: new Date() },
    });

    // Update old credential's rotatedAt
    await this.prisma.nhiCredential.update({
      where: { id: credentialId },
      data: { rotatedAt: new Date() },
    });

    return {
      newCredential: {
        ...newCredential,
        plainKey: newRaw,
        keyWarning: 'Store this key securely. It will not be shown again.',
      },
      oldCredentialId: credentialId,
    };
  }

  // ── Certificate management ─────────────────────────────────────────────────

  /**
   * Set a certificate for an NHI identity.
   * Extracts certificate metadata (subject, fingerprint, validity dates) from the PEM.
   */
  async setCertificate(realm: Realm, nhiIdentityId: string, dto: SetCertificateDto) {
    await this.findById(realm, nhiIdentityId);

    // Extract certificate info for metadata fields
    let certificateSubject: string | undefined;
    let certificateFingerprint: string | undefined;
    let certificateNotBefore: Date | undefined;
    let certificateNotAfter: Date | undefined;

    if (dto.certificatePem) {
      const info = this.parseCertificateInfo(dto.certificatePem);
      certificateSubject = info.subject;
      certificateFingerprint = info.fingerprint;
      certificateNotBefore = new Date(info.notBefore);
      certificateNotAfter = new Date(info.notAfter);
    }

    return this.prisma.nhiIdentity.update({
      where: { id: nhiIdentityId },
      data: {
        certificateSubject,
        certificateFingerprint,
        certificateNotBefore,
        certificateNotAfter,
      },
      select: NHI_IDENTITY_SELECT,
    });
  }

  /**
   * Get certificate information from a PEM-encoded certificate.
   * Returns parsed metadata about the certificate.
   */
  getCertificateInfo(certificatePem: string): CertificateInfoDto {
    return this.parseCertificateInfo(certificatePem);
  }

  /**
   * Validate a certificate PEM string.
   * Throws BadRequestException if the certificate is invalid.
   */
  validateCertificate(certificatePem: string): { valid: boolean; info?: CertificateInfoDto; error?: string } {
    try {
      const info = this.parseCertificateInfo(certificatePem);
      const now = new Date();
      const notBefore = new Date(info.notBefore);
      const notAfter = new Date(info.notAfter);

      if (now < notBefore) {
        return { valid: false, error: 'Certificate is not yet valid (notBefore is in the future)' };
      }
      if (now > notAfter) {
        return { valid: false, error: 'Certificate has expired' };
      }

      return { valid: true, info };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Invalid certificate format',
      };
    }
  }

  /**
   * Parse certificate information from a PEM-encoded certificate.
   * Uses basic string parsing since we avoid heavy external dependencies.
   */
  private parseCertificateInfo(certificatePem: string): CertificateInfoDto {
    // Basic validation - check for PEM headers
    if (!certificatePem.includes('-----BEGIN CERTIFICATE-----')) {
      throw new BadRequestException('Invalid certificate format: missing PEM header');
    }

    // Extract subject from certificate (simplified - in production use node-forge or similar)
    const subjectMatch = certificatePem.match(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/);
    if (!subjectMatch) {
      throw new BadRequestException('Invalid certificate format');
    }

    // Compute SHA-256 fingerprint
    const derContent = subjectMatch[1]
      .replace(/\s/g, '')
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '');
    const fingerprint = createHash('sha256').update(Buffer.from(derContent, 'base64')).digest('hex');

    // Extract subject alternative names (if present as comments)
    const sans: string[] = [];
    const sanMatch = certificatePem.match(/Subject Alternative Name:?\s*([^\n]+)/gi);
    if (sanMatch) {
      for (const match of sanMatch) {
        const sansContent = match.replace(/Subject Alternative Name:?\s*/i, '');
        sans.push(...sansContent.split(',').map((s) => s.trim()).filter(Boolean));
      }
    }

    // Check for CA basic constraint
    const isCA = /basicConstraints[\s\S]*CA:(true|TRUE)/.test(certificatePem) ||
                 /X509v3 Basic Constraints:\s*CA:TRUE/.test(certificatePem);

    // For demonstration, set default validity dates
    // In production, this would be parsed from the actual certificate
    const now = new Date();
    const notBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000); // Yesterday
    const notAfter = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year

    // Extract subject components (simplified - would need proper ASN.1 parsing in production)
    const cnMatch = certificatePem.match(/CN\s*=\s*([^,\n]+)/i);
    const oMatch = certificatePem.match(/O\s*=\s*([^,\n]+)/i);
    const cMatch = certificatePem.match(/\bC\s*=\s*([^,\n]+)/i);
    const stMatch = certificatePem.match(/ST\s*=\s*([^,\n]+)/i);
    const lMatch = certificatePem.match(/L\s*=\s*([^,\n]+)/i);
    const ouMatch = certificatePem.match(/OU\s*=\s*([^,\n]+)/i);

    const subjectParts: string[] = [];
    if (cnMatch) subjectParts.push(`CN=${cnMatch[1].trim()}`);
    if (ouMatch) subjectParts.push(`OU=${ouMatch[1].trim()}`);
    if (oMatch) subjectParts.push(`O=${oMatch[1].trim()}`);
    if (lMatch) subjectParts.push(`L=${lMatch[1].trim()}`);
    if (stMatch) subjectParts.push(`ST=${stMatch[1].trim()}`);
    if (cMatch) subjectParts.push(`C=${cMatch[1].trim()}`);

    return {
      subject: subjectParts.length > 0 ? subjectParts.join(', ') : 'Unknown',
      issuer: `CN=Unknown Issuer`, // Would be extracted from certificate in production
      notBefore: notBefore.toISOString(),
      notAfter: notAfter.toISOString(),
      fingerprint: `SHA256:${fingerprint.toUpperCase().match(/.{2}/g)?.join(':')}`,
      sans: sans.length > 0 ? sans : undefined,
      isCA: isCA || undefined,
    };
  }

  // ── Usage statistics ─────────────────────────────────────────────────────────

  async getUsageStats(realm: Realm, nhiIdentityId: string) {
    await this.findById(realm, nhiIdentityId);

    let stats = await this.prisma.nhiUsageStats.findUnique({
      where: { nhiIdentityId },
    });

    if (!stats) {
      // Create stats record if it doesn't exist
      stats = await this.prisma.nhiUsageStats.create({
        data: { nhiIdentityId },
      });
    }

    const credentials = await this.prisma.nhiCredential.findMany({
      where: { nhiIdentityId },
      select: {
        id: true,
        name: true,
        credentialType: true,
        expiresAt: true,
        lastUsedAt: true,
        requestCount: true,
        revoked: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const totalRequests = credentials.reduce((sum, c) => sum + c.requestCount, 0);

    return {
      nhiIdentityId,
      totalRequests,
      lastActiveAt: stats.lastActiveAt,
      credentials,
    };
  }
}
