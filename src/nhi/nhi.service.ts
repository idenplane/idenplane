import { Prisma } from '@prisma/client';
import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type { Realm } from '@prisma/client';
import { generateCertificate, parseCertificateInfo } from './certificate.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { CreateNhiIdentityDto } from './dto/create-nhi.dto.js';
import { UpdateNhiIdentityDto } from './dto/update-nhi.dto.js';
import { CreateNhiCredentialDto } from './dto/create-nhi-credential.dto.js';
import {
  SetCertificateDto,
  CertificateInfoDto,
  GenerateCertificateDto,
  CertificateKeyAlgorithm,
} from './dto/certificate.dto.js';
import { CreateNhiCredentialPolicyDto } from './dto/create-nhi-credential-policy.dto.js';
import { UpdateNhiCredentialPolicyDto } from './dto/update-nhi-credential-policy.dto.js';
import {
  BulkRegistrationDto,
  BulkRegistrationResponseDto,
  BulkRegistrationResultItemDto,
} from './dto/bulk-registration.dto.js';

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
  // privateKeyPem is never returned: it is a secret the caller already holds.
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

const NHI_CREDENTIAL_POLICY_SELECT = {
  id: true,
  realmId: true,
  name: true,
  description: true,
  enabled: true,
  priority: true,
  credentialType: true,
  rotationIntervalDays: true,
  rotationBeforeDays: true,
  autoRotate: true,
  maxCredentialAgeDays: true,
  maxRequestsPerDay: true,
  maxRequestsPerMonth: true,
  rateLimitPerMinute: true,
  requireCertificate: true,
  requireIpRestriction: true,
  requireAuditLogging: true,
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
        metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
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
        metadata: dto.metadata as Prisma.InputJsonValue | undefined,
        tags: dto.tags,
        // Lifecycle management
        suspendedAt:
          dto.lifecycleStatus === 'SUSPENDED' ? new Date() : undefined,
        decommissionedAt:
          dto.lifecycleStatus === 'DECOMMISSIONED' ? new Date() : undefined,
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
      throw new ConflictException(
        'Only suspended identities can be reactivated',
      );
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
      data: {
        lifecycleStatus: 'DECOMMISSIONED',
        decommissionedAt: new Date(),
        enabled: false,
      },
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
        // Encrypted at rest; nothing reads it back.
        privateKeyPem: dto.privateKeyPem
          ? this.crypto.encrypt(dto.privateKeyPem)
          : undefined,
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

  async findCredentialById(
    realm: Realm,
    nhiIdentityId: string,
    credentialId: string,
  ) {
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
        name: oldCredential.name
          ? `${oldCredential.name} (rotated)`
          : 'rotated credential',
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

  // ── Credential Policy CRUD ───────────────────────────────────────────────────

  async createPolicy(realm: Realm, dto: CreateNhiCredentialPolicyDto) {
    const existing = await this.prisma.nhiCredentialPolicy.findUnique({
      where: { realmId_name: { realmId: realm.id, name: dto.name } },
    });
    if (existing) {
      throw new ConflictException(
        `Credential policy '${dto.name}' already exists in realm '${realm.name}'`,
      );
    }

    return this.prisma.nhiCredentialPolicy.create({
      data: {
        realmId: realm.id,
        name: dto.name,
        description: dto.description,
        enabled: dto.enabled ?? true,
        priority: dto.priority ?? 0,
        credentialType: dto.credentialType ?? 'API_KEY',
        rotationIntervalDays: dto.rotationIntervalDays ?? 90,
        rotationBeforeDays: dto.rotationBeforeDays ?? 7,
        autoRotate: dto.autoRotate ?? false,
        maxCredentialAgeDays: dto.maxCredentialAgeDays ?? 365,
        maxRequestsPerDay: dto.maxRequestsPerDay,
        maxRequestsPerMonth: dto.maxRequestsPerMonth,
        rateLimitPerMinute: dto.rateLimitPerMinute,
        requireCertificate: dto.requireCertificate ?? false,
        requireIpRestriction: dto.requireIpRestriction ?? false,
        requireAuditLogging: dto.requireAuditLogging ?? true,
      },
      select: NHI_CREDENTIAL_POLICY_SELECT,
    });
  }

  async listPolicies(realm: Realm) {
    return this.prisma.nhiCredentialPolicy.findMany({
      where: { realmId: realm.id },
      select: NHI_CREDENTIAL_POLICY_SELECT,
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findPolicyById(realm: Realm, policyId: string) {
    const policy = await this.prisma.nhiCredentialPolicy.findFirst({
      where: { id: policyId, realmId: realm.id },
      select: NHI_CREDENTIAL_POLICY_SELECT,
    });
    if (!policy) {
      throw new NotFoundException(`Credential policy '${policyId}' not found`);
    }
    return policy;
  }

  async updatePolicy(
    realm: Realm,
    policyId: string,
    dto: UpdateNhiCredentialPolicyDto,
  ) {
    await this.findPolicyById(realm, policyId);

    if (dto.name) {
      const conflict = await this.prisma.nhiCredentialPolicy.findUnique({
        where: { realmId_name: { realmId: realm.id, name: dto.name } },
      });
      if (conflict && conflict.id !== policyId) {
        throw new ConflictException(
          `Credential policy name '${dto.name}' already taken in realm '${realm.name}'`,
        );
      }
    }

    return this.prisma.nhiCredentialPolicy.update({
      where: { id: policyId },
      data: {
        name: dto.name,
        description: dto.description,
        enabled: dto.enabled,
        priority: dto.priority,
        credentialType: dto.credentialType,
        rotationIntervalDays: dto.rotationIntervalDays,
        rotationBeforeDays: dto.rotationBeforeDays,
        autoRotate: dto.autoRotate,
        maxCredentialAgeDays: dto.maxCredentialAgeDays,
        maxRequestsPerDay: dto.maxRequestsPerDay,
        maxRequestsPerMonth: dto.maxRequestsPerMonth,
        rateLimitPerMinute: dto.rateLimitPerMinute,
        requireCertificate: dto.requireCertificate,
        requireIpRestriction: dto.requireIpRestriction,
        requireAuditLogging: dto.requireAuditLogging,
      },
      select: NHI_CREDENTIAL_POLICY_SELECT,
    });
  }

  async removePolicy(realm: Realm, policyId: string) {
    await this.findPolicyById(realm, policyId);
    await this.prisma.nhiCredentialPolicy.delete({ where: { id: policyId } });
  }

  /**
   * Get the applicable credential policy for a given identity.
   * Returns the policy with highest priority (lowest number) that matches the identity's type.
   */
  async getApplicablePolicy(realm: Realm, nhiIdentityId: string) {
    const identity = await this.findById(realm, nhiIdentityId);

    const policies = await this.prisma.nhiCredentialPolicy.findMany({
      where: {
        realmId: realm.id,
        enabled: true,
        credentialType:
          identity.identityType === 'MACHINE_TO_MACHINE'
            ? 'API_KEY'
            : 'CERTIFICATE',
      },
      select: NHI_CREDENTIAL_POLICY_SELECT,
      orderBy: { priority: 'asc' },
      take: 1,
    });

    return policies[0] ?? null;
  }

  /**
   * Check if a credential requires rotation based on its policy.
   * Returns true if the credential should be rotated based on age or policy settings.
   */
  async isRotationRequired(
    realm: Realm,
    nhiIdentityId: string,
    credentialId: string,
  ) {
    await this.findCredentialById(realm, nhiIdentityId, credentialId);

    const policy = await this.getApplicablePolicy(realm, nhiIdentityId);
    if (!policy) {
      return false;
    }

    const credential = await this.prisma.nhiCredential.findFirst({
      where: { id: credentialId, nhiIdentityId },
    });

    if (!credential || credential.revoked || !credential.enabled) {
      return false;
    }

    // Check rotation required flag
    if (credential.rotationRequired) {
      return true;
    }

    // Check age-based rotation
    const createdAt = credential.createdAt;
    const rotationDate = new Date(createdAt);
    rotationDate.setDate(
      rotationDate.getDate() +
        policy.rotationIntervalDays -
        policy.rotationBeforeDays,
    );

    if (new Date() >= rotationDate) {
      return true;
    }

    // Check max age
    const maxAgeDate = new Date(createdAt);
    maxAgeDate.setDate(maxAgeDate.getDate() + policy.maxCredentialAgeDays);

    if (new Date() >= maxAgeDate) {
      return true;
    }

    return false;
  }

  /**
   * Get credentials that require rotation based on policy settings.
   */
  async getCredentialsRequiringRotation(realm: Realm) {
    const policies = await this.prisma.nhiCredentialPolicy.findMany({
      where: {
        realmId: realm.id,
        enabled: true,
        autoRotate: true,
      },
      select: {
        id: true,
        credentialType: true,
        rotationIntervalDays: true,
        rotationBeforeDays: true,
      },
    });

    const credentialsRequiringRotation: Array<{
      credentialId: string;
      nhiIdentityId: string;
      policyId: string;
      reason: string;
    }> = [];

    for (const policy of policies) {
      const credentialType = policy.credentialType;

      const credentials = await this.prisma.nhiCredential.findMany({
        where: {
          nhiIdentity: { realmId: realm.id },
          credentialType,
          revoked: false,
          enabled: true,
        },
        select: {
          id: true,
          nhiIdentityId: true,
          createdAt: true,
          rotationRequired: true,
        },
      });

      for (const credential of credentials) {
        // Check rotationRequired flag
        if (credential.rotationRequired) {
          credentialsRequiringRotation.push({
            credentialId: credential.id,
            nhiIdentityId: credential.nhiIdentityId,
            policyId: policy.id,
            reason: 'rotation_required_flag',
          });
          continue;
        }

        // Check age-based rotation
        const rotationDate = new Date(credential.createdAt);
        rotationDate.setDate(
          rotationDate.getDate() +
            policy.rotationIntervalDays -
            policy.rotationBeforeDays,
        );

        if (new Date() >= rotationDate) {
          credentialsRequiringRotation.push({
            credentialId: credential.id,
            nhiIdentityId: credential.nhiIdentityId,
            policyId: policy.id,
            reason: 'policy_threshold',
          });
        }
      }
    }

    return credentialsRequiringRotation;
  }

  // ── Certificate management ─────────────────────────────────────────────────

  /**
   * Set a certificate for an NHI identity.
   * Extracts certificate metadata (subject, fingerprint, validity dates) from the PEM.
   */
  async setCertificate(
    realm: Realm,
    nhiIdentityId: string,
    dto: SetCertificateDto,
  ) {
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
  validateCertificate(certificatePem: string): {
    valid: boolean;
    info?: CertificateInfoDto;
    error?: string;
  } {
    try {
      const info = this.parseCertificateInfo(certificatePem);
      const now = new Date();
      const notBefore = new Date(info.notBefore);
      const notAfter = new Date(info.notAfter);

      if (now < notBefore) {
        return {
          valid: false,
          error: 'Certificate is not yet valid (notBefore is in the future)',
        };
      }
      if (now > notAfter) {
        return { valid: false, error: 'Certificate has expired' };
      }

      return { valid: true, info };
    } catch (error) {
      return {
        valid: false,
        error:
          error instanceof Error ? error.message : 'Invalid certificate format',
      };
    }
  }

  /**
   * Generate a self-signed device certificate.
   *
   * This method creates a new key pair (RSA or ECDSA) and generates a
   * self-signed X.509 certificate for device authentication.
   */
  async generateDeviceCertificate(
    _realm: Realm,
    dto: GenerateCertificateDto,
  ): Promise<{
    certificatePem: string;
    privateKeyPem: string;
    info: CertificateInfoDto;
  }> {
    try {
      return await generateCertificate(dto);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Certificate generation failed',
      );
    }
  }

  /**
   * Parse certificate information from a PEM-encoded certificate.
   * Reads metadata from the encoded X.509 certificate.
   */
  private parseCertificateInfo(certificatePem: string): CertificateInfoDto {
    try {
      return parseCertificateInfo(certificatePem);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid certificate format',
      );
    }
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

    const totalRequests = credentials.reduce(
      (sum, c) => sum + c.requestCount,
      0,
    );

    return {
      nhiIdentityId,
      totalRequests,
      lastActiveAt: stats.lastActiveAt,
      credentials,
    };
  }

  // ── Rotation policy management ───────────────────────────────────────────────

  /**
   * Get rotation status for all credentials under a specific policy.
   * Returns detailed status for each credential including days until rotation.
   */
  async getPolicyRotationStatus(realm: Realm, policyId: string) {
    const policy = await this.findPolicyById(realm, policyId);

    const credentials = await this.prisma.nhiCredential.findMany({
      where: {
        nhiIdentity: { realmId: realm.id },
        credentialType: policy.credentialType,
        revoked: false,
        enabled: true,
      },
      select: {
        id: true,
        nhiIdentityId: true,
        name: true,
        credentialType: true,
        createdAt: true,
        rotationRequired: true,
      },
    });

    const now = new Date();
    const statuses = credentials.map((cred) => {
      const rotationDate = new Date(cred.createdAt);
      rotationDate.setDate(
        rotationDate.getDate() +
          policy.rotationIntervalDays -
          policy.rotationBeforeDays,
      );
      const daysUntilRotation = Math.ceil(
        (rotationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );

      const maxAgeDate = new Date(cred.createdAt);
      maxAgeDate.setDate(maxAgeDate.getDate() + policy.maxCredentialAgeDays);
      const daysUntilForcedRotation = Math.ceil(
        (maxAgeDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );

      const rotationRequired =
        cred.rotationRequired ||
        daysUntilRotation <= 0 ||
        daysUntilForcedRotation <= 0;

      const reason = cred.rotationRequired
        ? 'rotation_required_flag'
        : daysUntilRotation <= 0
          ? 'policy_threshold'
          : daysUntilForcedRotation <= 0
            ? 'max_age_exceeded'
            : null;

      return {
        credential: {
          credentialId: cred.id,
          nhiIdentityId: cred.nhiIdentityId,
          name: cred.name,
          credentialType: cred.credentialType,
          createdAt: cred.createdAt,
          reason: reason ?? 'pending',
          policyId: policy.id,
          daysUntilRotation:
            daysUntilRotation > 0 ? daysUntilRotation : undefined,
        },
        rotationRequired,
        applicablePolicy: {
          id: policy.id,
          name: policy.name,
          rotationIntervalDays: policy.rotationIntervalDays,
          autoRotate: policy.autoRotate,
        },
        daysUntilForcedRotation:
          daysUntilForcedRotation > 0 ? daysUntilForcedRotation : undefined,
        daysUntilRotationWarning:
          daysUntilRotation > 0 ? daysUntilRotation : undefined,
      };
    });

    return {
      policyId: policy.id,
      policyName: policy.name,
      credentialType: policy.credentialType,
      totalCredentials: credentials.length,
      credentialsRequiringRotation: statuses.filter((s) => s.rotationRequired)
        .length,
      statuses,
    };
  }

  /**
   * Get summary of all credentials requiring rotation in the realm.
   * Aggregates rotation status across all policies.
   */
  async getRotationStatusSummary(realm: Realm) {
    const policies = await this.prisma.nhiCredentialPolicy.findMany({
      where: { realmId: realm.id, enabled: true },
      select: {
        id: true,
        name: true,
        credentialType: true,
        rotationIntervalDays: true,
        rotationBeforeDays: true,
        maxCredentialAgeDays: true,
        autoRotate: true,
      },
    });

    const now = new Date();
    let totalRequiringRotation = 0;
    let dueForRotation = 0;
    let mustRotate = 0;
    let autoRotateEnabled = 0;

    const policySummaries = await Promise.all(
      policies.map(async (policy) => {
        const credentials = await this.prisma.nhiCredential.findMany({
          where: {
            nhiIdentity: { realmId: realm.id },
            credentialType: policy.credentialType,
            revoked: false,
            enabled: true,
          },
          select: {
            id: true,
            createdAt: true,
            rotationRequired: true,
          },
        });

        let requiringRotation = 0;
        let due = 0;
        let must = 0;

        for (const cred of credentials) {
          const rotationDate = new Date(cred.createdAt);
          rotationDate.setDate(
            rotationDate.getDate() +
              policy.rotationIntervalDays -
              policy.rotationBeforeDays,
          );
          const daysUntilRotation = Math.ceil(
            (rotationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
          );

          const maxAgeDate = new Date(cred.createdAt);
          maxAgeDate.setDate(
            maxAgeDate.getDate() + policy.maxCredentialAgeDays,
          );
          const daysUntilForcedRotation = Math.ceil(
            (maxAgeDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
          );

          const isDue = daysUntilRotation <= 0;
          const isMust = daysUntilForcedRotation <= 0;

          if (cred.rotationRequired || isDue || isMust) {
            requiringRotation++;
          }
          if (isDue) due++;
          if (isMust) must++;

          if (policy.autoRotate) autoRotateEnabled++;
        }

        totalRequiringRotation += requiringRotation;
        dueForRotation += due;
        mustRotate += must;

        return {
          policyId: policy.id,
          policyName: policy.name,
          credentialType: policy.credentialType,
          totalCredentials: credentials.length,
          credentialsRequiringRotation: requiringRotation,
          dueForRotation: due,
          mustRotate: must,
        };
      }),
    );

    return {
      totalRequiringRotation,
      dueForRotation,
      mustRotate,
      autoRotateEnabled,
      policies: policySummaries,
    };
  }

  // ── Bulk registration ─────────────────────────────────────────────────────────

  /**
   * Register multiple devices in bulk for fleet management.
   * Creates NHI identities for each device and optionally generates certificates.
   */
  async bulkRegistration(
    realm: Realm,
    dto: BulkRegistrationDto,
  ): Promise<BulkRegistrationResponseDto> {
    const maxItems = dto.maxItems ?? 1000;
    const devicesToProcess = dto.devices.slice(0, maxItems);
    const results: BulkRegistrationResultItemDto[] = [];

    for (const device of devicesToProcess) {
      const result: BulkRegistrationResultItemDto = {
        name: device.name,
        id: '',
        success: false,
      };

      try {
        // Check for existing identity
        const existing = await this.prisma.nhiIdentity.findUnique({
          where: { realmId_name: { realmId: realm.id, name: device.name } },
        });

        if (existing) {
          result.id = existing.id;
          result.success = false;
          result.error = 'NHI identity already exists';
          results.push(result);
          continue;
        }

        // Create the NHI identity
        const identity = await this.prisma.nhiIdentity.create({
          data: {
            realmId: realm.id,
            identityType: 'IOT_DEVICE',
            name: device.name,
            description: device.description,
            enabled: device.enabled ?? true,
            lifecycleStatus: 'PROVISIONING',
            permissionScopes: device.permissionScopes ?? [],
            metadata: (device.metadata ?? {}) as Prisma.InputJsonValue,
            tags: device.tags ?? [],
          },
          select: NHI_IDENTITY_SELECT,
        });

        result.id = identity.id;
        result.metadata = (identity.metadata ?? undefined) as
          Record<string, unknown> | undefined;
        result.success = true;

        // Generate certificate if requested
        if (device.generateCertificate) {
          const keyAlgorithm = this.parseKeyAlgorithm(
            device.certificateKeyAlgorithm,
          );
          const validityDays = device.certificateValidityDays ?? 365;

          const certDto: GenerateCertificateDto = {
            name: device.name,
            subjectCommonName: device.name,
            subjectOrganizationalUnit: device.environment,
            keyAlgorithm: keyAlgorithm,
            validityDays: validityDays,
          };

          const certResult = await this.generateDeviceCertificate(
            realm,
            certDto,
          );
          result.certificatePem = certResult.certificatePem;
          result.privateKeyPem = certResult.privateKeyPem;
          result.certificateInfo = {
            subject: certResult.info.subject,
            issuer: certResult.info.issuer,
            notBefore: certResult.info.notBefore,
            notAfter: certResult.info.notAfter,
            fingerprint: certResult.info.fingerprint,
            isCA: certResult.info.isCA,
            sans: certResult.info.sans,
          };
        }

        results.push(result);
      } catch (error) {
        result.success = false;
        result.error = error instanceof Error ? error.message : 'Unknown error';
        results.push(result);
      }
    }

    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    const response: BulkRegistrationResponseDto = {
      total: dto.devices.length,
      successful,
      failed,
      results,
    };

    if (failed > 0) {
      response.warning = `${failed} device(s) failed to register`;
    }

    return response;
  }

  /**
   * Parse key algorithm string to CertificateKeyAlgorithm enum.
   */
  private parseKeyAlgorithm(algorithm?: string): CertificateKeyAlgorithm {
    switch (algorithm?.toUpperCase()) {
      case 'RSA_2048':
        return CertificateKeyAlgorithm.RSA_2048;
      case 'RSA_4096':
        return CertificateKeyAlgorithm.RSA_4096;
      case 'ECDSA_P384':
        return CertificateKeyAlgorithm.ECDSA_P384;
      case 'ECDSA_P256':
      default:
        return CertificateKeyAlgorithm.ECDSA_P256;
    }
  }
}
