import { Prisma } from '@prisma/client';
import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type {
  NhiCredential,
  NhiCredentialType,
  NhiLifecycleStatus,
  Realm,
} from '@prisma/client';
import { generateCertificate, parseCertificateInfo } from './certificate.js';
import { configuredRules } from '../client-auth/certificate-checks.js';
import {
  isCertificateCredentialType,
  liveCertificateCredentialFilter,
  MAX_LIVE_CERTIFICATE_CREDENTIALS,
  nhiCredentialStatus,
} from './nhi-credential-status.js';
import {
  assertNoTlsFields,
  certificateCredentialFields,
  DEFAULT_ROTATION_OVERLAP_SECONDS,
  pickRules,
  withStatus,
} from './nhi-certificate-credential.js';
import { RotateNhiCredentialDto } from './dto/rotate-nhi-credential.dto.js';
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
  realmId: true,
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
  tlsAuthMode: true,
  certThumbprintS256: true,
  certSubject: true,
  certIssuer: true,
  certSerialNumber: true,
  certNotBefore: true,
  certNotAfter: true,
  tlsClientAuthSubjectDn: true,
  tlsClientAuthSanDns: true,
  tlsClientAuthSanUri: true,
  tlsClientAuthSanIp: true,
  tlsClientAuthSanEmail: true,
  supersededById: true,
  rotationGraceUntil: true,
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
  rotationOverlapSeconds: true,
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
      where: { id, realmId: realm.id },
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

  /**
   * Deletes the identity. Its credentials, and its OAuth client if it has
   * one, go with it (foreign keys cascade; the client cache is invalidated
   * by the database's change notifications).
   */
  async remove(realm: Realm, id: string) {
    await this.findById(realm, id);
    await this.prisma.nhiIdentity.delete({ where: { id, realmId: realm.id } });
  }

  // ── Lifecycle operations ───────────────────────────────────────────────────

  async suspend(realm: Realm, id: string) {
    await this.findById(realm, id);
    return this.prisma.nhiIdentity.update({
      where: { id, realmId: realm.id },
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
      where: { id, realmId: realm.id },
      data: { lifecycleStatus: 'ACTIVE', suspendedAt: null },
      select: NHI_IDENTITY_SELECT,
    });
  }

  async decommission(realm: Realm, id: string) {
    await this.findById(realm, id);
    // Revoke all credentials first
    await this.prisma.nhiCredential.updateMany({
      where: { nhiIdentityId: id, realmId: realm.id },
      data: { revoked: true, revokedAt: new Date() },
    });
    return this.prisma.nhiIdentity.update({
      where: { id, realmId: realm.id },
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
    const identity = await this.findById(realm, nhiIdentityId);
    const credentialType =
      dto.credentialType ?? (dto.tlsAuthMode ? 'CERTIFICATE' : undefined);

    if (credentialType && isCertificateCredentialType(credentialType)) {
      return this.createCertificateCredential(realm, identity, {
        ...dto,
        credentialType,
      });
    }
    if (dto.tlsAuthMode) {
      throw new BadRequestException(
        'tlsAuthMode needs credentialType CERTIFICATE or MTLS',
      );
    }
    assertNoTlsFields(dto);

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
        realmId: realm.id,
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

    const result = withStatus(credential, identity);
    return plainKey
      ? {
          ...result,
          plainKey,
          keyWarning: 'Store this key securely. It will not be shown again.',
        }
      : result;
  }

  /**
   * A CERTIFICATE or MTLS credential. Such a credential holds a certificate,
   * never a private key. With a `tlsAuthMode` it authenticates the
   * identity's OAuth client (RFC 8705): SELF_SIGNED pins `certificatePem` by
   * its x5t#S256; PKI names one subject/SAN rule for certificates issued
   * under the realm's trust anchors. The live-certificate cap and duplicate
   * check run with the identity row locked, so concurrent uploads cannot
   * exceed them.
   */
  private async createCertificateCredential(
    realm: Realm,
    identity: {
      id: string;
      enabled: boolean;
      lifecycleStatus: NhiLifecycleStatus;
    },
    dto: CreateNhiCredentialDto & { credentialType: NhiCredentialType },
  ) {
    if (dto.privateKeyPem !== undefined) {
      throw new BadRequestException(
        'A certificate credential never takes a private key; upload the certificate only',
      );
    }
    if (dto.certificateChain !== undefined && dto.tlsAuthMode) {
      throw new BadRequestException(
        'certificateChain is not used for client authentication; the client presents its chain in the TLS handshake',
      );
    }
    const fields = certificateCredentialFields(dto.tlsAuthMode ?? null, dto);
    const data = {
      realmId: realm.id,
      nhiIdentityId: identity.id,
      credentialType: dto.credentialType,
      name: dto.name,
      certificateChain: dto.certificateChain,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      rotationRequired: dto.rotationRequired ?? false,
      enabled: dto.enabled ?? true,
      allowedIpRanges: dto.allowedIpRanges ?? [],
      ...fields,
    };

    if (!dto.tlsAuthMode) {
      const credential = await this.createUniqueName(() =>
        this.prisma.nhiCredential.create({
          data,
          select: NHI_CREDENTIAL_SELECT,
        }),
      );
      return withStatus(credential, identity);
    }

    const credential = await this.createUniqueName(() =>
      this.prisma.$transaction(async (tx) => {
        await this.lockIdentity(tx, realm, identity.id);
        await this.assertCertificateCapacity(
          tx,
          realm,
          identity.id,
          fields.certThumbprintS256 ?? null,
        );
        return tx.nhiCredential.create({
          data,
          select: NHI_CREDENTIAL_SELECT,
        });
      }),
    );
    return withStatus(credential, identity);
  }

  /** Runs a create, answering a taken credential name with 409. */
  private async createUniqueName<T>(create: () => Promise<T>): Promise<T> {
    try {
      return await create();
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') {
        throw new ConflictException(
          'The identity already has a credential with this name',
        );
      }
      throw err;
    }
  }

  /**
   * Locks the identity row for the rest of the transaction, so the
   * live-certificate count and the write after it cannot interleave with
   * another upload or rotation for the same identity.
   */
  private async lockIdentity(
    tx: Prisma.TransactionClient,
    realm: Realm,
    nhiIdentityId: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "nhi_identities"
       WHERE "id" = ${nhiIdentityId} AND "realm_id" = ${realm.id}
       FOR UPDATE`;
    if (rows.length === 0) {
      throw new NotFoundException(`NHI identity '${nhiIdentityId}' not found`);
    }
  }

  /**
   * An identity holds at most MAX_LIVE_CERTIFICATE_CREDENTIALS live
   * certificate credentials (a credential in its rotation grace period
   * counts), and a certificate at most once among them.
   */
  private async assertCertificateCapacity(
    tx: Prisma.TransactionClient,
    realm: Realm,
    nhiIdentityId: string,
    thumbprint: string | null,
  ): Promise<void> {
    const live = liveCertificateCredentialFilter(new Date());
    const count = await tx.nhiCredential.count({
      where: { realmId: realm.id, nhiIdentityId, ...live },
    });
    if (count >= MAX_LIVE_CERTIFICATE_CREDENTIALS) {
      throw new ConflictException(
        `An identity can hold at most ${MAX_LIVE_CERTIFICATE_CREDENTIALS} live certificate credentials; revoke one first`,
      );
    }
    if (thumbprint) {
      const duplicate = await tx.nhiCredential.count({
        where: {
          realmId: realm.id,
          nhiIdentityId,
          certThumbprintS256: thumbprint,
          ...live,
        },
      });
      if (duplicate > 0) {
        throw new ConflictException(
          'This certificate is already registered for the identity',
        );
      }
    }
  }

  async listCredentials(realm: Realm, nhiIdentityId: string) {
    const identity = await this.findById(realm, nhiIdentityId);
    const credentials = await this.prisma.nhiCredential.findMany({
      where: { nhiIdentityId, realmId: realm.id },
      select: NHI_CREDENTIAL_SELECT,
      orderBy: { createdAt: 'asc' },
    });
    return credentials.map((credential) => withStatus(credential, identity));
  }

  async findCredentialById(
    realm: Realm,
    nhiIdentityId: string,
    credentialId: string,
  ) {
    const identity = await this.findById(realm, nhiIdentityId);
    const credential = await this.prisma.nhiCredential.findFirst({
      where: { id: credentialId, nhiIdentityId, realmId: realm.id },
      select: NHI_CREDENTIAL_SELECT,
    });
    if (!credential) {
      throw new NotFoundException(`Credential '${credentialId}' not found`);
    }
    return withStatus(credential, identity);
  }

  async revokeCredential(
    realm: Realm,
    nhiIdentityId: string,
    credentialId: string,
  ) {
    const credential = await this.findCredentialById(
      realm,
      nhiIdentityId,
      credentialId,
    );

    if (credential.revoked) {
      return { message: 'Credential is already revoked' };
    }

    await this.prisma.nhiCredential.update({
      where: { id: credentialId, realmId: realm.id },
      data: { revoked: true, revokedAt: new Date() },
    });

    return { message: 'Credential revoked successfully' };
  }

  /**
   * Rotates a credential.
   *
   * - API_KEY: a new key replaces the old one, which is revoked at once (as
   *   before). The new key is returned once.
   * - A certificate credential with a `tlsAuthMode`: a new credential with
   *   the new certificate (SELF_SIGNED) or rule (PKI; the old rule when none
   *   is given) is created, and the old one keeps authenticating until
   *   `rotationGraceUntil` = now + overlap. The overlap is `overlapSeconds`
   *   when given, else the applicable policy's `rotationOverlapSeconds`,
   *   else DEFAULT_ROTATION_OVERLAP_SECONDS.
   *
   * Either way it runs in one transaction. A certificate credential that was
   * already rotated or revoked cannot be rotated (409).
   */
  async rotateCredential(
    realm: Realm,
    nhiIdentityId: string,
    credentialId: string,
    dto: RotateNhiCredentialDto = {},
  ) {
    const identity = await this.findById(realm, nhiIdentityId);
    const oldCredential = await this.prisma.nhiCredential.findFirst({
      where: { id: credentialId, nhiIdentityId, realmId: realm.id },
    });

    if (!oldCredential) {
      throw new NotFoundException(`Credential '${credentialId}' not found`);
    }

    if (oldCredential.credentialType === 'API_KEY') {
      return this.rotateApiKey(realm, oldCredential);
    }
    if (
      isCertificateCredentialType(oldCredential.credentialType) &&
      oldCredential.tlsAuthMode
    ) {
      return this.rotateCertificate(realm, identity, oldCredential, dto);
    }
    throw new ConflictException(
      'Only API_KEY credentials and certificate credentials with a tlsAuthMode can be rotated',
    );
  }

  private async rotateApiKey(realm: Realm, oldCredential: NhiCredential) {
    // A rotated key was revoked and replaced; its replacement is the one to
    // rotate. (Rotating it again would also collide on the "(rotated)" name.)
    if (oldCredential.rotatedAt) {
      throw new ConflictException(
        'This API key was already rotated; rotate its replacement instead',
      );
    }
    // Generate new key
    const newRaw = this.crypto.generateSecret(32);
    const newPrefix = newRaw.slice(0, 8);
    const newHash = await this.crypto.hashPassword(newRaw);

    const newCredential = await this.createUniqueName(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.nhiCredential.create({
          data: {
            realmId: realm.id,
            nhiIdentityId: oldCredential.nhiIdentityId,
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
        // The old key stops working now.
        const now = new Date();
        await tx.nhiCredential.update({
          where: { id: oldCredential.id, realmId: realm.id },
          data: { revoked: true, revokedAt: now, rotatedAt: now },
        });
        return created;
      }),
    );

    return {
      newCredential: {
        ...newCredential,
        plainKey: newRaw,
        keyWarning: 'Store this key securely. It will not be shown again.',
      },
      oldCredentialId: oldCredential.id,
    };
  }

  private async rotateCertificate(
    realm: Realm,
    identity: {
      id: string;
      enabled: boolean;
      lifecycleStatus: NhiLifecycleStatus;
    },
    oldCredential: NhiCredential,
    dto: RotateNhiCredentialDto,
  ) {
    if (oldCredential.revoked) {
      throw new ConflictException('A revoked credential cannot be rotated');
    }
    if (oldCredential.supersededById) {
      throw new ConflictException(
        'This credential was already rotated; rotate its replacement instead',
      );
    }
    const mode = oldCredential.tlsAuthMode!;
    const input =
      mode === 'PKI' && configuredRules(dto).length === 0
        ? { ...dto, ...pickRules(oldCredential) }
        : dto;
    const fields = certificateCredentialFields(mode, input);
    const overlapSeconds =
      dto.overlapSeconds ??
      (await this.rotationOverlapSeconds(realm, oldCredential.credentialType));

    const now = new Date();
    const graceUntil = new Date(now.getTime() + overlapSeconds * 1000);
    const newCredential = await this.createUniqueName(() =>
      this.prisma.$transaction(async (tx) => {
        await this.lockIdentity(tx, realm, identity.id);
        await this.assertCertificateCapacity(
          tx,
          realm,
          identity.id,
          fields.certThumbprintS256 ?? null,
        );
        const created = await tx.nhiCredential.create({
          data: {
            realmId: realm.id,
            nhiIdentityId: identity.id,
            credentialType: oldCredential.credentialType,
            name:
              dto.name ??
              `${oldCredential.name} (rotated ${now.toISOString()})`,
            expiresAt: oldCredential.expiresAt,
            rotationRequired: false,
            enabled: true,
            allowedIpRanges: oldCredential.allowedIpRanges,
            ...fields,
          },
          select: NHI_CREDENTIAL_SELECT,
        });
        // Conditional: a concurrent rotation of the same credential, or a
        // revocation, makes this one fail and roll back.
        const { count } = await tx.nhiCredential.updateMany({
          where: {
            id: oldCredential.id,
            realmId: realm.id,
            supersededById: null,
            revoked: false,
          },
          data: {
            supersededById: created.id,
            rotationGraceUntil: graceUntil,
            rotatedAt: now,
            rotationRequired: false,
          },
        });
        if (count !== 1) {
          throw new ConflictException(
            'The credential was rotated or revoked meanwhile',
          );
        }
        return created;
      }),
    );

    return {
      newCredential: withStatus(newCredential, identity),
      oldCredentialId: oldCredential.id,
      oldCredential: {
        id: oldCredential.id,
        supersededById: newCredential.id,
        rotationGraceUntil: graceUntil,
        status: nhiCredentialStatus(
          {
            ...oldCredential,
            supersededById: newCredential.id,
            rotationGraceUntil: graceUntil,
          },
          identity,
          now,
        ),
      },
    };
  }

  /**
   * The overlap of the realm's highest-priority enabled policy for this
   * credential type, else DEFAULT_ROTATION_OVERLAP_SECONDS.
   */
  private async rotationOverlapSeconds(
    realm: Realm,
    credentialType: NhiCredentialType,
  ): Promise<number> {
    const policy = await this.prisma.nhiCredentialPolicy.findFirst({
      where: { realmId: realm.id, enabled: true, credentialType },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      select: { rotationOverlapSeconds: true },
    });
    return policy?.rotationOverlapSeconds ?? DEFAULT_ROTATION_OVERLAP_SECONDS;
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
        rotationOverlapSeconds:
          dto.rotationOverlapSeconds ?? DEFAULT_ROTATION_OVERLAP_SECONDS,
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
      where: { id: policyId, realmId: realm.id },
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
        rotationOverlapSeconds: dto.rotationOverlapSeconds,
      },
      select: NHI_CREDENTIAL_POLICY_SELECT,
    });
  }

  async removePolicy(realm: Realm, policyId: string) {
    await this.findPolicyById(realm, policyId);
    await this.prisma.nhiCredentialPolicy.delete({
      where: { id: policyId, realmId: realm.id },
    });
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
      where: { id: credentialId, nhiIdentityId, realmId: realm.id },
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
          realmId: realm.id,
          credentialType,
          revoked: false,
          enabled: true,
          supersededById: null,
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
      where: { id: nhiIdentityId, realmId: realm.id },
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
      where: { nhiIdentityId, realmId: realm.id },
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
        realmId: realm.id,
        credentialType: policy.credentialType,
        revoked: false,
        enabled: true,
        supersededById: null,
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
            realmId: realm.id,
            credentialType: policy.credentialType,
            revoked: false,
            enabled: true,
            supersededById: null,
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
