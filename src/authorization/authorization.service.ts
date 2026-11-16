import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import type { Realm } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CacheService } from '../cache/cache.service.js';
import {
  evaluatePolicies,
  evaluatePolicy,
  type RawPolicy,
  type PolicyEvaluationRequest,
  type PolicyEvaluationResult,
  type PolicyMatchDetail,
} from './policy-engine.js';
import type { CreatePolicyDto } from './authorization.dto.js';
import type { UpdatePolicyDto } from './authorization.dto.js';
import type { EvaluatePolicyDto } from './authorization.dto.js';
import type { TestPolicyDto } from './authorization.dto.js';

const POLICY_CACHE_TTL = 60; // seconds

@Injectable()
export class AuthorizationService {
  private readonly logger = new Logger(AuthorizationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  // ─── CRUD ─────────────────────────────────────────────────

  async createPolicy(realm: Realm, dto: CreatePolicyDto) {
    const existing = await this.prisma.policy.findFirst({
      where: { realmId: realm.id, name: dto.name },
    });
    if (existing) {
      throw new ConflictException(
        `Policy '${dto.name}' already exists in this realm`,
      );
    }

    const policy = await this.prisma.policy.create({
      data: {
        realmId: realm.id,
        name: dto.name,
        description: dto.description,
        enabled: dto.enabled ?? true,
        effect: dto.effect ?? 'ALLOW',
        priority: dto.priority ?? 0,
        logic: dto.logic ?? 'AND',
        clientId: dto.clientId ?? null,
        subjectConditions: dto.subjectConditions,
        resourceConditions: dto.resourceConditions,
        actionConditions: dto.actionConditions,
        environmentConditions: dto.environmentConditions,
      },
    });

    await this.invalidatePolicyCache(realm.id);
    return policy;
  }

  async findAllPolicies(realm: Realm) {
    return this.prisma.policy.findMany({
      where: { realmId: realm.id },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async findPolicyById(realm: Realm, id: string) {
    const policy = await this.prisma.policy.findFirst({
      where: { id, realmId: realm.id },
    });
    if (!policy) {
      throw new NotFoundException(`Policy '${id}' not found`);
    }
    return policy;
  }

  async updatePolicy(realm: Realm, id: string, dto: UpdatePolicyDto) {
    await this.findPolicyById(realm, id);

    const updated = await this.prisma.policy.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        enabled: dto.enabled,
        effect: dto.effect,
        priority: dto.priority,
        logic: dto.logic,
        clientId: dto.clientId,
        subjectConditions: dto.subjectConditions,
        resourceConditions: dto.resourceConditions,
        actionConditions: dto.actionConditions,
        environmentConditions: dto.environmentConditions,
      },
    });

    await this.invalidatePolicyCache(realm.id);
    return updated;
  }

  async deletePolicy(realm: Realm, id: string) {
    await this.findPolicyById(realm, id);
    await this.prisma.policy.delete({ where: { id } });
    await this.invalidatePolicyCache(realm.id);
  }

  // ─── Policy evaluation ─────────────────────────────────────

  /**
   * Evaluate all realm policies for the given request.
   * Policies are cached per realm for `POLICY_CACHE_TTL` seconds.
   */
  async evaluate(
    realm: Realm,
    dto: EvaluatePolicyDto,
  ): Promise<PolicyEvaluationResult> {
    const start = Date.now();

    const policies = await this.getCachedPolicies(realm.id);

    // Client scoping lives in the engine (policyAppliesToClient): global
    // policies always apply, a client's policies only when the request
    // names that client.
    const request: PolicyEvaluationRequest = {
      subject: dto.subject,
      resource: dto.resource,
      action: dto.action,
      environment: dto.environment,
      clientId: dto.clientId,
    };

    const result = evaluatePolicies(policies, request);
    this.warnIndeterminate(realm, result.matchedPolicies);

    const elapsed = Date.now() - start;
    this.logger.debug(
      `Policy evaluation for realm "${realm.name}" took ${elapsed}ms — ` +
        `decision: ${result.decision}, policies evaluated: ${result.evaluatedCount}`,
    );

    return result;
  }

  /**
   * Test a single specific policy against a request, without considering other
   * policies in the realm.  Useful for debugging policy logic.
   */
  async testPolicy(
    realm: Realm,
    id: string,
    dto: TestPolicyDto,
  ): Promise<{
    matched: boolean;
    effect: 'ALLOW' | 'DENY';
    detail: PolicyMatchDetail;
  }> {
    const policy = await this.findPolicyById(realm, id);

    const request: PolicyEvaluationRequest = {
      subject: dto.subject,
      resource: dto.resource,
      action: dto.action,
      environment: dto.environment,
    };

    const detail = evaluatePolicy(policy, request);
    this.warnIndeterminate(realm, [detail]);

    return {
      matched: detail.matched,
      effect: detail.effect,
      detail,
    };
  }

  /**
   * A stored policy that cannot be evaluated (saved before 0.11.0 validated
   * conditions, or written to the database directly) fails closed. Say so
   * in the log, so the operator can find and fix it; the upgrade health
   * check lists them too.
   */
  private warnIndeterminate(realm: Realm, details: PolicyMatchDetail[]): void {
    for (const d of details) {
      if (!d.indeterminate) continue;
      const reasons = d.conditionResults
        .filter((r) => r.indeterminate)
        .map((r) => r.reason)
        .join('; ');
      this.logger.warn(
        `Policy "${d.policyName}" (${d.policyId}) in realm "${realm.name}" ` +
          `cannot be evaluated: ${reasons}. ` +
          (d.effect === 'DENY'
            ? 'It is a DENY, so it denies (fail closed).'
            : 'It is an ALLOW, so it never allows.'),
      );
    }
  }

  // ─── Cache helpers ──────────────────────────────────────────

  private policyListCacheKey(realmId: string): string {
    return `policies:${realmId}`;
  }

  private async getCachedPolicies(realmId: string): Promise<RawPolicy[]> {
    const cacheKey = this.policyListCacheKey(realmId);
    const cached = await this.cache.getCachedRealmConfig<RawPolicy[]>(cacheKey);
    if (cached) return cached;

    const policies = await this.prisma.policy.findMany({
      where: { realmId },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });

    await this.cache.cacheRealmConfig(cacheKey, policies, POLICY_CACHE_TTL);

    return policies;
  }

  private async invalidatePolicyCache(realmId: string): Promise<void> {
    const cacheKey = this.policyListCacheKey(realmId);
    await this.cache.invalidateRealmCache(cacheKey);
  }
}
