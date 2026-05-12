import {
  evaluateCondition,
  evaluatePolicy,
  evaluatePolicies,
  type RawPolicy,
  type PolicyEvaluationRequest,
  type Condition,
} from './policy-engine.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePolicy(overrides: Partial<RawPolicy> = {}): RawPolicy {
  return {
    id: 'policy-1',
    name: 'test-policy',
    enabled: true,
    effect: 'ALLOW',
    priority: 0,
    logic: 'AND',
    clientId: null,
    subjectConditions: null,
    resourceConditions: null,
    actionConditions: null,
    environmentConditions: null,
    ...overrides,
  };
}

function makeRequest(
  overrides: Partial<PolicyEvaluationRequest> = {},
): PolicyEvaluationRequest {
  return {
    subject: { userId: 'user-1', roles: ['viewer'], groups: ['engineering'] },
    resource: { type: 'report', id: 'report-1', ownerId: 'user-1' },
    action: 'read',
    environment: { ip: '192.168.1.100' },
    ...overrides,
  };
}

// ─── evaluateCondition ────────────────────────────────────────────────────────

describe('evaluateCondition', () => {
  const ctx = {
    subject: {
      userId: 'user-1',
      roles: ['admin', 'viewer'],
      attributes: { department: 'engineering' },
    },
    resource: { type: 'report', id: 'rep-1', ownerId: 'user-1' },
    action: 'read',
    environment: { ip: '10.0.0.5' },
  };

  describe('equals', () => {
    it('returns passed=true when values match', () => {
      const c: Condition = {
        field: 'action',
        operator: 'equals',
        value: 'read',
      };
      expect(evaluateCondition(c, ctx).passed).toBe(true);
    });

    it('returns passed=false when values differ', () => {
      const c: Condition = {
        field: 'action',
        operator: 'equals',
        value: 'write',
      };
      expect(evaluateCondition(c, ctx).passed).toBe(false);
    });
  });

  describe('notEquals', () => {
    it('passes when values are different', () => {
      const c: Condition = {
        field: 'action',
        operator: 'notEquals',
        value: 'delete',
      };
      expect(evaluateCondition(c, ctx).passed).toBe(true);
    });

    it('fails when values are equal', () => {
      const c: Condition = {
        field: 'action',
        operator: 'notEquals',
        value: 'read',
      };
      expect(evaluateCondition(c, ctx).passed).toBe(false);
    });
  });

  describe('contains', () => {
    it('passes when array contains value', () => {
      const c: Condition = {
        field: 'subject.roles',
        operator: 'contains',
        value: 'admin',
      };
      expect(evaluateCondition(c, ctx).passed).toBe(true);
    });

    it('fails when array does not contain value', () => {
      const c: Condition = {
        field: 'subject.roles',
        operator: 'contains',
        value: 'superadmin',
      };
      expect(evaluateCondition(c, ctx).passed).toBe(false);
    });

    it('passes when string contains substring', () => {
      const c: Condition = {
        field: 'action',
        operator: 'contains',
        value: 'rea',
      };
      expect(evaluateCondition(c, ctx).passed).toBe(true);
    });
  });

  describe('in', () => {
    it('passes when field value is in the list', () => {
      const c: Condition = {
        field: 'action',
        operator: 'in',
        value: ['read', 'list'],
      };
      expect(evaluateCondition(c, ctx).passed).toBe(true);
    });

    it('fails when field value is not in the list', () => {
      const c: Condition = {
        field: 'action',
        operator: 'in',
        value: ['write', 'delete'],
      };
      expect(evaluateCondition(c, ctx).passed).toBe(false);
    });

    it('fails gracefully when value is not an array', () => {
      const c: Condition = {
        field: 'action',
        operator: 'in',
        value: 'read',
      };
      const result = evaluateCondition(c, ctx);
      expect(result.passed).toBe(false);
      expect(result.reason).toMatch(/requires an array/);
    });
  });

  describe('notIn', () => {
    it('passes when field value is not in the list', () => {
      const c: Condition = {
        field: 'action',
        operator: 'notIn',
        value: ['write', 'delete'],
      };
      expect(evaluateCondition(c, ctx).passed).toBe(true);
    });

    it('fails when field value is in the list', () => {
      const c: Condition = {
        field: 'action',
        operator: 'notIn',
        value: ['read', 'write'],
      };
      expect(evaluateCondition(c, ctx).passed).toBe(false);
    });
  });

  describe('greaterThan', () => {
    const numCtx = { level: 5 };

    it('passes when actual > expected', () => {
      const c: Condition = {
        field: 'level',
        operator: 'greaterThan',
        value: 3,
      };
      expect(evaluateCondition(c, numCtx).passed).toBe(true);
    });

    it('fails when actual <= expected', () => {
      const c: Condition = {
        field: 'level',
        operator: 'greaterThan',
        value: 5,
      };
      expect(evaluateCondition(c, numCtx).passed).toBe(false);
    });

    it('fails gracefully on non-numeric field', () => {
      const c: Condition = {
        field: 'action',
        operator: 'greaterThan',
        value: 3,
      };
      const result = evaluateCondition(c, ctx);
      expect(result.passed).toBe(false);
      expect(result.reason).toMatch(/not numeric/);
    });
  });

  describe('lessThan', () => {
    const numCtx = { level: 2 };

    it('passes when actual < expected', () => {
      const c: Condition = { field: 'level', operator: 'lessThan', value: 5 };
      expect(evaluateCondition(c, numCtx).passed).toBe(true);
    });

    it('fails when actual >= expected', () => {
      const c: Condition = { field: 'level', operator: 'lessThan', value: 2 };
      expect(evaluateCondition(c, numCtx).passed).toBe(false);
    });
  });

  describe('matches (regex)', () => {
    it('passes when string matches regex', () => {
      const c: Condition = {
        field: 'action',
        operator: 'matches',
        value: '^re',
      };
      expect(evaluateCondition(c, ctx).passed).toBe(true);
    });

    it('fails when string does not match regex', () => {
      const c: Condition = {
        field: 'action',
        operator: 'matches',
        value: '^write',
      };
      expect(evaluateCondition(c, ctx).passed).toBe(false);
    });

    it('fails gracefully with invalid regex', () => {
      const c: Condition = {
        field: 'action',
        operator: 'matches',
        value: '[invalid',
      };
      const result = evaluateCondition(c, ctx);
      expect(result.passed).toBe(false);
      expect(result.reason).toMatch(/invalid regex/);
    });

    it('fails gracefully when field is not a string', () => {
      const c: Condition = {
        field: 'subject.roles',
        operator: 'matches',
        value: 'admin',
      };
      const result = evaluateCondition(c, ctx);
      expect(result.passed).toBe(false);
      expect(result.reason).toMatch(/not a string/);
    });
  });

  describe('ipInRange', () => {
    it('passes when IP is within CIDR', () => {
      const c: Condition = {
        field: 'environment.ip',
        operator: 'ipInRange',
        value: '10.0.0.0/8',
      };
      expect(evaluateCondition(c, ctx).passed).toBe(true);
    });

    it('fails when IP is outside CIDR', () => {
      const c: Condition = {
        field: 'environment.ip',
        operator: 'ipInRange',
        value: '192.168.0.0/24',
      };
      expect(evaluateCondition(c, ctx).passed).toBe(false);
    });

    it('handles /32 (exact match)', () => {
      const c: Condition = {
        field: 'environment.ip',
        operator: 'ipInRange',
        value: '10.0.0.5/32',
      };
      expect(evaluateCondition(c, ctx).passed).toBe(true);
    });

    it('handles /0 (any IP)', () => {
      const c: Condition = {
        field: 'environment.ip',
        operator: 'ipInRange',
        value: '0.0.0.0/0',
      };
      expect(evaluateCondition(c, ctx).passed).toBe(true);
    });

    it('fails gracefully when field is not a string', () => {
      const c: Condition = {
        field: 'subject.roles',
        operator: 'ipInRange',
        value: '10.0.0.0/8',
      };
      const result = evaluateCondition(c, ctx);
      expect(result.passed).toBe(false);
      expect(result.reason).toMatch(/not a string IP/);
    });

    it('fails on invalid CIDR', () => {
      const c: Condition = {
        field: 'environment.ip',
        operator: 'ipInRange',
        value: 'not-a-cidr',
      };
      expect(evaluateCondition(c, ctx).passed).toBe(false);
    });
  });

  describe('dot-notation field resolution', () => {
    it('resolves nested field correctly', () => {
      const c: Condition = {
        field: 'subject.attributes.department',
        operator: 'equals',
        value: 'engineering',
      };
      expect(evaluateCondition(c, ctx).passed).toBe(true);
    });

    it('returns false for missing field path', () => {
      const c: Condition = {
        field: 'subject.nonexistent.deep',
        operator: 'equals',
        value: 'x',
      };
      expect(evaluateCondition(c, ctx).passed).toBe(false);
    });
  });
});

// ─── evaluatePolicy ───────────────────────────────────────────────────────────

describe('evaluatePolicy', () => {
  it('returns matched=true with no conditions (vacuous truth)', () => {
    const policy = makePolicy();
    const req = makeRequest();
    const detail = evaluatePolicy(policy, req);
    expect(detail.matched).toBe(true);
    expect(detail.effect).toBe('ALLOW');
    expect(detail.conditionResults).toHaveLength(0);
  });

  it('returns matched=false when a condition fails', () => {
    const policy = makePolicy({
      actionConditions: [
        { field: 'action', operator: 'equals', value: 'write' },
      ],
    });
    const req = makeRequest({ action: 'read' });
    const detail = evaluatePolicy(policy, req);
    expect(detail.matched).toBe(false);
    expect(detail.conditionResults[0]?.passed).toBe(false);
  });

  it('returns matched=true when all conditions pass (AND logic)', () => {
    const policy = makePolicy({
      logic: 'AND',
      subjectConditions: [
        { field: 'subject.roles', operator: 'contains', value: 'admin' },
      ],
      actionConditions: [
        { field: 'action', operator: 'equals', value: 'delete' },
      ],
    });
    const req = makeRequest({
      subject: { roles: ['admin'] },
      action: 'delete',
    });
    const detail = evaluatePolicy(policy, req);
    expect(detail.matched).toBe(true);
  });

  it('returns matched=false when one category fails (AND between categories)', () => {
    const policy = makePolicy({
      logic: 'AND',
      subjectConditions: [
        { field: 'subject.roles', operator: 'contains', value: 'admin' },
      ],
      actionConditions: [
        { field: 'action', operator: 'equals', value: 'write' },
      ],
    });
    const req = makeRequest({
      subject: { roles: ['admin'] },
      action: 'read', // does not match write
    });
    const detail = evaluatePolicy(policy, req);
    expect(detail.matched).toBe(false);
  });

  it('OR logic: passes when at least one condition in a category passes', () => {
    const policy = makePolicy({
      logic: 'OR',
      subjectConditions: [
        { field: 'subject.roles', operator: 'contains', value: 'superadmin' },
        { field: 'subject.roles', operator: 'contains', value: 'admin' },
      ],
    });
    const req = makeRequest({ subject: { roles: ['admin'] } });
    const detail = evaluatePolicy(policy, req);
    expect(detail.matched).toBe(true);
  });

  it('OR logic: fails when no condition in a category passes', () => {
    const policy = makePolicy({
      logic: 'OR',
      subjectConditions: [
        { field: 'subject.roles', operator: 'contains', value: 'superadmin' },
        { field: 'subject.roles', operator: 'contains', value: 'god' },
      ],
    });
    const req = makeRequest({ subject: { roles: ['viewer'] } });
    const detail = evaluatePolicy(policy, req);
    expect(detail.matched).toBe(false);
  });

  it('includes the effect from the policy', () => {
    const policy = makePolicy({ effect: 'DENY' });
    const req = makeRequest();
    const detail = evaluatePolicy(policy, req);
    expect(detail.effect).toBe('DENY');
  });

  it('includes policy id and name in the result', () => {
    const policy = makePolicy({ id: 'my-id', name: 'my-policy' });
    const req = makeRequest();
    const detail = evaluatePolicy(policy, req);
    expect(detail.policyId).toBe('my-id');
    expect(detail.policyName).toBe('my-policy');
  });
});

// ─── evaluatePolicies ─────────────────────────────────────────────────────────

describe('evaluatePolicies', () => {
  it('returns DENY (default) when no policies exist', () => {
    const result = evaluatePolicies([], makeRequest());
    expect(result.decision).toBe('DENY');
    expect(result.reason).toMatch(/default deny/);
    expect(result.evaluatedCount).toBe(0);
  });

  it('returns ALLOW when a matching ALLOW policy exists', () => {
    const policies: RawPolicy[] = [
      makePolicy({
        id: 'p1',
        name: 'allow-all',
        effect: 'ALLOW',
        // no conditions = matches everything
      }),
    ];
    const result = evaluatePolicies(policies, makeRequest());
    expect(result.decision).toBe('ALLOW');
    expect(result.reason).toContain('allow-all');
  });

  it('returns DENY when a DENY policy matches, even if an ALLOW policy also matches', () => {
    const policies: RawPolicy[] = [
      makePolicy({
        id: 'p1',
        name: 'allow-all',
        effect: 'ALLOW',
        priority: 0,
      }),
      makePolicy({
        id: 'p2',
        name: 'deny-blocked-users',
        effect: 'DENY',
        priority: 10,
        subjectConditions: [
          { field: 'subject.userId', operator: 'equals', value: 'user-1' },
        ],
      }),
    ];
    const result = evaluatePolicies(
      policies,
      makeRequest({ subject: { userId: 'user-1', roles: [] } }),
    );
    expect(result.decision).toBe('DENY');
    expect(result.reason).toContain('deny-blocked-users');
  });

  it('skips disabled policies', () => {
    const policies: RawPolicy[] = [
      makePolicy({
        id: 'p1',
        name: 'disabled-allow',
        effect: 'ALLOW',
        enabled: false,
      }),
    ];
    const result = evaluatePolicies(policies, makeRequest());
    expect(result.decision).toBe('DENY');
    expect(result.evaluatedCount).toBe(0);
  });

  it('evaluates policies in priority order (higher first)', () => {
    const policies: RawPolicy[] = [
      makePolicy({
        id: 'p-low',
        name: 'low-priority',
        effect: 'ALLOW',
        priority: 0,
      }),
      makePolicy({
        id: 'p-high',
        name: 'high-priority-deny',
        effect: 'DENY',
        priority: 100,
        // no conditions — matches everything
      }),
    ];
    const result = evaluatePolicies(policies, makeRequest());
    expect(result.decision).toBe('DENY');
    // DENY wins regardless of evaluation order, but we confirm the high-priority policy
    // appears first in matched policies
    const matched = result.matchedPolicies.filter((m) => m.matched);
    expect(matched[0]?.policyName).toBe('high-priority-deny');
  });

  it('returns DENY when no policy matches (no conditions fulfilled)', () => {
    const policies: RawPolicy[] = [
      makePolicy({
        id: 'p1',
        name: 'admin-only',
        effect: 'ALLOW',
        subjectConditions: [
          { field: 'subject.roles', operator: 'contains', value: 'admin' },
        ],
      }),
    ];
    const result = evaluatePolicies(
      policies,
      makeRequest({ subject: { roles: ['viewer'] } }),
    );
    expect(result.decision).toBe('DENY');
    expect(result.reason).toMatch(/No matching policy/);
  });

  it('populates matchedPolicies with all evaluated policies', () => {
    const policies: RawPolicy[] = [
      makePolicy({ id: 'p1', name: 'policy-one', effect: 'ALLOW' }),
      makePolicy({ id: 'p2', name: 'policy-two', effect: 'ALLOW' }),
    ];
    const result = evaluatePolicies(policies, makeRequest());
    expect(result.matchedPolicies).toHaveLength(2);
    expect(result.evaluatedCount).toBe(2);
  });

  it('includes detailed condition results in matched policies', () => {
    const policies: RawPolicy[] = [
      makePolicy({
        id: 'p1',
        name: 'action-check',
        effect: 'ALLOW',
        actionConditions: [
          { field: 'action', operator: 'equals', value: 'read' },
        ],
      }),
    ];
    const result = evaluatePolicies(policies, makeRequest({ action: 'read' }));
    const detail = result.matchedPolicies[0];
    expect(detail.conditionResults).toHaveLength(1);
    expect(detail.conditionResults[0]?.conditionType).toBe('action');
    expect(detail.conditionResults[0]?.passed).toBe(true);
  });

  it('handles environment conditions (IP range)', () => {
    const policies: RawPolicy[] = [
      makePolicy({
        id: 'p1',
        name: 'internal-only',
        effect: 'ALLOW',
        environmentConditions: [
          {
            field: 'environment.ip',
            operator: 'ipInRange',
            value: '10.0.0.0/8',
          },
        ],
      }),
    ];

    const internalReq = makeRequest({ environment: { ip: '10.5.3.1' } });
    const externalReq = makeRequest({ environment: { ip: '8.8.8.8' } });

    expect(evaluatePolicies(policies, internalReq).decision).toBe('ALLOW');
    expect(evaluatePolicies(policies, externalReq).decision).toBe('DENY');
  });

  it('handles resource conditions', () => {
    const policies: RawPolicy[] = [
      makePolicy({
        id: 'p1',
        name: 'owner-can-delete',
        effect: 'ALLOW',
        subjectConditions: [
          { field: 'subject.userId', operator: 'equals', value: 'user-1' },
        ],
        resourceConditions: [
          { field: 'resource.ownerId', operator: 'equals', value: 'user-1' },
        ],
        actionConditions: [
          { field: 'action', operator: 'equals', value: 'delete' },
        ],
      }),
    ];

    const ownerReq = makeRequest({
      subject: { userId: 'user-1', roles: [] },
      resource: { type: 'doc', id: 'doc-1', ownerId: 'user-1' },
      action: 'delete',
    });
    const nonOwnerReq = makeRequest({
      subject: { userId: 'user-2', roles: [] },
      resource: { type: 'doc', id: 'doc-1', ownerId: 'user-1' },
      action: 'delete',
    });

    expect(evaluatePolicies(policies, ownerReq).decision).toBe('ALLOW');
    expect(evaluatePolicies(policies, nonOwnerReq).decision).toBe('DENY');
  });
});
