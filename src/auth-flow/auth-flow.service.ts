import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CacheService } from '../cache/cache.service.js';
import {
  CreateAuthFlowDto,
  UpdateAuthFlowDto,
  UpdateFlowBindingsDto,
} from './auth-flow.dto.js';
import {
  validateFlowSteps,
  type FlowValidationError,
} from './flow-validator.js';
import { isAuthFlowRuntimeEnabled } from './auth-flow-runtime.js';

// ─── Types ─────────────────────────────────────────────────

export interface FlowStepCondition {
  field: string;
  operator: 'eq' | 'neq' | 'in' | 'not_in' | 'exists' | 'not_exists';
  value?: unknown;
}

export interface FlowStep {
  id: string;
  type:
    | 'password'
    | 'totp'
    | 'webauthn'
    | 'social'
    | 'ldap'
    | 'email_otp'
    | 'magic_link'
    | 'consent';
  required: boolean;
  order: number;
  condition?: FlowStepCondition | null;
  fallbackStepId?: string | null;
  config?: Record<string, unknown>;
}

export type FlowContext = Record<string, unknown>;

// ─── Binding types ─────────────────────────────────────────

/** One error from a bindings / assign request. */
export interface BindingError {
  /** Path into the request, e.g. `browserFlowId` or `clients[1].authFlowId`. */
  path: string;
  code:
    | 'flow_not_found'
    | 'flow_invalid'
    | 'client_not_found'
    | 'client_duplicate'
    | 'flow_id_required'
    | 'flow_id_mismatch';
  message: string;
  /** The flow concerned, when there is one. */
  flowId?: string;
  /** Validator output for `flow_invalid`. */
  flowErrors?: FlowValidationError[];
}

export interface FlowBindings {
  /** Whether the server runs with AUTH_FLOW_RUNTIME_ENABLED (read-only). */
  runtimeEnabled: boolean;
  authFlowsEnabled: boolean;
  browserFlowId: string | null;
  /** Every client of the realm, with its override (null = none). */
  clients: Array<{
    id: string;
    clientId: string;
    name: string | null;
    authFlowId: string | null;
  }>;
}

/** Where a flow is bound; returned with a 409 on delete. */
export type FlowBindingRef =
  | { kind: 'realm'; realmId: string; realmName: string }
  | { kind: 'client'; id: string; clientId: string };

function flowInvalid(errors: FlowValidationError[]): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message: 'Authentication flow is invalid',
    errors,
  });
}

function bindingInvalid(errors: BindingError[]): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message: 'Flow binding rejected',
    errors,
  });
}

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  // ── CRUD ────────────────────────────────────────────────

  async create(realmId: string, dto: CreateAuthFlowDto) {
    this.assertValidSteps(dto.steps);

    const existing = await this.prisma.authenticationFlow.findUnique({
      where: { realmId_name: { realmId, name: dto.name } },
    });
    if (existing) {
      throw new ConflictException(
        `Authentication flow '${dto.name}' already exists in this realm`,
      );
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

    if (dto.steps !== undefined) {
      this.assertValidSteps(dto.steps);
    }

    if (dto.name) {
      const existing = await this.prisma.authenticationFlow.findFirst({
        where: { realmId, name: dto.name, NOT: { id } },
      });
      if (existing) {
        throw new ConflictException(
          `Authentication flow '${dto.name}' already exists in this realm`,
        );
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
        ...(dto.steps !== undefined && {
          steps: dto.steps as unknown as Prisma.InputJsonValue,
        }),
        version: { increment: 1 },
      },
    });
  }

  /**
   * Delete a flow. Refused with 409 (and the list of bindings) while the realm
   * or any client is bound to it: deleting would otherwise silently change how
   * those logins run.
   */
  async remove(realmId: string, id: string) {
    await this.findOne(realmId, id); // throws if not found
    const bindings = await this.findBindingsOf(id);
    if (bindings.length > 0) throw this.boundConflict(id, bindings);
    try {
      await this.prisma.authenticationFlow.delete({ where: { id } });
    } catch (err) {
      // A binding created between the check and the delete trips the FK.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        throw this.boundConflict(id, await this.findBindingsOf(id));
      }
      throw err;
    }
  }

  // ── Validation ──────────────────────────────────────────

  /** Validate a stored flow against the current rules. */
  async validateFlow(
    realmId: string,
    id: string,
  ): Promise<{ valid: boolean; errors: FlowValidationError[] }> {
    const flow = await this.findOne(realmId, id);
    const errors = validateFlowSteps(flow.steps);
    return { valid: errors.length === 0, errors };
  }

  // ── Bindings ────────────────────────────────────────────
  //
  // Same-realm membership is enforced here, not by a composite FK: every
  // write path below loads the flow and the client with `realmId` in the
  // where clause, and FlowBindingResolver loads the flow the same way.
  // `isDefault` is never consulted.

  async getBindings(realmId: string): Promise<FlowBindings> {
    const realm = await this.prisma.realm.findUnique({
      where: { id: realmId },
      select: { authFlowsEnabled: true, browserFlowId: true },
    });
    if (!realm) throw new NotFoundException(`Realm '${realmId}' not found`);
    const clients = await this.prisma.client.findMany({
      where: { realmId },
      select: { id: true, clientId: true, name: true, authFlowId: true },
      orderBy: { clientId: 'asc' },
    });
    return {
      runtimeEnabled: isAuthFlowRuntimeEnabled(),
      authFlowsEnabled: realm.authFlowsEnabled,
      browserFlowId: realm.browserFlowId,
      clients,
    };
  }

  /**
   * Partially update the realm's bindings. Every flow it would bind is loaded
   * in-realm and validated first; nothing is written unless all pass. When
   * the result has `authFlowsEnabled`, every *effective* binding (including
   * client overrides not in this request) must be valid too, so enabling can
   * never leave a client failing closed.
   */
  async updateBindings(
    realmId: string,
    dto: UpdateFlowBindingsDto,
  ): Promise<{ bindings: FlowBindings; changed: Record<string, unknown> }> {
    const realm = await this.prisma.realm.findUnique({
      where: { id: realmId },
      select: {
        id: true,
        name: true,
        authFlowsEnabled: true,
        browserFlowId: true,
      },
    });
    if (!realm) throw new NotFoundException(`Realm '${realmId}' not found`);

    const errors: BindingError[] = [];
    const nextBrowserFlowId =
      dto.browserFlowId === undefined
        ? realm.browserFlowId
        : dto.browserFlowId || null;
    const nextEnabled = dto.authFlowsEnabled ?? realm.authFlowsEnabled;

    // Resolve the clients the request names (by OAuth client_id).
    const requested = dto.clients ?? [];
    const realmClients = await this.prisma.client.findMany({
      where: { realmId },
      select: { id: true, clientId: true, authFlowId: true },
    });
    const byClientId = new Map(realmClients.map((c) => [c.clientId, c]));
    const clientUpdates: Array<{
      index: number;
      id: string;
      clientId: string;
      from: string | null;
      authFlowId: string | null;
    }> = [];
    const seen = new Set<string>();
    requested.forEach((entry, index) => {
      const path = `clients[${index}]`;
      if (seen.has(entry.clientId)) {
        errors.push({
          path: `${path}.clientId`,
          code: 'client_duplicate',
          message: `Client '${entry.clientId}' is listed more than once`,
        });
        return;
      }
      seen.add(entry.clientId);
      const client = byClientId.get(entry.clientId);
      if (!client) {
        errors.push({
          path: `${path}.clientId`,
          code: 'client_not_found',
          message: `Client '${entry.clientId}' not found in this realm`,
        });
        return;
      }
      if (entry.authFlowId === undefined) {
        errors.push({
          path: `${path}.authFlowId`,
          code: 'flow_id_required',
          message: 'authFlowId is required (null removes the override)',
        });
        return;
      }
      clientUpdates.push({
        index,
        id: client.id,
        clientId: client.clientId,
        from: client.authFlowId,
        authFlowId: entry.authFlowId || null,
      });
    });

    // Flows to check: everything this request binds, plus (when the realm
    // will be enabled) every binding that would then be in effect.
    const toCheck = new Map<string, string[]>(); // flowId -> request paths
    const want = (flowId: string | null, path: string) => {
      if (!flowId) return;
      toCheck.set(flowId, [...(toCheck.get(flowId) ?? []), path]);
    };
    if (dto.browserFlowId !== undefined || nextEnabled) {
      want(nextBrowserFlowId, 'browserFlowId');
    }
    for (const u of clientUpdates) {
      want(u.authFlowId, `clients[${u.index}].authFlowId`);
    }
    if (nextEnabled) {
      const patched = new Set(clientUpdates.map((u) => u.id));
      for (const c of realmClients) {
        if (!patched.has(c.id)) {
          want(c.authFlowId, `clients[clientId=${c.clientId}].authFlowId`);
        }
      }
    }

    if (toCheck.size > 0) {
      const flows = await this.prisma.authenticationFlow.findMany({
        where: { realmId, id: { in: [...toCheck.keys()] } },
        select: { id: true, name: true, steps: true },
      });
      const flowById = new Map(flows.map((f) => [f.id, f]));
      for (const [flowId, paths] of toCheck) {
        const flow = flowById.get(flowId);
        const flowErrors = flow ? validateFlowSteps(flow.steps) : [];
        for (const path of paths) {
          if (!flow) {
            errors.push({
              path,
              code: 'flow_not_found',
              message: `Flow '${flowId}' not found in this realm`,
              flowId,
            });
          } else if (flowErrors.length > 0) {
            errors.push({
              path,
              code: 'flow_invalid',
              message: `Flow '${flow.name}' is invalid: ${flowErrors[0].message}`,
              flowId,
              flowErrors,
            });
          }
        }
      }
    }

    if (errors.length > 0) throw bindingInvalid(errors);

    const realmData: Prisma.RealmUpdateInput = {};
    if (dto.browserFlowId !== undefined) {
      realmData.browserFlow = nextBrowserFlowId
        ? { connect: { id: nextBrowserFlowId } }
        : { disconnect: true };
    }
    if (dto.authFlowsEnabled !== undefined) {
      realmData.authFlowsEnabled = dto.authFlowsEnabled;
    }

    await this.prisma.$transaction([
      ...(Object.keys(realmData).length > 0
        ? [
            this.prisma.realm.update({
              where: { id: realmId },
              data: realmData,
            }),
          ]
        : []),
      ...clientUpdates.map((u) =>
        this.prisma.client.update({
          where: { id: u.id },
          data: { authFlowId: u.authFlowId },
        }),
      ),
    ]);

    await this.cache.invalidateRealmCache(realm.id, realm.name);
    await Promise.all(
      clientUpdates.map((u) => this.invalidateClient(realmId, u)),
    );

    const changed: Record<string, unknown> = {};
    if (dto.browserFlowId !== undefined) {
      changed['browserFlowId'] = {
        from: realm.browserFlowId,
        to: nextBrowserFlowId,
      };
    }
    if (dto.authFlowsEnabled !== undefined) {
      changed['authFlowsEnabled'] = {
        from: realm.authFlowsEnabled,
        to: dto.authFlowsEnabled,
      };
    }
    if (clientUpdates.length > 0) {
      changed['clients'] = clientUpdates.map((u) => ({
        clientId: u.clientId,
        from: u.from,
        to: u.authFlowId,
      }));
    }

    return { bindings: await this.getBindings(realmId), changed };
  }

  /**
   * Bind flow `flowId` to one client (both looked up in `realmId`). 404 when
   * either is not in the realm; 400 when the body names a different flow or
   * the flow fails validation.
   */
  async assignToClient(
    realmId: string,
    flowId: string,
    clientPk: string,
    bodyFlowId: string | null | undefined,
  ) {
    const flow = await this.prisma.authenticationFlow.findFirst({
      where: { id: flowId, realmId },
      select: { id: true, steps: true },
    });
    if (!flow) {
      throw new NotFoundException(`Authentication flow '${flowId}' not found`);
    }
    const client = await this.prisma.client.findFirst({
      where: { id: clientPk, realmId },
      select: { id: true, clientId: true, authFlowId: true },
    });
    if (!client) throw new NotFoundException(`Client '${clientPk}' not found`);

    if (bodyFlowId !== undefined && bodyFlowId !== flowId) {
      throw bindingInvalid([
        {
          path: 'authFlowId',
          code: 'flow_id_mismatch',
          message:
            bodyFlowId === null
              ? 'To clear an assignment use DELETE on this path'
              : `Body authFlowId '${bodyFlowId}' does not match the flow in the path '${flowId}'`,
        },
      ]);
    }

    const flowErrors = validateFlowSteps(flow.steps);
    if (flowErrors.length > 0) throw flowInvalid(flowErrors);

    const updated = await this.prisma.client.update({
      where: { id: client.id },
      data: { authFlowId: flowId },
      select: { id: true, clientId: true, authFlowId: true },
    });
    await this.invalidateClient(realmId, updated);
    return { ...updated, previousAuthFlowId: client.authFlowId };
  }

  /** Remove client `clientPk`'s override, if it is bound to `flowId`. */
  async unassignFromClient(realmId: string, flowId: string, clientPk: string) {
    await this.findOne(realmId, flowId);
    const client = await this.prisma.client.findFirst({
      where: { id: clientPk, realmId },
      select: { id: true, clientId: true, authFlowId: true },
    });
    if (!client) throw new NotFoundException(`Client '${clientPk}' not found`);
    if (client.authFlowId !== flowId) {
      throw new NotFoundException(
        `Client '${clientPk}' is not assigned to flow '${flowId}'`,
      );
    }
    const updated = await this.prisma.client.update({
      where: { id: client.id },
      data: { authFlowId: null },
      select: { id: true, clientId: true, authFlowId: true },
    });
    await this.invalidateClient(realmId, updated);
    return updated;
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
      throw new NotFoundException(
        `Step '${stepId}' not found in flow '${flowId}'`,
      );
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
      throw new BadRequestException(
        `Step '${currentStepId}' not found in flow`,
      );
    }

    // Look for the next applicable step after the current one
    const remaining = steps.slice(currentIndex + 1);
    return this.firstApplicableStep(remaining, context);
  }

  /**
   * Evaluate a condition against the execution context.
   * Returns true when the condition is satisfied.
   */
  evaluateCondition(
    condition: FlowStepCondition,
    context: FlowContext,
  ): boolean {
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
          return rawValue.some((v) =>
            (condition.value as unknown[]).includes(v),
          );
        }
        return (condition.value as unknown[]).includes(rawValue);
      }

      case 'not_in': {
        if (!Array.isArray(condition.value)) return true;
        if (Array.isArray(rawValue)) {
          return !rawValue.some((v) =>
            (condition.value as unknown[]).includes(v),
          );
        }
        return !(condition.value as unknown[]).includes(rawValue);
      }

      default:
        this.logger.warn(
          `Unknown condition operator: ${(condition as FlowStepCondition & { operator: string }).operator}`,
        );
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

  /** Run the strict validator; 400 with the full error list on failure. */
  private assertValidSteps(steps: unknown): void {
    const errors = validateFlowSteps(steps);
    if (errors.length > 0) throw flowInvalid(errors);
  }

  private async findBindingsOf(flowId: string): Promise<FlowBindingRef[]> {
    const [realms, clients] = await Promise.all([
      this.prisma.realm.findMany({
        where: { browserFlowId: flowId },
        select: { id: true, name: true },
      }),
      this.prisma.client.findMany({
        where: { authFlowId: flowId },
        select: { id: true, clientId: true },
        orderBy: { clientId: 'asc' },
      }),
    ]);
    return [
      ...realms.map((r): FlowBindingRef => ({
        kind: 'realm',
        realmId: r.id,
        realmName: r.name,
      })),
      ...clients.map((c): FlowBindingRef => ({
        kind: 'client',
        id: c.id,
        clientId: c.clientId,
      })),
    ];
  }

  private boundConflict(
    flowId: string,
    bindings: FlowBindingRef[],
  ): ConflictException {
    return new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      message: `Authentication flow '${flowId}' is bound and cannot be deleted. Unbind it first.`,
      bindings,
    });
  }

  /** Drop both cache keys a client can be cached under (client_id and PK). */
  private async invalidateClient(
    realmId: string,
    client: { id: string; clientId: string },
  ): Promise<void> {
    await Promise.all([
      this.cache.invalidateClientCache(`${realmId}:${client.clientId}`),
      this.cache.invalidateClientCache(`${realmId}:${client.id}`),
    ]);
  }

  /** Remove the isDefault flag from all flows in the realm, optionally excluding one. */
  private async clearDefaultFlag(
    realmId: string,
    excludeId?: string,
  ): Promise<void> {
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
      if (
        current === null ||
        current === undefined ||
        typeof current !== 'object'
      ) {
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
  private firstApplicableStep(
    steps: FlowStep[],
    context: FlowContext,
  ): FlowStep | null {
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
