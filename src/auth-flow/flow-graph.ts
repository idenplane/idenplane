/**
 * The execution model of a validated flow, as pure functions. It follows the
 * model documented in flow-validator.ts:
 * - the main path is every step that is not a fallback target, in `order`;
 * - a fallback step runs only when the step naming it fails;
 * - the identification phase is the first step plus its fallback chain.
 *
 * Only ever built from steps that passed `validateFlowSteps` (the binding
 * resolver refuses anything else), so ids, orders and references are sound.
 */
import { acrFromReceipts } from '../authn-core/flow-assurance.js';
import { ACR_PASSWORD, acrStrength } from '../authn-core/acr.js';
import type { FlowStepType, Receipt } from '../authn-core/flow-contracts.js';

export interface RuntimeStepCondition {
  field: string;
  operator: 'eq' | 'neq' | 'in' | 'not_in' | 'exists' | 'not_exists';
  value?: unknown;
}

export interface RuntimeStep {
  id: string;
  type: FlowStepType;
  required: boolean;
  order: number;
  condition?: RuntimeStepCondition | null;
  fallbackStepId?: string | null;
  config?: Record<string, unknown> | null;
}

/** The values a condition may read (the validator's CONDITION_FIELDS). */
export interface ConditionContext {
  user: {
    username: string;
    email: string | null;
    emailVerified: boolean;
    groups: string[];
    roles: string[];
    totpEnrolled: boolean;
    webauthnEnrolled: boolean;
  };
  client: { clientId: string | null };
  risk: { level: string | null };
}

function resolveField(field: string, context: unknown): unknown {
  let current: unknown = context;
  for (const part of field.split('.')) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Whether a step condition holds. For array fields (`user.groups`,
 * `user.roles`), `in` means "any of", `not_in` "none of".
 */
export function evaluateFlowCondition(
  condition: RuntimeStepCondition,
  context: unknown,
): boolean {
  const raw = resolveField(condition.field, context);
  const values = Array.isArray(condition.value) ? condition.value : null;
  switch (condition.operator) {
    case 'exists':
      return raw !== undefined && raw !== null;
    case 'not_exists':
      return raw === undefined || raw === null;
    case 'eq':
      return raw === condition.value;
    case 'neq':
      return raw !== condition.value;
    case 'in':
      if (!values) return false;
      return Array.isArray(raw)
        ? raw.some((v) => values.includes(v))
        : values.includes(raw);
    case 'not_in':
      if (!values) return true;
      return Array.isArray(raw)
        ? !raw.some((v) => values.includes(v))
        : !values.includes(raw);
    default:
      return false;
  }
}

/** The RFC 8176 method one step type performs (TOTP stands for any code). */
const STEP_AMR: Record<FlowStepType, string> = {
  password: 'pwd',
  ldap: 'pwd',
  totp: 'otp',
  webauthn: 'hwk',
};

/** The upper bound on combinations `impliedAcr` enumerates. */
const MAX_COMBINATIONS = 4096;

export class FlowGraph {
  readonly steps: readonly RuntimeStep[];
  readonly first: RuntimeStep;
  /** Steps that run by advancing, in order (the first step included). */
  readonly mainPath: readonly RuntimeStep[];
  private readonly byId: Map<string, RuntimeStep>;

  constructor(steps: readonly RuntimeStep[]) {
    const sorted = [...steps].sort((a, b) => a.order - b.order);
    if (sorted.length === 0) throw new Error('A flow has at least one step');
    this.steps = sorted;
    this.first = sorted[0];
    this.byId = new Map(sorted.map((s) => [s.id, s]));
    const targets = new Set(
      sorted.map((s) => s.fallbackStepId).filter((id): id is string => !!id),
    );
    this.mainPath = sorted.filter(
      (s) => s === this.first || !targets.has(s.id),
    );
  }

  step(id: string): RuntimeStep | undefined {
    return this.byId.get(id);
  }

  /** The step that runs if `step` fails, or undefined. */
  fallbackOf(step: RuntimeStep): RuntimeStep | undefined {
    return step.fallbackStepId ? this.byId.get(step.fallbackStepId) : undefined;
  }

  /** `step` followed by its fallbacks, in the order they would run. */
  chain(step: RuntimeStep): RuntimeStep[] {
    const out: RuntimeStep[] = [];
    let cur: RuntimeStep | undefined = step;
    while (cur && !out.includes(cur)) {
      out.push(cur);
      cur = this.fallbackOf(cur);
    }
    return out;
  }

  /** The main-path steps after `mainStepId`, in order. */
  mainStepsAfter(mainStepId: string): RuntimeStep[] {
    const index = this.mainPath.findIndex((s) => s.id === mainStepId);
    return index === -1 ? [] : this.mainPath.slice(index + 1);
  }

  /**
   * The weakest ACR any run of this flow can end with: the minimum, over
   * every way through it, of what the receipts would prove. A required step
   * without a condition always runs (as itself or one of its fallbacks);
   * any other step may be skipped. An SSO session weaker than this must not
   * satisfy a client bound to the flow.
   */
  impliedAcr(): string {
    const options: Array<Array<FlowStepType | null>> = this.mainPath.map(
      (s) => {
        const types = this.chain(s).map((c) => c.type);
        const mandatory = s === this.first || (s.required && !s.condition);
        return mandatory ? types : [...types, null];
      },
    );

    let weakest: string | null = null;
    let combinations = 0;
    const walk = (index: number, picked: FlowStepType[]): void => {
      if (combinations > MAX_COMBINATIONS) return;
      if (index === options.length) {
        combinations += 1;
        const receipts: Receipt[] = picked.map((t, i) => ({
          stepId: String(i),
          kind: t,
          amr: [STEP_AMR[t]],
          at: '',
        }));
        const acr = acrFromReceipts(receipts) ?? ACR_PASSWORD;
        if (weakest === null || acrStrength(acr) < acrStrength(weakest)) {
          weakest = acr;
        }
        return;
      }
      for (const option of options[index]) {
        walk(index + 1, option ? [...picked, option] : picked);
      }
    };
    walk(0, []);
    // Too many combinations to enumerate: claim no more than a password.
    if (combinations > MAX_COMBINATIONS) return ACR_PASSWORD;
    return weakest ?? ACR_PASSWORD;
  }
}

/** The steps of a stored (validated) flow, typed for the runtime. */
export function runtimeSteps(steps: unknown): RuntimeStep[] {
  return steps as RuntimeStep[];
}
