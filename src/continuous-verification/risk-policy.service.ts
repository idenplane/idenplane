import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import type { Realm } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CacheService } from '../cache/cache.service.js';

const RISK_POLICY_CACHE_TTL = 60; // seconds

@Injectable()
export class RiskPolicyService {
  private readonly logger = new Logger(RiskPolicyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  async createPolicy(realm: Realm, dto: CreateContinuousRiskPolicyDto) {
    const existing = await this.prisma.continuousRiskPolicy.findFirst({
      where: {
        realmId: realm.id,
        clientId: dto.clientId ?? null,
        name: dto.name,
      },
    });
    if (existing) {
      throw new ConflictException(
        `Continuous risk policy '${dto.name}' already exists in this realm`,
      );
    }

    const policy = await this.prisma.continuousRiskPolicy.create({
      data: {
        realmId: realm.id,
        clientId: dto.clientId ?? null,
        name: dto.name,
        description: dto.description,
        enabled: dto.enabled ?? true,
        priority: dto.priority ?? 0,
        conditions: dto.conditions,
        action: dto.action ?? 'NO_ACTION',
        actionData: dto.actionData,
        riskScoreContribution: dto.riskScoreContribution ?? 0,
        cooldownSeconds: dto.cooldownSeconds ?? 300,
      },
    });

    await this.invalidatePolicyCache(realm.id);
    return policy;
  }

  async findAllPolicies(realm: Realm) {
    return this.prisma.continuousRiskPolicy.findMany({
      where: { realmId: realm.id },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async findPolicyById(realm: Realm, id: string) {
    const policy = await this.prisma.continuousRiskPolicy.findFirst({
      where: { id, realmId: realm.id },
    });
    if (!policy) {
      throw new NotFoundException(`Continuous risk policy '${id}' not found`);
    }
    return policy;
  }

  async updatePolicy(
    realm: Realm,
    id: string,
    dto: UpdateContinuousRiskPolicyDto,
  ) {
    await this.findPolicyById(realm, id);

    const updated = await this.prisma.continuousRiskPolicy.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        enabled: dto.enabled,
        priority: dto.priority,
        clientId: dto.clientId,
        conditions: dto.conditions,
        action: dto.action,
        actionData: dto.actionData as object | undefined,
        riskScoreContribution: dto.riskScoreContribution,
        cooldownSeconds: dto.cooldownSeconds,
      },
    });

    await this.invalidatePolicyCache(realm.id);
    return updated;
  }

  async deletePolicy(realm: Realm, id: string) {
    await this.findPolicyById(realm, id);
    await this.prisma.continuousRiskPolicy.delete({ where: { id } });
    await this.invalidatePolicyCache(realm.id);
  }

  // ─── Cache helpers ────────────────────────────────────────────────────────

  private policyListCacheKey(realmId: string): string {
    return `risk-policies:${realmId}`;
  }

  private async getCachedPolicies(realmId: string) {
    const cacheKey = this.policyListCacheKey(realmId);
    const cached = await this.cache.getCachedRealmConfig<unknown[]>(cacheKey);
    if (cached) return cached;

    const policies = await this.prisma.continuousRiskPolicy.findMany({
      where: { realmId: realmId },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });

    await this.cache.cacheRealmConfig(
      cacheKey,
      policies,
      RISK_POLICY_CACHE_TTL,
    );

    return policies;
  }

  private async invalidatePolicyCache(realmId: string): Promise<void> {
    const cacheKey = this.policyListCacheKey(realmId);
    await this.cache.invalidateRealmCache(cacheKey);
  }

  // ─── Toggle helpers ───────────────────────────────────────────────────────

  /**
   * Enable or disable a policy by id.  Returns the updated policy.
   */
  async togglePolicy(realm: Realm, id: string, enabled: boolean) {
    await this.findPolicyById(realm, id);

    const updated = await this.prisma.continuousRiskPolicy.update({
      where: { id },
      data: { enabled },
    });

    await this.invalidatePolicyCache(realm.id);
    return updated;
  }

  /**
   * Reorder priority for a policy, shifting others to maintain gaps.
   */
  async reorderPolicy(realm: Realm, id: string, newPriority: number) {
    await this.findPolicyById(realm, id);

    const updated = await this.prisma.continuousRiskPolicy.update({
      where: { id },
      data: { priority: newPriority },
    });

    await this.invalidatePolicyCache(realm.id);
    return updated;
  }
}

// ─── DTO types (kept in-file; a dedicated .dto.ts is optional) ───────────────

export interface CreateContinuousRiskPolicyDto {
  name: string;
  description?: string;
  clientId?: string;
  enabled?: boolean;
  priority?: number;
  conditions: object;
  action?: 'NO_ACTION' | 'STEP_UP' | 'TERMINATE' | 'NOTIFY';
  actionData?: object;
  riskScoreContribution?: number;
  cooldownSeconds?: number;
}

export interface UpdateContinuousRiskPolicyDto {
  name?: string;
  description?: string;
  clientId?: string | null;
  enabled?: boolean;
  priority?: number;
  conditions?: object;
  action?: 'NO_ACTION' | 'STEP_UP' | 'TERMINATE' | 'NOTIFY';
  actionData?: object | null;
  riskScoreContribution?: number;
  cooldownSeconds?: number;
}
