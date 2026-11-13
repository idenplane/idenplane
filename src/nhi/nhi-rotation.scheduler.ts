import { Injectable, Logger } from '@nestjs/common';
import { LeaderService } from '../cache/leader.service.js';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import type { Realm } from '@prisma/client';

/** How many credentials to process per scheduler tick per realm. */
const BATCH_SIZE = 50;

/**
 * NhiRotationScheduler: enforces NHI credential rotation policies.
 *
 * A policy with `autoRotate: true` says a credential must be rotated once it
 * is `rotationIntervalDays - rotationBeforeDays` old. The server cannot hand
 * a new secret to a workload it has no channel to, so it does not replace the
 * key itself (an earlier version did: it revoked the working key and stored a
 * new one that nobody could ever learn). Instead, when a credential comes due
 * it is flagged `rotationRequired` and an `nhi.credential.rotation_due`
 * webhook is sent, once. The owner then rotates it through the API
 * (`POST .../credentials/:id/rotate`), which returns the new key.
 *
 * Runs on the elected leader only (LeaderService); the flag is set with a
 * conditional update, so the event is sent once even across a failover.
 */
@Injectable()
export class NhiRotationScheduler {
  private readonly logger = new Logger(NhiRotationScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhooksService,
    private readonly leader: LeaderService,
  ) {}

  // ─── Scheduler tick ───────────────────────────────────────────────────────

  @Interval(60_000) // every 60 seconds
  async processRotations(): Promise<void> {
    // Once per cluster: two processes would each rotate the same credential.
    if (!this.leader.isLeader()) return;
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
          realmId: realm.id,
          credentialType: policy.credentialType,
          revoked: false,
          enabled: true,
          rotatedAt: null,
          supersededById: null,
          rotationRequired: false,
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
        if (this.isDueForRotation(realm, cred, policy)) {
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
  private isDueForRotation(
    _realm: Realm,
    credential: { createdAt: Date; rotationRequired: boolean },
    policy: { rotationIntervalDays: number; rotationBeforeDays: number },
  ): boolean {
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

  // ─── Flagging ────────────────────────────────────────────────────────────

  private async rotateCredentialItem(
    realm: Realm,
    item: {
      credentialId: string;
      nhiIdentityId: string;
      policyId: string;
      reason: string;
    },
  ): Promise<void> {
    try {
      // The flag flips once: a credential already flagged (by an earlier
      // tick, an admin or another leader) is not announced again.
      const { count } = await this.prisma.nhiCredential.updateMany({
        where: {
          id: item.credentialId,
          realmId: realm.id,
          revoked: false,
          rotationRequired: false,
        },
        data: { rotationRequired: true },
      });
      if (count === 0) return;
      await this.webhooks.dispatchEvent({
        realmId: realm.id,
        eventType: 'nhi.credential.rotation_due',
        payload: {
          credentialId: item.credentialId,
          nhiIdentityId: item.nhiIdentityId,
          policyId: item.policyId,
        },
      });
      this.logger.log(
        `Credential '${item.credentialId}' of identity '${item.nhiIdentityId}' in realm '${realm.name}' is due for rotation`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to flag credential '${item.credentialId}' for rotation: ${(err as Error).message}`,
      );
    }
  }
}
