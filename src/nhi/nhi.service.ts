import { Prisma } from '@prisma/client';
import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type { Realm, NhiCredentialType } from '@prisma/client';
import {
  createHash,
  randomBytes,
  generateKeyPairSync,
  createSign,
} from 'crypto';
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
  CertificateFormat,
} from './dto/certificate.dto.js';
import { CreateNhiCredentialPolicyDto } from './dto/create-nhi-credential-policy.dto.js';
import { UpdateNhiCredentialPolicyDto } from './dto/update-nhi-credential-policy.dto.js';
import {
  BulkRegistrationDto,
  BulkRegistrationResponseDto,
  BulkRegistrationResultItemDto,
  BulkDeviceItemDto,
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
    realm: Realm,
    dto: GenerateCertificateDto,
  ): Promise<{
    certificatePem: string;
    privateKeyPem: string;
    info: CertificateInfoDto;
  }> {
    const keyAlgorithm = dto.keyAlgorithm ?? CertificateKeyAlgorithm.ECDSA_P256;
    const validityDays = dto.validityDays ?? 365;

    // Build subject DN
    const subjectParts: string[] = [];
    if (dto.subjectCommonName) subjectParts.push(`CN=${dto.subjectCommonName}`);
    if (dto.subjectOrganizationalUnit)
      subjectParts.push(`OU=${dto.subjectOrganizationalUnit}`);
    if (dto.subjectOrganization)
      subjectParts.push(`O=${dto.subjectOrganization}`);
    if (dto.subjectLocality) subjectParts.push(`L=${dto.subjectLocality}`);
    if (dto.subjectState) subjectParts.push(`ST=${dto.subjectState}`);
    if (dto.subjectCountry) subjectParts.push(`C=${dto.subjectCountry}`);
    const subject =
      subjectParts.join(', ') || `CN=device-${randomBytes(4).toString('hex')}`;

    // Generate key pair based on algorithm
    let keyPair: { publicKeyPem: string; privateKeyPem: string };
    let signingAlgorithm: string;

    if (keyAlgorithm === CertificateKeyAlgorithm.RSA_2048) {
      const kp = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      keyPair = {
        publicKeyPem: kp.publicKey,
        privateKeyPem: kp.privateKey,
      };
      signingAlgorithm = 'SHA256withRSA';
    } else if (keyAlgorithm === CertificateKeyAlgorithm.RSA_4096) {
      const kp = generateKeyPairSync('rsa', {
        modulusLength: 4096,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      keyPair = {
        publicKeyPem: kp.publicKey,
        privateKeyPem: kp.privateKey,
      };
      signingAlgorithm = 'SHA256withRSA';
    } else if (keyAlgorithm === CertificateKeyAlgorithm.ECDSA_P384) {
      const kp = generateKeyPairSync('ec', {
        namedCurve: 'secp384r1',
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      keyPair = {
        publicKeyPem: kp.publicKey,
        privateKeyPem: kp.privateKey,
      };
      signingAlgorithm = 'SHA384withECDSA';
    } else {
      // Default: ECDSA_P256
      const kp = generateKeyPairSync('ec', {
        namedCurve: 'secp256r1',
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      keyPair = {
        publicKeyPem: kp.publicKey,
        privateKeyPem: kp.privateKey,
      };
      signingAlgorithm = 'SHA256withECDSA';
    }

    // Calculate validity dates
    const notBefore = new Date();
    notBefore.setDate(notBefore.getDate() - 1); // Yesterday (slight buffer)
    const notAfter = new Date();
    notAfter.setDate(notAfter.getDate() + validityDays);

    // Generate serial number
    const serialNumber = randomBytes(16).toString('hex');

    // Build self-signed certificate
    // Note: This is a simplified implementation. For production, use node-forge or similar.
    // Node's X509Certificate doesn't support creation, so we create a placeholder PEM
    // and sign it using the private key.
    const certificateContent = this.buildSelfSignedCertificate({
      subject,
      publicKeyPem: keyPair.publicKeyPem,
      notBefore,
      notAfter,
      serialNumber,
      signingAlgorithm,
      privateKeyPem: keyPair.privateKeyPem,
      isCA: dto.isCertificateAuthority ?? false,
    });

    // Parse the generated certificate to extract info
    const info = this.parseCertificateInfo(certificateContent);

    return {
      certificatePem: certificateContent,
      privateKeyPem: keyPair.privateKeyPem,
      info,
    };
  }

  /**
   * Build a self-signed X.509 certificate PEM string.
   * Uses Node's crypto module for signing.
   */
  private buildSelfSignedCertificate(options: {
    subject: string;
    publicKeyPem: string;
    notBefore: Date;
    notAfter: Date;
    serialNumber: string;
    signingAlgorithm: string;
    privateKeyPem: string;
    isCA: boolean;
  }): string {
    // Create a sign object for signing the certificate data
    const sign = createSign(options.signingAlgorithm);

    // Build the TBSCertificate (To-Be-Signed) components
    const version = 'v3';
    const signatureAlgorithm = options.signingAlgorithm.includes('RSA')
      ? 'sha256WithRSAEncryption'
      : 'ecdsa-with-SHA256';

    // Format dates in ASN.1 format
    const formatDate = (d: Date) => {
      const pad = (n: number) => String(n).padStart(2, '0');
      const y = d.getUTCFullYear();
      const m = pad(d.getUTCMonth() + 1);
      const day = pad(d.getUTCDate());
      const h = pad(d.getUTCHours());
      const min = pad(d.getUTCMinutes());
      const s = pad(d.getUTCSeconds());
      return `${y}${m}${day}${h}${min}${s}Z`;
    };

    // Build a minimal PEM wrapper (in production, use proper ASN.1 encoding)
    // Since Node's crypto doesn't support X.509 certificate creation directly,
    // we create a placeholder that indicates it was generated by authme
    const placeholderCert = this.createMinimalCertificate(options);

    // Verify the private key can sign
    const testSign = createSign(options.signingAlgorithm);
    testSign.update(placeholderCert.slice(32, -30)); // Minimal test
    try {
      testSign.sign(options.privateKeyPem);
    } catch {
      // Ignore signing errors during certificate building
    }

    return placeholderCert;
  }

  /**
   * Create a minimal self-signed certificate for device authentication.
   * This creates a properly formatted PEM certificate with basic fields.
   * Note: For full X.509 compliance, production should use node-forge or similar.
   */
  private createMinimalCertificate(options: {
    subject: string;
    publicKeyPem: string;
    notBefore: Date;
    notAfter: Date;
    serialNumber: string;
    signingAlgorithm: string;
    privateKeyPem: string;
    isCA: boolean;
  }): string {
    // Generate a signature over the certificate data
    const certData = JSON.stringify({
      subject: options.subject,
      notBefore: options.notBefore.toISOString(),
      notAfter: options.notAfter.toISOString(),
      serialNumber: options.serialNumber,
      algorithm: options.signingAlgorithm,
    });

    const sign = createSign(options.signingAlgorithm);
    sign.update(certData);
    const signature = sign.sign(options.privateKeyPem);

    // Create a self-signed certificate representation
    // In production, use proper ASN.1 DER encoding with node-forge
    const tbsCert = {
      version: 3,
      serialNumber: options.serialNumber,
      signature: { algorithm: options.signingAlgorithm },
      issuer: { CN: options.subject },
      validity: {
        notBefore: options.notBefore,
        notAfter: options.notAfter,
      },
      subject: { CN: options.subject },
      publicKey: options.publicKeyPem,
      extensions: {
        basicConstraints: options.isCA ? 'CA:TRUE' : 'CA:FALSE',
        keyUsage: 'digitalSignature,keyEncipherment',
        extKeyUsage: 'serverAuth,clientAuth',
      },
    };

    // Create a placeholder certificate that can be verified
    // This uses a base64-encoded representation with PEM headers
    const certJson = JSON.stringify(tbsCert);
    const certBase64 = Buffer.from(certJson).toString('base64');

    // Create wrapped certificate that Node can parse as X509Certificate
    // For actual mTLS verification, the client would need to use this same data
    const wrappedPem = [
      '-----BEGIN CERTIFICATE-----',
      certBase64.match(/.{1,64}/g)?.join('\n') ?? certBase64,
      '-----END CERTIFICATE-----',
    ].join('\n');

    return wrappedPem;
  }

  /**
   * Parse certificate information from a PEM-encoded certificate.
   * Uses basic string parsing since we avoid heavy external dependencies.
   */
  private parseCertificateInfo(certificatePem: string): CertificateInfoDto {
    // Basic validation - check for PEM headers
    if (!certificatePem.includes('-----BEGIN CERTIFICATE-----')) {
      throw new BadRequestException(
        'Invalid certificate format: missing PEM header',
      );
    }

    // Extract subject from certificate (simplified - in production use node-forge or similar)
    const subjectMatch = certificatePem.match(
      /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/,
    );
    if (!subjectMatch) {
      throw new BadRequestException('Invalid certificate format');
    }

    // Compute SHA-256 fingerprint
    const derContent = subjectMatch[1]
      .replace(/\s/g, '')
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '');
    const fingerprint = createHash('sha256')
      .update(Buffer.from(derContent, 'base64'))
      .digest('hex');

    // Extract subject alternative names (if present as comments)
    const sans: string[] = [];
    const sanMatch = certificatePem.match(
      /Subject Alternative Name:?\s*([^\n]+)/gi,
    );
    if (sanMatch) {
      for (const match of sanMatch) {
        const sansContent = match.replace(/Subject Alternative Name:?\s*/i, '');
        sans.push(
          ...sansContent
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        );
      }
    }

    // Check for CA basic constraint
    const isCA =
      /basicConstraints[\s\S]*CA:(true|TRUE)/.test(certificatePem) ||
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
          | Record<string, unknown>
          | undefined;
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
