import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateAuthFlowDto, UpdateAuthFlowDto } from './auth-flow.dto.js';

// ─── Types ─────────────────────────────────────────────────

export interface FlowStepCondition {
  field: string;
  operator: 'eq' | 'neq' | 'in' | 'not_in' | 'exists' | 'not_exists';
  value?: unknown;
}

export interface FlowStep {
  id: string;
  type: 'password' | 'totp' | 'webauthn' | 'social' | 'ldap' | 'email_otp' | 'magic_link' | 'consent';
  required: boolean;
  order: number;
  condition?: FlowStepCondition | null;
  fallbackStepId?: string | null;
  config?: Record<string, unknown>;
}

export type FlowContext = Record<string, unknown>;

// ─── Default Flow Definitions ──────────────────────────────

export const DEFAULT_FLOWS: Array<{
  name: string;
  description: string;
  steps: FlowStep[];
}> = [
  {
    name: 'Simple Login',
    description: 'Standard username and password authentication',
    steps: [
      {
        id: 'step-password',
        type: 'password',
        required: true,
        order: 1,
        condition: null,
        fallbackStepId: null,
        config: {},
      },
    ],
  },
  {
    name: 'MFA Required',
    description: 'Password authentication followed by TOTP one-time code',
    steps: [
      {
        id: 'step-password',
        type: 'password',
        required: true,
        order: 1,
        condition: null,
        fallbackStepId: null,
        config: {},
      },
      {
        id: 'step-totp',
        type: 'totp',
        required: true,
        order: 2,
        condition: null,
        fallbackStepId: null,
        config: {},
      },
    ],
  },
  {
    name: 'Passwordless',
    description: 'WebAuthn / FIDO2 passwordless authentication',
    steps: [
      {
        id: 'step-webauthn',
        type: 'webauthn',
        required: true,
        order: 1,
        condition: null,
        fallbackStepId: null,
        config: {},
      },
    ],
  },
];

// ─── Service ───────────────────────────────────────────────

@Injectable()
export class AuthFlowService {
  private readonly logger = new Logger(AuthFlowService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── CRUD ────────────────────────────────────────────────

  async create(realmId: string, dto: CreateAuthFlowDto) {
    this.validateSteps(dto.steps as FlowStep[]);

    const existing = await this.prisma.authenticationFlow.findUnique({
      where: { realmId_name: { realmId, name: dto.name } },
    });
    if (existing) {
      throw new ConflictException(`Authentication flow '${dto.name}' already exists in this realm`);
    }

    if (dto.isDefault) {
      await this.clearDefaultFlag(realmId);
    }

    return this.prisma.authenticationFlow.create({
      data: {
        realmId,
        name: dto.name,
        description: dto.description,
        isDefault: dto.isDefault ?? false,
        steps: dto.steps as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async findAll(realmId: string) {
    return this.prisma.authenticationFlow.findMany({
      where: { realmId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async findOne(realmId: string, id: string) {
    const flow = await this.prisma.authenticationFlow.findFirst({
      where: { id, realmId },
    });
    if (!flow) {
      throw new NotFoundException(`Authentication flow '${id}' not found`);
    }
    return flow;
  }

  async update(realmId: string, id: string, dto: UpdateAuthFlowDto) {
    await this.findOne(realmId, id); // throws if not found

    if (dto.steps) {
      this.validateSteps(dto.steps as FlowStep[]);
    }

    if (dto.name) {
      const existing = await this.prisma.authenticationFlow.findFirst({
        where: { realmId, name: dto.name, NOT: { id } },
      });
      if (existing) {
        throw new ConflictException(`Authentication flow '${dto.name}' already exists in this realm`);
      }
    }

    if (dto.isDefault) {
      await this.clearDefaultFlag(realmId, id);
    }

    return this.prisma.authenticationFlow.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
        ...(dto.steps !== undefined && { steps: dto.steps as unknown as Prisma.InputJsonValue }),
      },
    });
  }

  async remove(realmId: string, id: string) {
    await this.findOne(realmId, id); // throws if not found
    await this.prisma.authenticationFlow.delete({ where: { id } });
  }

  // ── Flow resolution ─────────────────────────────────────

  /**
   * Returns the flow assigned to a client, or the realm's default flow.
   * Throws if neither exists.
   */
  async getFlowForClient(clientId: string, realmId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, realmId },
      select: { authFlowId: true },
    });

    if (!client) {
      throw new NotFoundException(`Client '${clientId}' not found in realm`);
    }

    if (client.authFlowId) {
      const flow = await this.prisma.authenticationFlow.findFirst({
        where: { id: client.authFlowId, realmId },
      });
      if (flow) return flow;
      this.logger.warn(
        `Client ${clientId} references missing auth flow ${client.authFlowId}; falling back to realm default`,
      );
    }

    // Fall back to realm default
    const defaultFlow = await this.prisma.authenticationFlow.findFirst({
      where: { realmId, isDefault: true },
    });
    if (defaultFlow) return defaultFlow;

    // Last resort: first available flow
    const anyFlow = await this.prisma.authenticationFlow.findFirst({
      where: { realmId },
      orderBy: { createdAt: 'asc' },
    });
    if (anyFlow) return anyFlow;

    throw new NotFoundException(`No authentication flow configured for realm`);
  }

  // ── Step execution ──────────────────────────────────────

  /**
   * Execute a single step in the flow, returning the step definition and a
   * status. The actual credential verification happens in FlowExecutorService;
   * this method validates that the step exists and its condition is met.
   */
  async executeStep(
    flowId: string,
    stepId: string,
    context: FlowContext,
  ): Promise<{ step: FlowStep; conditionMet: boolean; skipped: boolean }> {
    const flow = await this.prisma.authenticationFlow.findUnique({
      where: { id: flowId },
    });
    if (!flow) {
      throw new NotFoundException(`Authentication flow '${flowId}' not found`);
    }

    const steps = flow.steps as unknown as FlowStep[];
    const step = steps.find((s) => s.id === stepId);
    if (!step) {
      throw new NotFoundException(`Step '${stepId}' not found in flow '${flowId}'`);
    }

    const conditionMet = step.condition
      ? this.evaluateCondition(step.condition, context)
      : true;

    // A non-required step whose condition is not met is skipped automatically
    const skipped = !conditionMet && !step.required;

    return { step, conditionMet, skipped };
  }

  /**
   * Determine the next step to execute given the current step.
   * Returns null when the flow is complete.
   */
  async getNextStep(
    flowId: string,
    currentStepId: string | null,
    context: FlowContext,
  ): Promise<FlowStep | null> {
    const flow = await this.prisma.authenticationFlow.findUnique({
      where: { id: flowId },
    });
    if (!flow) {
      throw new NotFoundException(`Authentication flow '${flowId}' not found`);
    }

    const steps = (flow.steps as unknown as FlowStep[])
      .slice()
      .sort((a, b) => a.order - b.order);

    if (currentStepId === null) {
      // Return first applicable step
      return this.firstApplicableStep(steps, context);
    }

    const currentIndex = steps.findIndex((s) => s.id === currentStepId);
    if (currentIndex === -1) {
      throw new BadRequestException(`Step '${currentStepId}' not found in flow`);
    }

    // Look for the next applicable step after the current one
    const remaining = steps.slice(currentIndex + 1);
    return this.firstApplicableStep(remaining, context);
  }

  /**
   * Evaluate a condition against the execution context.
   * Returns true when the condition is satisfied.
   */
  evaluateCondition(condition: FlowStepCondition, context: FlowContext): boolean {
    const rawValue = this.resolveField(condition.field, context);

    switch (condition.operator) {
      case 'exists':
        return rawValue !== undefined && rawValue !== null;

      case 'not_exists':
        return rawValue === undefined || rawValue === null;

      case 'eq':
        return rawValue === condition.value;

      case 'neq':
        return rawValue !== condition.value;

      case 'in': {
        if (!Array.isArray(condition.value)) return false;
        if (Array.isArray(rawValue)) {
          return rawValue.some((v) => (condition.value as unknown[]).includes(v));
        }
        return (condition.value as unknown[]).includes(rawValue);
      }

      case 'not_in': {
        if (!Array.isArray(condition.value)) return true;
        if (Array.isArray(rawValue)) {
          return !rawValue.some((v) => (condition.value as unknown[]).includes(v));
        }
        return !(condition.value as unknown[]).includes(rawValue);
      }

      default:
        this.logger.warn(`Unknown condition operator: ${(condition as FlowStepCondition & { operator: string }).operator}`);
        return false;
    }
  }

  // ── Seed default flows ──────────────────────────────────

  /**
   * Seed the three default flows for a realm.  Idempotent — skips any that
   * already exist.  The first flow ("Simple Login") is marked as default.
   */
  async seedDefaultFlows(realmId: string): Promise<void> {
    for (const [index, def] of DEFAULT_FLOWS.entries()) {
      const existing = await this.prisma.authenticationFlow.findUnique({
        where: { realmId_name: { realmId, name: def.name } },
      });
      if (existing) continue;

      await this.prisma.authenticationFlow.create({
        data: {
          realmId,
          name: def.name,
          description: def.description,
          isDefault: index === 0, // "Simple Login" is the default
          steps: def.steps as unknown as Prisma.InputJsonValue,
        },
      });
      this.logger.log(`Seeded default flow '${def.name}' for realm ${realmId}`);
    }
  }

  // ── Private helpers ─────────────────────────────────────

  private validateSteps(steps: FlowStep[]): void {
    if (!steps.length) {
      throw new BadRequestException('A flow must have at least one step');
    }

    const ids = steps.map((s) => s.id);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Step IDs must be unique within a flow');
    }

    const orders = steps.map((s) => s.order);
    if (new Set(orders).size !== orders.length) {
      throw new BadRequestException('Step order values must be unique within a flow');
    }

    // Validate fallbackStepId references
    for (const step of steps) {
      if (step.fallbackStepId && !ids.includes(step.fallbackStepId)) {
        throw new BadRequestException(
          `Step '${step.id}' references unknown fallbackStepId '${step.fallbackStepId}'`,
        );
      }
    }
  }

  /** Remove the isDefault flag from all flows in the realm, optionally excluding one. */
  private async clearDefaultFlag(realmId: string, excludeId?: string): Promise<void> {
    await this.prisma.authenticationFlow.updateMany({
      where: {
        realmId,
        isDefault: true,
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
      data: { isDefault: false },
    });
  }

  /**
   * Resolve a dot-path field (e.g. "user.group") from the context object.
   */
  private resolveField(field: string, context: FlowContext): unknown {
    const parts = field.split('.');
    let current: unknown = context;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  /**
   * Return the first step from a sorted list whose condition is met (or has no
   * condition).  Returns null when no applicable step remains.
   */
  private firstApplicableStep(steps: FlowStep[], context: FlowContext): FlowStep | null {
    for (const step of steps) {
      if (!step.condition) return step;
      if (this.evaluateCondition(step.condition, context)) return step;
      // If the step has a failed condition but is required, still include it so
      // the executor can decide what to do (e.g. show an error).
      if (step.required) return step;
    }
    return null;
  }
}
