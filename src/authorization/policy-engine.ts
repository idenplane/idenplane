/**
 * Pure-function ABAC policy engine.
 *
 * All evaluation logic lives here so it can be tested independently of
 * NestJS infrastructure.
 */

// ─── Condition types ─────────────────────────────────────────────────────────

export type ConditionOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'in'
  | 'notIn'
  | 'greaterThan'
  | 'lessThan'
  | 'matches'
  | 'ipInRange';

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
  conditionResults: Array<{
    conditionType: string;
    passed: boolean;
    reason?: string;
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
 * Resolve a dot-notation path against an object.
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
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Parse a CIDR range (e.g. "192.168.0.0/24") and decide whether an IPv4
 * address falls within it.  IPv6 CIDRs are not supported and will always
 * return false.
 */
function ipInCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split('/');
  if (!range || !bitsStr) return false;

  const bits = parseInt(bitsStr, 10);
  if (isNaN(bits) || bits < 0 || bits > 32) return false;

  const ipToInt = (addr: string): number | null => {
    const parts = addr.split('.').map(Number);
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return null;
    }
    return (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
  };

  const ipInt = ipToInt(ip);
  const rangeInt = ipToInt(range);
  if (ipInt === null || rangeInt === null) return false;

  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((ipInt >>> 0) & mask) === ((rangeInt >>> 0) & mask);
}

// ─── Core condition evaluation ────────────────────────────────────────────────

/**
 * Evaluate a single condition against a flat evaluation context.
 * The context is built by the caller and contains top-level keys:
 * subject, resource, action, environment.
 */
export function evaluateCondition(
  condition: Condition,
  context: Record<string, unknown>,
): { passed: boolean; reason: string } {
  const actual = resolveField(context, condition.field);
  const expected = condition.value;

  switch (condition.operator) {
    case 'equals': {
      const passed = actual === expected;
      return {
        passed,
        reason: passed
          ? `"${condition.field}" equals "${String(expected)}"`
          : `"${condition.field}" is "${String(actual)}", expected "${String(expected)}"`,
      };
    }

    case 'notEquals': {
      const passed = actual !== expected;
      return {
        passed,
        reason: passed
          ? `"${condition.field}" is not "${String(expected)}"`
          : `"${condition.field}" equals "${String(expected)}" but should not`,
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
          ? `"${condition.field}" contains "${String(expected)}"`
          : `"${condition.field}" does not contain "${String(expected)}"`,
      };
    }

    case 'in': {
      if (!Array.isArray(expected)) {
        return {
          passed: false,
          reason: `operator "in" requires an array value`,
        };
      }
      const passed = expected.includes(actual);
      return {
        passed,
        reason: passed
          ? `"${condition.field}" is in [${expected.join(', ')}]`
          : `"${condition.field}" ("${String(actual)}") is not in [${expected.join(', ')}]`,
      };
    }

    case 'notIn': {
      if (!Array.isArray(expected)) {
        return {
          passed: false,
          reason: `operator "notIn" requires an array value`,
        };
      }
      const passed = !expected.includes(actual);
      return {
        passed,
        reason: passed
          ? `"${condition.field}" is not in [${expected.join(', ')}]`
          : `"${condition.field}" ("${String(actual)}") is in [${expected.join(', ')}]`,
      };
    }

    case 'greaterThan': {
      const numActual = Number(actual);
      const numExpected = Number(expected);
      if (isNaN(numActual) || isNaN(numExpected)) {
        return {
          passed: false,
          reason: `"${condition.field}" or value is not numeric`,
        };
      }
      const passed = numActual > numExpected;
      return {
        passed,
        reason: passed
          ? `"${condition.field}" (${numActual}) > ${numExpected}`
          : `"${condition.field}" (${numActual}) is not > ${numExpected}`,
      };
    }

    case 'lessThan': {
      const numActual = Number(actual);
      const numExpected = Number(expected);
      if (isNaN(numActual) || isNaN(numExpected)) {
        return {
          passed: false,
          reason: `"${condition.field}" or value is not numeric`,
        };
      }
      const passed = numActual < numExpected;
      return {
        passed,
        reason: passed
          ? `"${condition.field}" (${numActual}) < ${numExpected}`
          : `"${condition.field}" (${numActual}) is not < ${numExpected}`,
      };
    }

    case 'matches': {
      if (typeof actual !== 'string') {
        return {
          passed: false,
          reason: `"${condition.field}" is not a string`,
        };
      }
      let regex: RegExp;
      try {
        regex = new RegExp(String(expected));
      } catch {
        return { passed: false, reason: `invalid regex: "${expected}"` };
      }
      const passed = regex.test(actual);
      return {
        passed,
        reason: passed
          ? `"${condition.field}" matches /${String(expected)}/`
          : `"${condition.field}" ("${String(actual)}") does not match /${String(expected)}/`,
      };
    }

    case 'ipInRange': {
      if (typeof actual !== 'string') {
        return {
          passed: false,
          reason: `"${condition.field}" is not a string IP`,
        };
      }
      const cidr = String(expected);
      const passed = ipInCidr(actual, cidr);
      return {
        passed,
        reason: passed
          ? `IP "${actual}" is in range "${cidr}"`
          : `IP "${actual}" is not in range "${cidr}"`,
      };
    }

    default:
      return {
        passed: false,
        reason: `unknown operator "${String(condition.operator)}"`,
      };
  }
}

// ─── Condition-group evaluation ───────────────────────────────────────────────

/**
 * Parse a raw JSON conditions blob (from DB) into an array of Condition objects.
 * If the stored value is null / undefined / empty, returns an empty array (vacuous truth).
 */
function parseConditions(raw: unknown): Condition[] {
  if (!raw || (Array.isArray(raw) && raw.length === 0)) return [];
  if (Array.isArray(raw)) return raw as Condition[];
  // Allow a single condition object (not wrapped in array)
  return [raw as Condition];
}

/**
 * Evaluate a set of conditions (from one condition category like subjectConditions).
 * The `logic` param controls whether ALL ("AND") or ANY ("OR") must pass.
 */
function evaluateConditions(
  conditions: Condition[],
  context: Record<string, unknown>,
  logic: 'AND' | 'OR',
): { passed: boolean; results: Array<{ passed: boolean; reason: string }> } {
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
 */
export function evaluatePolicy(
  policy: RawPolicy,
  req: PolicyEvaluationRequest,
): PolicyMatchDetail {
  const context = buildContext(req);
  const logic = policy.logic === 'OR' ? 'OR' : 'AND';

  const conditionTypes = [
    { type: 'subject', raw: policy.subjectConditions },
    { type: 'resource', raw: policy.resourceConditions },
    { type: 'action', raw: policy.actionConditions },
    { type: 'environment', raw: policy.environmentConditions },
  ];

  const conditionResults: PolicyMatchDetail['conditionResults'] = [];
  let policyPassed = true;

  for (const { type, raw } of conditionTypes) {
    const conditions = parseConditions(raw);
    if (conditions.length === 0) continue;

    const { passed, results } = evaluateConditions(conditions, context, logic);

    for (const r of results) {
      conditionResults.push({
        conditionType: type,
        passed: r.passed,
        reason: r.reason,
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
    effect: policy.effect === 'DENY' ? 'DENY' : 'ALLOW',
    matched: policyPassed,
    conditionResults,
  };
}

// ─── Multi-policy evaluation (DENY-override, priority ordering) ───────────────

/**
 * Evaluate all applicable policies and produce a final decision.
 *
 * Algorithm:
 * 1. Sort by priority descending (higher priority evaluated first).
 * 2. Collect all matching policies.
 * 3. If any DENY policy matches → final decision is DENY.
 * 4. If at least one ALLOW policy matches → final decision is ALLOW.
 * 5. If no policy matches → default DENY.
 */
export function evaluatePolicies(
  policies: RawPolicy[],
  req: PolicyEvaluationRequest,
): PolicyEvaluationResult {
  // Only evaluate enabled policies
  const applicable = policies
    .filter((p) => p.enabled)
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
      reason: `Explicit DENY by policy "${denyMatch.policyName}"`,
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
