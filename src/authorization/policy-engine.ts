/**
 * Pure-function ABAC policy engine.
 *
 * All evaluation logic lives here so it can be tested independently of
 * NestJS infrastructure.
 */

import { BlockList, isIP } from 'node:net';

// ─── Condition types ─────────────────────────────────────────────────────────

/**
 * Every operator the engine understands. The single source for DTO
 * validation, realm import validation, the upgrade health check and
 * evaluation, so they can never disagree about what is valid.
 */
export const CONDITION_OPERATORS = [
  'equals',
  'notEquals',
  'contains',
  'in',
  'notIn',
  'greaterThan',
  'lessThan',
  'matches',
  'ipInRange',
] as const;

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export const POLICY_EFFECTS = ['ALLOW', 'DENY'] as const;
export const POLICY_LOGIC = ['AND', 'OR'] as const;

/** The four condition columns of a policy, in evaluation order. */
export const CONDITION_CATEGORIES = [
  'subjectConditions',
  'resourceConditions',
  'actionConditions',
  'environmentConditions',
] as const;

export interface Condition {
  field: string; // dot-notation path into the context, e.g. "subject.roles"
  operator: ConditionOperator;
  value: unknown; // compared value (string | number | string[])
}

export type ConditionGroup = Condition | Condition[];

// ─── Policy shape (plain object from DB or test) ─────────────────────────────

export interface RawPolicy {
  id: string;
  name: string;
  enabled: boolean;
  effect: string; // "ALLOW" | "DENY"
  priority: number;
  logic: string; // "AND" | "OR"
  clientId: string | null;
  subjectConditions: unknown;
  resourceConditions: unknown;
  actionConditions: unknown;
  environmentConditions: unknown;
}

// ─── Evaluation request / result ─────────────────────────────────────────────

export interface PolicySubject {
  userId?: string;
  roles?: string[];
  groups?: string[];
  attributes?: Record<string, unknown>;
}

export interface PolicyResource {
  type?: string;
  id?: string;
  ownerId?: string;
  attributes?: Record<string, unknown>;
}

export interface PolicyEnvironment {
  ip?: string;
  time?: Date | string;
}

export interface PolicyEvaluationRequest {
  subject: PolicySubject;
  resource: PolicyResource;
  action: string;
  environment?: PolicyEnvironment;
  clientId?: string;
}

export interface PolicyMatchDetail {
  policyId: string;
  policyName: string;
  effect: 'ALLOW' | 'DENY';
  matched: boolean;
  /**
   * Set when part of the stored policy cannot be evaluated (an unknown
   * operator, a malformed value, an unknown effect or logic). Such a policy
   * fails closed: a DENY matches, an ALLOW never does.
   */
  indeterminate?: boolean;
  conditionResults: Array<{
    conditionType: string;
    passed: boolean;
    reason?: string;
    indeterminate?: boolean;
  }>;
}

export interface PolicyEvaluationResult {
  decision: 'ALLOW' | 'DENY';
  reason: string;
  matchedPolicies: PolicyMatchDetail[];
  evaluatedCount: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve a dot-notation path against an object. Only own properties are
 * followed, so a path can never reach `constructor` or `__proto__`.
 *
 * Examples:
 *   get({ subject: { roles: ['admin'] } }, 'subject.roles') => ['admin']
 *   get({ action: 'read' }, 'action') => 'read'
 */
function resolveField(
  context: Record<string, unknown>,
  field: string,
): unknown {
  const parts = field.split('.');
  let current: unknown = context;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** `::ffff:10.0.0.1` → `10.0.0.1`; anything else is returned trimmed. */
function normalizeIp(address: string): string {
  const trimmed = address.trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed);
  return mapped ? mapped[1] : trimmed;
}

/**
 * Parse an `ipInRange` value: an IPv4 or IPv6 address, or a CIDR block
 * (`10.0.0.0/8`, `2001:db8::/32`, `::ffff:10.0.0.0/104`). Returns `null`
 * when the value is not one. Matching uses `net.BlockList`, so an
 * IPv4-mapped IPv6 address (`::ffff:10.1.2.3`, how a dual-stack socket
 * reports an IPv4 peer) matches its IPv4 network and the other way round.
 */
export function parseIpRange(value: unknown): BlockList | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  const slash = raw.indexOf('/');
  const address = slash === -1 ? raw : raw.slice(0, slash);
  const family = isIP(address);
  if (family === 0) return null;
  const type = family === 4 ? 'ipv4' : 'ipv6';
  const list = new BlockList();
  if (slash === -1) {
    list.addAddress(address, type);
    return list;
  }
  const prefixText = raw.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefixText)) return null;
  const prefix = Number(prefixText);
  if (prefix > (family === 4 ? 32 : 128)) return null;
  list.addSubnet(address, prefix, type);
  return list;
}

const OPERATOR_SET: ReadonlySet<string> = new Set(CONDITION_OPERATORS);

/** A stored value as text for a message, whatever its type. */
function show(value: unknown): string {
  return typeof value === 'string'
    ? value
    : (JSON.stringify(value) ?? 'undefined');
}

function isScalar(value: unknown): boolean {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function isNumeric(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  return (
    typeof value === 'string' &&
    value.trim() !== '' &&
    Number.isFinite(Number(value))
  );
}

/**
 * Why a stored condition cannot be evaluated, or `null` when it can.
 * Checks the shape, the operator, and the value the operator needs. Used at
 * save time (a `400`), by realm import, by the upgrade health check, and at
 * evaluation time (fail closed).
 */
export function conditionProblem(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return 'must be an object { field, operator, value }';
  }
  const c = raw as Record<string, unknown>;
  const field = c['field'];
  if (typeof field !== 'string' || field.trim() === '') {
    return '"field" must be a non-empty string';
  }
  const operator = c['operator'];
  if (typeof operator !== 'string' || !OPERATOR_SET.has(operator)) {
    return (
      `unknown operator "${show(operator)}" ` +
      `(expected one of: ${CONDITION_OPERATORS.join(', ')})`
    );
  }
  if (!Object.prototype.hasOwnProperty.call(c, 'value')) {
    return '"value" is required';
  }
  const value = c['value'];
  switch (operator as ConditionOperator) {
    case 'equals':
    case 'notEquals':
    case 'contains':
      return isScalar(value)
        ? null
        : `operator "${operator}" needs a string, number, boolean or null value`;
    case 'in':
    case 'notIn':
      return Array.isArray(value)
        ? null
        : `operator "${operator}" needs an array value`;
    case 'greaterThan':
    case 'lessThan':
      return isNumeric(value)
        ? null
        : `operator "${operator}" needs a numeric value`;
    case 'matches':
      if (typeof value !== 'string') {
        return 'operator "matches" needs a regular expression string';
      }
      try {
        new RegExp(value);
        return null;
      } catch {
        return `invalid regular expression "${value}"`;
      }
    case 'ipInRange':
      return parseIpRange(value)
        ? null
        : `operator "ipInRange" needs an IPv4 or IPv6 address or CIDR block, got ${show(value)}`;
  }
}

/** A problem with a stored policy, at a path such as `actionConditions[1]`. */
export interface PolicyProblem {
  path: string;
  message: string;
}

/**
 * Every reason a policy (as stored or as submitted) cannot be evaluated.
 * Empty when the policy is valid. `effect` and `logic` are only checked
 * when present, since both have defaults.
 */
export function policyProblems(policy: {
  effect?: unknown;
  logic?: unknown;
  subjectConditions?: unknown;
  resourceConditions?: unknown;
  actionConditions?: unknown;
  environmentConditions?: unknown;
}): PolicyProblem[] {
  const problems: PolicyProblem[] = [];
  if (
    policy.effect !== undefined &&
    !(POLICY_EFFECTS as readonly unknown[]).includes(policy.effect)
  ) {
    problems.push({
      path: 'effect',
      message: `unknown effect "${show(policy.effect)}" (expected ALLOW or DENY)`,
    });
  }
  if (
    policy.logic !== undefined &&
    !(POLICY_LOGIC as readonly unknown[]).includes(policy.logic)
  ) {
    problems.push({
      path: 'logic',
      message: `unknown logic "${show(policy.logic)}" (expected AND or OR)`,
    });
  }
  for (const category of CONDITION_CATEGORIES) {
    const raw = policy[category];
    if (raw === null || raw === undefined) continue;
    const list = Array.isArray(raw) ? raw : [raw];
    list.forEach((condition, i) => {
      const message = conditionProblem(condition);
      if (message) {
        problems.push({
          path: Array.isArray(raw) ? `${category}[${i}]` : category,
          message,
        });
      }
    });
  }
  return problems;
}

// ─── Core condition evaluation ────────────────────────────────────────────────

export interface ConditionResult {
  passed: boolean;
  reason: string;
  /** The condition cannot be evaluated; see {@link PolicyMatchDetail}. */
  indeterminate?: boolean;
}

/**
 * Evaluate a single condition against a flat evaluation context.
 * The context is built by the caller and contains top-level keys:
 * subject, resource, action, environment.
 *
 * A condition that cannot be evaluated (see {@link conditionProblem})
 * returns `indeterminate: true`, never a plain `false`: for a DENY policy a
 * plain `false` means "does not apply", which fails open.
 *
 * A request that does not carry the field a condition reads (no
 * `environment.ip`, say) is not an error: the condition is false.
 */
export function evaluateCondition(
  condition: unknown,
  context: Record<string, unknown>,
): ConditionResult {
  const problem = conditionProblem(condition);
  if (problem) {
    return {
      passed: false,
      indeterminate: true,
      reason: `cannot evaluate condition: ${problem}`,
    };
  }
  const c = condition as Condition;
  const actual = resolveField(context, c.field);
  const expected = c.value;

  switch (c.operator) {
    case 'equals': {
      const passed = actual === expected;
      return {
        passed,
        reason: passed
          ? `"${c.field}" equals "${String(expected)}"`
          : `"${c.field}" is "${String(actual)}", expected "${String(expected)}"`,
      };
    }

    case 'notEquals': {
      const passed = actual !== expected;
      return {
        passed,
        reason: passed
          ? `"${c.field}" is not "${String(expected)}"`
          : `"${c.field}" equals "${String(expected)}" but should not`,
      };
    }

    case 'contains': {
      const passed =
        typeof actual === 'string'
          ? actual.includes(String(expected))
          : Array.isArray(actual)
            ? actual.includes(expected)
            : false;
      return {
        passed,
        reason: passed
          ? `"${c.field}" contains "${String(expected)}"`
          : `"${c.field}" does not contain "${String(expected)}"`,
      };
    }

    case 'in': {
      const list = expected as unknown[];
      const passed = list.includes(actual);
      return {
        passed,
        reason: passed
          ? `"${c.field}" is in [${list.join(', ')}]`
          : `"${c.field}" ("${String(actual)}") is not in [${list.join(', ')}]`,
      };
    }

    case 'notIn': {
      const list = expected as unknown[];
      const passed = !list.includes(actual);
      return {
        passed,
        reason: passed
          ? `"${c.field}" is not in [${list.join(', ')}]`
          : `"${c.field}" ("${String(actual)}") is in [${list.join(', ')}]`,
      };
    }

    case 'greaterThan':
    case 'lessThan': {
      if (!isNumeric(actual)) {
        return {
          passed: false,
          reason: `"${c.field}" is not numeric`,
        };
      }
      const numActual = Number(actual);
      const numExpected = Number(expected);
      const greater = c.operator === 'greaterThan';
      const passed = greater
        ? numActual > numExpected
        : numActual < numExpected;
      const sign = greater ? '>' : '<';
      return {
        passed,
        reason: passed
          ? `"${c.field}" (${numActual}) ${sign} ${numExpected}`
          : `"${c.field}" (${numActual}) is not ${sign} ${numExpected}`,
      };
    }

    case 'matches': {
      if (typeof actual !== 'string') {
        return {
          passed: false,
          reason: `"${c.field}" is not a string`,
        };
      }
      const passed = new RegExp(String(expected)).test(actual);
      return {
        passed,
        reason: passed
          ? `"${c.field}" matches /${String(expected)}/`
          : `"${c.field}" ("${actual}") does not match /${String(expected)}/`,
      };
    }

    case 'ipInRange': {
      const range = String(expected);
      if (actual === undefined || actual === null) {
        return { passed: false, reason: `"${c.field}" is not set` };
      }
      const ip = typeof actual === 'string' ? normalizeIp(actual) : '';
      const family = isIP(ip);
      if (family === 0) {
        // The request carries something that is not an IP address. A DENY
        // must not be dodged by sending garbage, so this fails closed too.
        return {
          passed: false,
          indeterminate: true,
          reason: `"${c.field}" (${show(actual)}) is not an IP address`,
        };
      }
      const passed = (parseIpRange(range) as BlockList).check(
        ip,
        family === 4 ? 'ipv4' : 'ipv6',
      );
      return {
        passed,
        reason: passed
          ? `IP "${ip}" is in range "${range}"`
          : `IP "${ip}" is not in range "${range}"`,
      };
    }
  }
}

// ─── Condition-group evaluation ───────────────────────────────────────────────

/**
 * Parse a raw JSON conditions blob (from DB) into a list of conditions.
 * If the stored value is null / undefined / empty, returns an empty array
 * (vacuous truth). Each entry is validated when it is evaluated.
 */
function parseConditions(raw: unknown): unknown[] {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) return raw;
  // Allow a single condition object (not wrapped in array)
  return [raw];
}

/**
 * Evaluate a set of conditions (from one condition category like subjectConditions).
 * The `logic` param controls whether ALL ("AND") or ANY ("OR") must pass.
 */
function evaluateConditions(
  conditions: unknown[],
  context: Record<string, unknown>,
  logic: 'AND' | 'OR',
): { passed: boolean; results: ConditionResult[] } {
  if (conditions.length === 0) {
    return { passed: true, results: [] };
  }

  const results = conditions.map((c) => evaluateCondition(c, context));

  const passed =
    logic === 'AND'
      ? results.every((r) => r.passed)
      : results.some((r) => r.passed);

  return { passed, results };
}

// ─── Policy evaluation ────────────────────────────────────────────────────────

/**
 * Build a flat context object from the evaluation request so conditions can
 * address fields via dot-notation.
 */
function buildContext(req: PolicyEvaluationRequest): Record<string, unknown> {
  return {
    subject: req.subject,
    resource: req.resource,
    action: req.action,
    environment: req.environment ?? {},
  };
}

/**
 * Evaluate a single policy against the request.
 * Returns the match detail including per-condition results.
 *
 * Fail closed: when any part of the policy cannot be evaluated (an invalid
 * condition, an unknown `effect` or `logic`), the policy is
 * `indeterminate`. An indeterminate DENY matches, whatever its other
 * conditions say; an indeterminate ALLOW never matches. An unknown
 * `effect` is treated as DENY.
 */
export function evaluatePolicy(
  policy: RawPolicy,
  req: PolicyEvaluationRequest,
): PolicyMatchDetail {
  const context = buildContext(req);
  const effect: 'ALLOW' | 'DENY' = policy.effect === 'ALLOW' ? 'ALLOW' : 'DENY';
  const conditionResults: PolicyMatchDetail['conditionResults'] = [];

  let indeterminate = false;
  if (policy.effect !== 'ALLOW' && policy.effect !== 'DENY') {
    indeterminate = true;
    conditionResults.push({
      conditionType: 'policy',
      passed: false,
      indeterminate: true,
      reason: `unknown effect "${String(policy.effect)}", treated as DENY`,
    });
  }
  if (policy.logic !== 'AND' && policy.logic !== 'OR') {
    indeterminate = true;
    conditionResults.push({
      conditionType: 'policy',
      passed: false,
      indeterminate: true,
      reason: `unknown logic "${String(policy.logic)}"`,
    });
  }
  const logic = policy.logic === 'OR' ? 'OR' : 'AND';

  const conditionTypes = [
    { type: 'subject', raw: policy.subjectConditions },
    { type: 'resource', raw: policy.resourceConditions },
    { type: 'action', raw: policy.actionConditions },
    { type: 'environment', raw: policy.environmentConditions },
  ];

  let policyPassed = true;

  for (const { type, raw } of conditionTypes) {
    const conditions = parseConditions(raw);
    if (conditions.length === 0) continue;

    const { passed, results } = evaluateConditions(conditions, context, logic);

    for (const r of results) {
      if (r.indeterminate) indeterminate = true;
      conditionResults.push({
        conditionType: type,
        passed: r.passed,
        reason: r.reason,
        ...(r.indeterminate ? { indeterminate: true } : {}),
      });
    }

    // Between category groups we always use AND — ALL categories must pass
    if (!passed) {
      policyPassed = false;
    }
  }

  return {
    policyId: policy.id,
    policyName: policy.name,
    effect,
    matched: indeterminate ? effect === 'DENY' : policyPassed,
    ...(indeterminate ? { indeterminate: true } : {}),
    conditionResults,
  };
}

/**
 * Whether a policy applies to a request, by client:
 * - a policy without `clientId` applies to every request;
 * - a policy with a `clientId` applies only to requests that name that
 *   same client. A request without `clientId` gets the global policies only.
 */
export function policyAppliesToClient(
  policy: Pick<RawPolicy, 'clientId'>,
  clientId: string | undefined,
): boolean {
  if (policy.clientId === null || policy.clientId === undefined) return true;
  return clientId !== undefined && policy.clientId === clientId;
}

// ─── Multi-policy evaluation (DENY-override, priority ordering) ───────────────

/**
 * Evaluate all applicable policies and produce a final decision.
 *
 * Algorithm:
 * 1. Keep the enabled policies that apply to the request's client
 *    (see {@link policyAppliesToClient}).
 * 2. Sort by priority descending (higher priority evaluated first).
 * 3. Collect all matching policies (an indeterminate DENY matches).
 * 4. If any DENY policy matches → final decision is DENY.
 * 5. If at least one ALLOW policy matches → final decision is ALLOW.
 * 6. If no policy matches → default DENY.
 */
export function evaluatePolicies(
  policies: RawPolicy[],
  req: PolicyEvaluationRequest,
): PolicyEvaluationResult {
  const applicable = policies
    .filter((p) => p.enabled && policyAppliesToClient(p, req.clientId))
    .sort((a, b) => b.priority - a.priority);

  const matchDetails: PolicyMatchDetail[] = [];

  for (const policy of applicable) {
    const detail = evaluatePolicy(policy, req);
    matchDetails.push(detail);
  }

  const matched = matchDetails.filter((d) => d.matched);

  const denyMatch = matched.find((d) => d.effect === 'DENY');
  if (denyMatch) {
    return {
      decision: 'DENY',
      reason: denyMatch.indeterminate
        ? `DENY by policy "${denyMatch.policyName}": it cannot be evaluated, so it fails closed`
        : `Explicit DENY by policy "${denyMatch.policyName}"`,
      matchedPolicies: matchDetails,
      evaluatedCount: applicable.length,
    };
  }

  const allowMatch = matched.find((d) => d.effect === 'ALLOW');
  if (allowMatch) {
    return {
      decision: 'ALLOW',
      reason: `Permitted by policy "${allowMatch.policyName}"`,
      matchedPolicies: matchDetails,
      evaluatedCount: applicable.length,
    };
  }

  return {
    decision: 'DENY',
    reason: 'No matching policy — default deny',
    matchedPolicies: matchDetails,
    evaluatedCount: applicable.length,
  };
}
