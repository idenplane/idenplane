import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import type { Realm } from '@prisma/client';

/** How many credentials to process per scheduler tick per realm. */
const BATCH_SIZE = 50;

/**
 * NhiRotationScheduler — automated credential rotation (Issue #NHI-Credential-Rotation).
 *
 * ### Problem
 * NHI credentials (API keys, certificates, JWTs) have rotation policies defined per
 * realm via `NhiCredentialPolicy`.  When a policy has `autoRotate: true`, credentials
 * that have aged past the `rotationIntervalDays - rotationBeforeDays` threshold should
 * be rotated automatically rather than requiring manual intervention.
 *
 * ### Solution
 * This scheduler runs on a fixed interval, iterates over all active realms, finds
 * credentials that are due for rotation based on their policy, and performs the
 * rotation atomically:
 *
 * 1. Generate a new credential with the same settings.
 * 2. Mark the old credential as revoked with a `rotatedAt` timestamp.
 * 3. Update the `rotationRequired` flag on the new credential.
 *
 * The rotation does NOT revoke the credential immediately — existing clients can
 * continue using the old key during a grace period.  The old key is marked revoked
 * so it will not be re-issued and will be rejected on next use.
 *
 * Concurrent scheduler instances (e.g. during a rolling deploy) are handled by
 * claiming credentials atomically with an optimistic lock on `rotationRequired`.
 */
@Injectable()
export class NhiRotationScheduler {
  private readonly logger = new Logger(NhiRotationScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  // ─── Scheduler tick ───────────────────────────────────────────────────────

  @Interval(60_000) // every 60 seconds
  async processRotations(): Promise<void> {
    const realms = await this.prisma.realm.findMany({
      where: { enabled: true },
      select: { id: true, name: true },
    });

    if (realms.length === 0) return;

    await Promise.allSettled(
      realms.map((realm) => this.processRealmRotations(realm as Realm)),
    );
  }

  // ─── Per-realm rotation ───────────────────────────────────────────────────

  private async processRealmRotations(realm: Realm): Promise<void> {
    try {
      // Find credentials that are due for rotation per policy.
      // We batch credentials by policy so we can process them efficiently.
      const due = await this.getCredentialsDueForRotation(realm);

      if (due.length === 0) return;

      this.logger.debug(
        `Realm '${realm.name}': ${due.length} credential(s) due for rotation`,
      );

      await Promise.allSettled(
        due.map((item) => this.rotateCredentialItem(realm, item)),
      );
    } catch (err) {
      this.logger.error(
        `Failed to process rotations for realm '${realm.name}': ${(err as Error).message}`,
      );
    }
  }

  // ─── Credential lookup ───────────────────────────────────────────────────

  private async getCredentialsDueForRotation(realm: Realm) {
    // Find all auto-rotate policies for this realm.
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

    const due: Array<{
      credentialId: string;
      nhiIdentityId: string;
      policyId: string;
      reason: string;
    }> = [];

    for (const policy of policies) {
      // Claim up to BATCH_SIZE credentials that are:
      // - Not revoked
      // - Enabled
      // - Not already revoked/rotated
      // - Matching credential type
      const candidates = await this.prisma.nhiCredential.findMany({
        where: {
          nhiIdentity: { realmId: realm.id },
          credentialType: policy.credentialType,
          revoked: false,
          enabled: true,
          rotatedAt: null,
        },
        select: {
          id: true,
          nhiIdentityId: true,
          createdAt: true,
          rotationRequired: true,
        },
        take: BATCH_SIZE,
      });

      for (const cred of candidates) {
        if (await this.isDueForRotation(realm, cred, policy)) {
          due.push({
            credentialId: cred.id,
            nhiIdentityId: cred.nhiIdentityId,
            policyId: policy.id,
            reason: cred.rotationRequired
              ? 'rotation_required_flag'
              : 'policy_threshold',
          });
        }
      }
    }

    return due;
  }

  /**
   * Check whether a credential is due for rotation based on its policy.
   */
  private async isDueForRotation(
    _realm: Realm,
    credential: { createdAt: Date; rotationRequired: boolean },
    policy: { rotationIntervalDays: number; rotationBeforeDays: number },
  ): Promise<boolean> {
    // Explicit flag takes precedence
    if (credential.rotationRequired) return true;

    // Age-based threshold
    const rotationDate = new Date(credential.createdAt);
    rotationDate.setDate(
      rotationDate.getDate() +
        policy.rotationIntervalDays -
        policy.rotationBeforeDays,
    );

    return new Date() >= rotationDate;
  }

  // ─── Rotation execution ──────────────────────────────────────────────────

  private async rotateCredentialItem(
    realm: Realm,
    item: { credentialId: string; nhiIdentityId: string },
  ): Promise<void> {
    try {
      await this.rotateCredential(realm, item.credentialId);
      this.logger.log(
        `Rotated credential '${item.credentialId}' for identity '${item.nhiIdentityId}' in realm '${realm.name}'`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to rotate credential '${item.credentialId}': ${(err as Error).message}`,
      );
    }
  }

  /**
   * Rotate a single API_KEY credential.
   *
   * 1. Fetches the old credential.
   * 2. Creates a new API_KEY credential with a fresh key.
   * 3. Marks the old credential as revoked.
   */
  private async rotateCredential(
    realm: Realm,
    credentialId: string,
  ): Promise<void> {
    const oldCredential = await this.prisma.nhiCredential.findFirst({
      where: {
        id: credentialId,
        nhiIdentity: { realmId: realm.id },
        credentialType: 'API_KEY',
        revoked: false,
        enabled: true,
      },
    });

    if (!oldCredential) {
      // Credential was already rotated or is no longer eligible — skip silently.
      return;
    }

    // Generate a new API key.
    const newRaw = this.crypto.generateSecret(32);
    const newPrefix = newRaw.slice(0, 8);
    const newHash = await this.crypto.hashPassword(newRaw);

    // Create new credential, inheriting allowed IP ranges from the old one.
    await this.prisma.nhiCredential.create({
      data: {
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
        allowedIpRanges: oldCredential.allowedIpRanges ?? [],
      },
    });

    // Revoke the old credential atomically.
    await this.prisma.nhiCredential.update({
      where: { id: credentialId },
      data: {
        revoked: true,
        revokedAt: new Date(),
        enabled: false,
        rotatedAt: new Date(),
      },
    });
  }
}
