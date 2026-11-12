/**
 * Strict validation for authentication-flow definitions.
 *
 * A pure function with no I/O: it is run when a flow is saved (create/update),
 * when a flow is bound (bindings PUT, assign-client), on demand
 * (`POST …/auth-flows/:id/validate`) and by the binding resolver before a flow
 * is ever used. It never throws; it returns every problem it finds so the
 * admin UI can show them all inline.
 *
 * Execution model the graph rules assume (the runtime must honour it):
 * - The **main path** is every step that is *not* the fallback target of
 *   another step, run in ascending `order`. The first step (lowest order)
 *   always starts the flow.
 * - A **fallback step** (the target of some `fallbackStepId`) is an
 *   alternative: it is entered only when the step that names it fails, never
 *   by advancing along the main path.
 * - The **identification phase** is the first step plus everything reachable
 *   from it through fallbacks. Those are the "identifying steps"; every later
 *   step runs for an already-identified user.
 */

// ─── Error shape ───────────────────────────────────────────

export interface FlowValidationError {
  /** JSON-ish path into the submitted steps, e.g. `steps[1].config.digits`. */
  path: string;
  /** Stable machine-readable code (see FLOW_ERROR_CODES). */
  code: FlowValidationErrorCode;
  /** Human-readable explanation for admins. */
  message: string;
}

export const FLOW_ERROR_CODES = [
  'steps_not_array',
  'too_few_steps',
  'too_many_steps',
  'step_not_object',
  'invalid_id',
  'duplicate_id',
  'invalid_order',
  'duplicate_order',
  'invalid_required',
  'unsupported_type',
  'first_step_not_identifying',
  'first_step_not_required',
  'first_step_conditional',
  'invalid_fallback',
  'fallback_unknown_step',
  'fallback_self',
  'fallback_to_first_step',
  'fallback_cycle',
  'fallback_not_identifying',
  'unreachable_step',
  'condition_invalid',
  'condition_field_not_allowed',
  'condition_operator_invalid',
  'condition_value_invalid',
  'config_invalid',
  'config_unknown_key',
  'config_invalid_value',
] as const;
export type FlowValidationErrorCode = (typeof FLOW_ERROR_CODES)[number];

// ─── Vocabulary ────────────────────────────────────────────

export const MIN_FLOW_STEPS = 1;
export const MAX_FLOW_STEPS = 20;
export const MAX_STEP_ID_LENGTH = 100;

/**
 * Step types a flow may use. Derived from what exists today: the DTO accepts
 * password, totp, webauthn, social, ldap, email_otp and consent, and the
 * executor type also lists magic_link — but only these four have a real
 * credential check (the others auto-pass in FlowExecutorService, and the
 * design makes consent a post-flow concern, not a step).
 */
export const SUPPORTED_STEP_TYPES = [
  'password',
  'ldap',
  'totp',
  'webauthn',
] as const;
export type SupportedStepType = (typeof SUPPORTED_STEP_TYPES)[number];

/** Known to the DTO / executor but not runnable yet; rejected with a hint. */
export const NOT_YET_SUPPORTED_STEP_TYPES = [
  'social',
  'email_otp',
  'magic_link',
  'consent',
] as const;

/** Step types that can establish who the user is. */
export const IDENTIFYING_STEP_TYPES: readonly SupportedStepType[] = [
  'password',
  'ldap',
  'webauthn',
];

export const CONDITION_OPERATORS = [
  'eq',
  'neq',
  'in',
  'not_in',
  'exists',
  'not_exists',
] as const;

/**
 * Context fields a step condition may read. Conditions only apply to steps
 * after identification (the first step may not have one), so every field
 * describes the identified user, the client or the login's risk.
 */
export const CONDITION_FIELDS = [
  'user.username',
  'user.email',
  'user.emailVerified',
  'user.groups',
  'user.roles',
  'user.totpEnrolled',
  'user.webauthnEnrolled',
  'client.clientId',
  'risk.level',
] as const;

const MAX_CONDITION_VALUES = 100;

// ─── Per-handler config ────────────────────────────────────

type ConfigRule = (value: unknown) => string | null;

const optionalString =
  (max: number): ConfigRule =>
  (v) =>
    typeof v === 'string' && v.length <= max
      ? null
      : `must be a string of at most ${max} characters`;

const oneOf =
  (allowed: readonly (string | number)[]): ConfigRule =>
  (v) =>
    (typeof v === 'string' || typeof v === 'number') && allowed.includes(v)
      ? null
      : `must be one of ${allowed.join(', ')}`;

/**
 * Allowed config keys per step type, matching what the admin UI flow editor
 * emits. An absent or empty config is always valid.
 */
export const STEP_CONFIG_RULES: Record<
  SupportedStepType,
  Record<string, ConfigRule>
> = {
  password: {},
  ldap: { federationProviderId: optionalString(100) },
  totp: {
    issuer: optionalString(100),
    digits: oneOf([6, 8]),
    algorithm: oneOf(['SHA1', 'SHA256', 'SHA512']),
  },
  webauthn: {
    rpName: optionalString(100),
    userVerification: oneOf(['required', 'preferred', 'discouraged']),
  },
};

// ─── Helpers ───────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isScalar(v: unknown): boolean {
  return (
    typeof v === 'string' ||
    typeof v === 'boolean' ||
    (typeof v === 'number' && Number.isFinite(v))
  );
}

function isSupportedType(t: unknown): t is SupportedStepType {
  return (
    typeof t === 'string' &&
    (SUPPORTED_STEP_TYPES as readonly string[]).includes(t)
  );
}

interface NormalisedStep {
  index: number;
  id: string | null;
  order: number | null;
  type: unknown;
  required: unknown;
  condition: unknown;
  fallbackStepId: unknown;
  config: unknown;
}

// ─── Validator ─────────────────────────────────────────────

/**
 * Validate a flow's steps. Returns an empty array when the flow is valid.
 * Accepts `unknown` because it also runs on JSON loaded from the database.
 */
export function validateFlowSteps(steps: unknown): FlowValidationError[] {
  const errors: FlowValidationError[] = [];
  const err = (path: string, code: FlowValidationErrorCode, message: string) =>
    errors.push({ path, code, message });

  if (!Array.isArray(steps)) {
    err('steps', 'steps_not_array', 'Steps must be an array');
    return errors;
  }
  if (steps.length < MIN_FLOW_STEPS) {
    err('steps', 'too_few_steps', 'A flow must have at least one step');
    return errors;
  }
  if (steps.length > MAX_FLOW_STEPS) {
    err(
      'steps',
      'too_many_steps',
      `A flow may have at most ${MAX_FLOW_STEPS} steps (got ${steps.length})`,
    );
  }

  // ── Per-step shape ──────────────────────────────────────
  const normalised: NormalisedStep[] = [];
  const idCount = new Map<string, number>();
  const orderCount = new Map<number, number>();

  steps.forEach((raw: unknown, index) => {
    const p = `steps[${index}]`;
    if (!isPlainObject(raw)) {
      err(p, 'step_not_object', 'Each step must be an object');
      return;
    }

    let id: string | null = null;
    if (
      typeof raw.id === 'string' &&
      raw.id.trim().length > 0 &&
      raw.id.length <= MAX_STEP_ID_LENGTH
    ) {
      id = raw.id;
      idCount.set(id, (idCount.get(id) ?? 0) + 1);
    } else {
      err(
        `${p}.id`,
        'invalid_id',
        `Step id must be a non-empty string of at most ${MAX_STEP_ID_LENGTH} characters`,
      );
    }

    let order: number | null = null;
    if (
      typeof raw.order === 'number' &&
      Number.isInteger(raw.order) &&
      raw.order >= 1
    ) {
      order = raw.order;
      orderCount.set(order, (orderCount.get(order) ?? 0) + 1);
    } else {
      err(`${p}.order`, 'invalid_order', 'Step order must be an integer >= 1');
    }

    if (typeof raw.required !== 'boolean') {
      err(`${p}.required`, 'invalid_required', 'required must be a boolean');
    }

    if (!isSupportedType(raw.type)) {
      const t = typeof raw.type === 'string' ? raw.type : String(raw.type);
      const later = (
        NOT_YET_SUPPORTED_STEP_TYPES as readonly string[]
      ).includes(t);
      err(
        `${p}.type`,
        'unsupported_type',
        later
          ? `Step type '${t}' is not supported by the flow runtime yet. Supported: ${SUPPORTED_STEP_TYPES.join(', ')}`
          : `Unknown step type '${t}'. Supported: ${SUPPORTED_STEP_TYPES.join(', ')}`,
      );
    } else {
      validateConfig(raw.type, raw.config, `${p}.config`, err);
    }

    validateCondition(raw.condition, `${p}.condition`, err);

    if (
      raw.fallbackStepId !== undefined &&
      raw.fallbackStepId !== null &&
      (typeof raw.fallbackStepId !== 'string' || raw.fallbackStepId === '')
    ) {
      err(
        `${p}.fallbackStepId`,
        'invalid_fallback',
        'fallbackStepId must be a step id or null',
      );
    }

    normalised.push({
      index,
      id,
      order,
      type: raw.type,
      required: raw.required,
      condition: raw.condition,
      fallbackStepId: raw.fallbackStepId,
      config: raw.config,
    });
  });

  for (const s of normalised) {
    if (s.id !== null && (idCount.get(s.id) ?? 0) > 1) {
      err(
        `steps[${s.index}].id`,
        'duplicate_id',
        `Step id '${s.id}' is used more than once`,
      );
    }
    if (s.order !== null && (orderCount.get(s.order) ?? 0) > 1) {
      err(
        `steps[${s.index}].order`,
        'duplicate_order',
        `Step order ${s.order} is used more than once`,
      );
    }
  }

  // The graph rules need unambiguous ids and orders; stop here otherwise so
  // one root cause doesn't fan out into a page of derived errors.
  const structural = errors.some((e) =>
    [
      'step_not_object',
      'invalid_id',
      'duplicate_id',
      'invalid_order',
      'duplicate_order',
    ].includes(e.code),
  );
  if (structural) return errors;

  const sorted = normalised
    .slice()
    .sort((a, b) => (a.order as number) - (b.order as number));
  const byId = new Map(sorted.map((s) => [s.id as string, s]));
  const first = sorted[0];
  const fp = `steps[${first.index}]`;

  // ── First step ──────────────────────────────────────────
  if (
    isSupportedType(first.type) &&
    !IDENTIFYING_STEP_TYPES.includes(first.type)
  ) {
    err(
      `${fp}.type`,
      'first_step_not_identifying',
      `The first step must identify the user (${IDENTIFYING_STEP_TYPES.join(', ')}); '${first.type}' does not`,
    );
  }
  if (first.required !== true) {
    err(
      `${fp}.required`,
      'first_step_not_required',
      'The first step must be required',
    );
  }
  if (first.condition !== undefined && first.condition !== null) {
    err(
      `${fp}.condition`,
      'first_step_conditional',
      'The first step must not have a condition',
    );
  }

  // ── Fallback references ─────────────────────────────────
  const fallbackOf = new Map<string, string>(); // stepId -> valid target id
  for (const s of sorted) {
    if (typeof s.fallbackStepId !== 'string' || s.fallbackStepId === '') {
      continue;
    }
    const path = `steps[${s.index}].fallbackStepId`;
    const target = s.fallbackStepId;
    if (target === s.id) {
      err(path, 'fallback_self', `Step '${s.id}' cannot fall back to itself`);
      continue;
    }
    if (!byId.has(target)) {
      err(
        path,
        'fallback_unknown_step',
        `Step '${s.id}' falls back to unknown step '${target}'`,
      );
      continue;
    }
    if (target === first.id) {
      err(
        path,
        'fallback_to_first_step',
        `Step '${s.id}' cannot fall back to the first step '${target}'`,
      );
      continue;
    }
    fallbackOf.set(s.id as string, target);
  }

  // Acyclic: each step has at most one fallback, so walk each chain.
  const inCycle = new Set<string>();
  for (const start of fallbackOf.keys()) {
    const seen: string[] = [];
    let cur: string | undefined = start;
    while (cur !== undefined && !seen.includes(cur)) {
      seen.push(cur);
      cur = fallbackOf.get(cur);
    }
    if (cur !== undefined) {
      // `cur` is on a cycle; collect it once.
      const cycle: string[] = [];
      let c: string = cur;
      do {
        cycle.push(c);
        c = fallbackOf.get(c) as string;
      } while (c !== cur);
      if (!cycle.some((id) => inCycle.has(id))) {
        cycle.forEach((id) => inCycle.add(id));
        const s = byId.get(cur) as NormalisedStep;
        err(
          `steps[${s.index}].fallbackStepId`,
          'fallback_cycle',
          `Fallback cycle: ${[...cycle, cur].join(' -> ')}`,
        );
      }
    }
  }

  // ── Reachability ────────────────────────────────────────
  const fallbackTargets = new Set(fallbackOf.values());
  const reachable = new Set<string>(
    sorted
      .filter((s) => s === first || !fallbackTargets.has(s.id as string))
      .map((s) => s.id as string),
  );
  const queue = [...reachable];
  while (queue.length) {
    const next = fallbackOf.get(queue.shift() as string);
    if (next !== undefined && !reachable.has(next)) {
      reachable.add(next);
      queue.push(next);
    }
  }
  for (const s of sorted) {
    if (!reachable.has(s.id as string)) {
      err(
        `steps[${s.index}]`,
        'unreachable_step',
        `Step '${s.id}' can never run: it is only a fallback of steps that are themselves unreachable`,
      );
    }
  }

  // ── Identification phase ────────────────────────────────
  // first step + its fallback chain. Every step in it identifies the user, so
  // each may only fall back to another identifying step.
  const visited = new Set<string>();
  let cur: string | undefined = first.id as string;
  while (cur !== undefined && !visited.has(cur)) {
    visited.add(cur);
    const target = fallbackOf.get(cur);
    if (target !== undefined) {
      const t = byId.get(target) as NormalisedStep;
      if (isSupportedType(t.type) && !IDENTIFYING_STEP_TYPES.includes(t.type)) {
        const s = byId.get(cur) as NormalisedStep;
        err(
          `steps[${s.index}].fallbackStepId`,
          'fallback_not_identifying',
          `Identifying step '${cur}' may only fall back to an identifying step (${IDENTIFYING_STEP_TYPES.join(', ')}); '${target}' is '${String(t.type)}'`,
        );
      }
    }
    cur = target;
  }

  return errors;
}

// ─── Condition ─────────────────────────────────────────────

function validateCondition(
  condition: unknown,
  path: string,
  err: (p: string, c: FlowValidationErrorCode, m: string) => void,
): void {
  if (condition === undefined || condition === null) return;
  if (!isPlainObject(condition)) {
    err(path, 'condition_invalid', 'Condition must be an object or null');
    return;
  }
  const { field, operator, value } = condition;
  if (
    typeof field !== 'string' ||
    !(CONDITION_FIELDS as readonly string[]).includes(field)
  ) {
    err(
      `${path}.field`,
      'condition_field_not_allowed',
      `Condition field '${String(field)}' is not allowed. Allowed: ${CONDITION_FIELDS.join(', ')}`,
    );
  }
  if (
    typeof operator !== 'string' ||
    !(CONDITION_OPERATORS as readonly string[]).includes(operator)
  ) {
    err(
      `${path}.operator`,
      'condition_operator_invalid',
      `Condition operator '${String(operator)}' is not one of ${CONDITION_OPERATORS.join(', ')}`,
    );
    return;
  }
  switch (operator) {
    case 'eq':
    case 'neq':
      if (!isScalar(value)) {
        err(
          `${path}.value`,
          'condition_value_invalid',
          `Operator '${operator}' needs a string, number or boolean value`,
        );
      }
      break;
    case 'in':
    case 'not_in':
      if (
        !Array.isArray(value) ||
        value.length === 0 ||
        value.length > MAX_CONDITION_VALUES ||
        !value.every(isScalar)
      ) {
        err(
          `${path}.value`,
          'condition_value_invalid',
          `Operator '${operator}' needs a non-empty array (at most ${MAX_CONDITION_VALUES}) of strings, numbers or booleans`,
        );
      }
      break;
    default: // exists / not_exists
      if (value !== undefined && value !== null) {
        err(
          `${path}.value`,
          'condition_value_invalid',
          `Operator '${operator}' takes no value`,
        );
      }
  }
}

// ─── Config ────────────────────────────────────────────────

function validateConfig(
  type: SupportedStepType,
  config: unknown,
  path: string,
  err: (p: string, c: FlowValidationErrorCode, m: string) => void,
): void {
  if (config === undefined || config === null) return;
  if (!isPlainObject(config)) {
    err(path, 'config_invalid', 'Step config must be an object');
    return;
  }
  const rules = STEP_CONFIG_RULES[type];
  for (const [key, value] of Object.entries(config)) {
    const rule = rules[key];
    if (!rule) {
      const allowed = Object.keys(rules);
      err(
        `${path}.${key}`,
        'config_unknown_key',
        allowed.length
          ? `'${key}' is not a valid ${type} setting. Allowed: ${allowed.join(', ')}`
          : `${type} steps take no configuration ('${key}' given)`,
      );
      continue;
    }
    if (value === undefined || value === null) continue;
    const problem = rule(value);
    if (problem) {
      err(`${path}.${key}`, 'config_invalid_value', `${key} ${problem}`);
    }
  }
}

/** Convenience: true when the steps pass every rule. */
export function isValidFlow(steps: unknown): boolean {
  return validateFlowSteps(steps).length === 0;
}
