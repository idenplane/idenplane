import {
  CONDITION_OPERATORS,
  conditionProblem,
  evaluateCondition,
  evaluatePolicies,
  evaluatePolicy,
  parseIpRange,
  policyAppliesToClient,
  policyProblems,
  type PolicyEvaluationRequest,
  type RawPolicy,
} from './policy-engine.js';

function policy(overrides: Partial<RawPolicy> = {}): RawPolicy {
  return {
    id: 'p',
    name: 'p',
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

function request(
  overrides: Partial<PolicyEvaluationRequest> = {},
): PolicyEvaluationRequest {
  return {
    subject: { userId: 'u1', roles: ['viewer'], attributes: { level: 3 } },
    resource: { type: 'report', id: 'r1', ownerId: 'u1' },
    action: 'read',
    environment: { ip: '203.0.113.7' },
    ...overrides,
  };
}

const allowAll = policy({ id: 'allow', name: 'allow-all', effect: 'ALLOW' });

/**
 * One valid and one evaluating-true condition per operator, against
 * {@link request}. Used to check every operator both ways.
 */
const OPERATOR_CASES: Record<
  (typeof CONDITION_OPERATORS)[number],
  { field: string; match: unknown; miss: unknown }
> = {
  equals: { field: 'action', match: 'read', miss: 'write' },
  notEquals: { field: 'action', match: 'write', miss: 'read' },
  contains: { field: 'subject.roles', match: 'viewer', miss: 'admin' },
  in: { field: 'action', match: ['read', 'list'], miss: ['write'] },
  notIn: { field: 'action', match: ['write'], miss: ['read', 'list'] },
  greaterThan: { field: 'subject.attributes.level', match: 2, miss: 3 },
  lessThan: { field: 'subject.attributes.level', match: '4', miss: 3 },
  matches: { field: 'resource.type', match: '^rep', miss: '^doc' },
  ipInRange: {
    field: 'environment.ip',
    match: '203.0.113.0/24',
    miss: '198.51.100.0/24',
  },
};

describe('policy engine: every operator', () => {
  const ctx = {
    subject: request().subject,
    resource: request().resource,
    action: 'read',
    environment: request().environment,
  };

  it('covers every operator the engine accepts', () => {
    expect(Object.keys(OPERATOR_CASES).sort()).toEqual(
      [...CONDITION_OPERATORS].sort(),
    );
  });

  it.each(Object.entries(OPERATOR_CASES))(
    '%s: valid, true on a match and false on a miss, never indeterminate',
    (operator, { field, match, miss }) => {
      expect(conditionProblem({ field, operator, value: match })).toBeNull();
      expect(conditionProblem({ field, operator, value: miss })).toBeNull();
      const hit = evaluateCondition({ field, operator, value: match }, ctx);
      const no = evaluateCondition({ field, operator, value: miss }, ctx);
      expect(hit).toMatchObject({ passed: true });
      expect(no).toMatchObject({ passed: false });
      expect(hit.indeterminate).toBeUndefined();
      expect(no.indeterminate).toBeUndefined();
    },
  );

  it.each(Object.entries(OPERATOR_CASES))(
    '%s as a DENY: denies on a match, does not on a miss',
    (operator, { field, match, miss }) => {
      const deny = (value: unknown) =>
        policy({
          id: 'deny',
          name: 'deny',
          effect: 'DENY',
          priority: 10,
          subjectConditions: [{ field, operator, value }],
        });
      expect(
        evaluatePolicies([allowAll, deny(match)], request()).decision,
      ).toBe('DENY');
      expect(evaluatePolicies([allowAll, deny(miss)], request()).decision).toBe(
        'ALLOW',
      );
    },
  );

  it('a condition on a field the request does not carry is false, not an error', () => {
    const r = evaluateCondition(
      { field: 'subject.attributes.missing', operator: 'equals', value: 'x' },
      ctx,
    );
    expect(r).toEqual(expect.objectContaining({ passed: false }));
    expect(r.indeterminate).toBeUndefined();
  });

  it('never follows inherited properties (constructor, __proto__)', () => {
    const r = evaluateCondition(
      { field: 'subject.constructor', operator: 'notEquals', value: null },
      ctx,
    );
    // resolves to undefined, which is "not null"
    expect(r.passed).toBe(true);
    expect(
      evaluateCondition(
        { field: 'subject.__proto__', operator: 'equals', value: null },
        ctx,
      ).passed,
    ).toBe(false);
  });
});

describe('policy engine: condition validation', () => {
  it.each([
    [
      { field: 'action', operator: 'equal', value: 'read' },
      /unknown operator "equal"/,
    ],
    [
      { field: 'action', operator: 'EQUALS', value: 'read' },
      /unknown operator/,
    ],
    [{ field: 'action', value: 'read' }, /unknown operator "undefined"/],
    [{ operator: 'equals', value: 'read' }, /"field" must be/],
    [{ field: '', operator: 'equals', value: 'read' }, /"field" must be/],
    [{ field: 'action', operator: 'equals' }, /"value" is required/],
    [
      { field: 'action', operator: 'equals', value: ['read'] },
      /needs a string/,
    ],
    [
      { field: 'action', operator: 'contains', value: { a: 1 } },
      /needs a string/,
    ],
    [{ field: 'action', operator: 'in', value: 'read' }, /needs an array/],
    [{ field: 'action', operator: 'notIn', value: 'read' }, /needs an array/],
    [{ field: 'x', operator: 'greaterThan', value: 'ten' }, /numeric/],
    [{ field: 'x', operator: 'lessThan', value: '' }, /numeric/],
    [
      { field: 'x', operator: 'matches', value: '[bad' },
      /invalid regular expression/,
    ],
    [
      { field: 'x', operator: 'matches', value: 5 },
      /regular expression string/,
    ],
    [{ field: 'x', operator: 'ipInRange', value: '10.0.0.0/33' }, /ipInRange/],
    [
      { field: 'x', operator: 'ipInRange', value: '2001:db8::/129' },
      /ipInRange/,
    ],
    [{ field: 'x', operator: 'ipInRange', value: 'not-a-cidr' }, /ipInRange/],
    [{ field: 'x', operator: 'ipInRange', value: '10.0.0.0/x' }, /ipInRange/],
    ['a string', /must be an object/],
    [null, /must be an object/],
    [['nested'], /must be an object/],
  ])('refuses %j', (condition, message) => {
    expect(conditionProblem(condition)).toMatch(message);
  });

  it('policyProblems reports paths, effect and logic', () => {
    expect(
      policyProblems({
        effect: 'deny',
        logic: 'XOR',
        subjectConditions: [
          { field: 'a', operator: 'equals', value: 'b' },
          { field: 'a', operator: 'equal', value: 'b' },
        ],
        environmentConditions: {
          field: 'ip',
          operator: 'ipInRange',
          value: 'x',
        },
      }).map((p) => p.path),
    ).toEqual([
      'effect',
      'logic',
      'subjectConditions[1]',
      'environmentConditions',
    ]);
    expect(
      policyProblems({
        effect: 'DENY',
        logic: 'OR',
        subjectConditions: null,
        actionConditions: [],
      }),
    ).toEqual([]);
  });
});

describe('policy engine: fail closed', () => {
  const typoDeny = policy({
    id: 'deny',
    name: 'block-contractors',
    effect: 'DENY',
    priority: 10,
    subjectConditions: [
      { field: 'subject.roles', operator: 'contain', value: 'contractor' },
    ],
  });

  it('a DENY with an unknown operator denies (it used to never match)', () => {
    const result = evaluatePolicies([allowAll, typoDeny], request());
    expect(result.decision).toBe('DENY');
    expect(result.reason).toMatch(/cannot be evaluated, so it fails closed/);
    const detail = result.matchedPolicies.find((d) => d.policyId === 'deny');
    expect(detail).toMatchObject({ matched: true, indeterminate: true });
    expect(detail?.conditionResults[0]).toMatchObject({
      indeterminate: true,
      reason: expect.stringMatching(/unknown operator "contain"/),
    });
  });

  it('denies whatever the other conditions say, with AND and with OR', () => {
    for (const logic of ['AND', 'OR']) {
      const p = policy({
        ...typoDeny,
        logic,
        subjectConditions: [
          {
            field: 'subject.userId',
            operator: 'equals',
            value: 'someone-else',
          },
          { field: 'subject.roles', operator: 'contain', value: 'x' },
        ],
        actionConditions: [
          { field: 'action', operator: 'equals', value: 'write' },
        ],
      });
      expect(evaluatePolicy(p, request())).toMatchObject({
        matched: true,
        indeterminate: true,
      });
    }
  });

  it.each([
    ['an invalid regex', { field: 'action', operator: 'matches', value: '(' }],
    ['in without an array', { field: 'action', operator: 'in', value: 'read' }],
    [
      'an invalid CIDR',
      { field: 'environment.ip', operator: 'ipInRange', value: '10.0.0.0/99' },
    ],
    [
      'a non-numeric bound',
      { field: 'x', operator: 'greaterThan', value: 'abc' },
    ],
    ['a condition without a field', { operator: 'equals', value: 'read' }],
    ['a condition that is not an object', 'equals read'],
  ])('a DENY with %s denies', (_label, condition) => {
    const p = policy({ ...typoDeny, actionConditions: [condition] });
    expect(evaluatePolicies([allowAll, p], request()).decision).toBe('DENY');
  });

  it('an unknown effect is treated as DENY', () => {
    const p = policy({
      id: 'lower',
      name: 'lowercase-deny',
      effect: 'deny',
      actionConditions: [
        { field: 'action', operator: 'equals', value: 'write' },
      ],
    });
    const result = evaluatePolicies([allowAll, p], request());
    expect(result.decision).toBe('DENY');
    expect(
      result.matchedPolicies.find((d) => d.policyId === 'lower'),
    ).toMatchObject({ effect: 'DENY', matched: true, indeterminate: true });
  });

  it('an unknown logic makes a DENY deny', () => {
    const p = policy({ ...typoDeny, logic: 'XOR', subjectConditions: null });
    expect(evaluatePolicies([allowAll, p], request()).decision).toBe('DENY');
  });

  it('an ALLOW that cannot be evaluated never allows', () => {
    const p = policy({
      effect: 'ALLOW',
      logic: 'OR',
      actionConditions: [
        { field: 'action', operator: 'equals', value: 'read' },
        { field: 'action', operator: 'equal', value: 'read' },
      ],
    });
    expect(evaluatePolicy(p, request())).toMatchObject({
      matched: false,
      indeterminate: true,
    });
    const result = evaluatePolicies([p], request());
    expect(result.decision).toBe('DENY');
    expect(result.reason).toMatch(/default deny/);
  });

  it('a disabled invalid DENY is ignored', () => {
    const p = policy({ ...typoDeny, enabled: false });
    expect(evaluatePolicies([allowAll, p], request()).decision).toBe('ALLOW');
  });

  it('a DENY on an IP range cannot be dodged with a value that is not an IP', () => {
    const p = policy({
      id: 'deny',
      name: 'block-range',
      effect: 'DENY',
      environmentConditions: [
        {
          field: 'environment.ip',
          operator: 'ipInRange',
          value: '203.0.113.0/24',
        },
      ],
    });
    expect(
      evaluatePolicies(
        [allowAll, p],
        request({ environment: { ip: 'garbage' } }),
      ).decision,
    ).toBe('DENY');
    // A request without any IP is not in the range.
    expect(
      evaluatePolicies([allowAll, p], request({ environment: {} })).decision,
    ).toBe('ALLOW');
  });
});

describe('policy engine: ipInRange', () => {
  const inRange = (ip: string, range: string) =>
    evaluateCondition(
      { field: 'environment.ip', operator: 'ipInRange', value: range },
      { environment: { ip } },
    ).passed;

  it.each([
    ['10.1.2.3', '10.0.0.0/8', true],
    ['11.0.0.1', '10.0.0.0/8', false],
    ['192.168.1.130', '192.168.1.128/25', true],
    ['192.168.1.127', '192.168.1.128/25', false],
    ['10.0.0.5', '10.0.0.5', true],
    ['10.0.0.5', '10.0.0.5/32', true],
    ['10.0.0.6', '10.0.0.5/32', false],
    ['8.8.8.8', '0.0.0.0/0', true],
  ])('IPv4 %s in %s → %s', (ip, range, expected) => {
    expect(inRange(ip, range)).toBe(expected);
  });

  it.each([
    ['2001:db8::1', '2001:db8::/32', true],
    ['2001:DB8:0:0:0:0:0:1', '2001:db8::/32', true],
    ['2001:db9::1', '2001:db8::/32', false],
    ['fe80::1', 'fe80::/10', true],
    ['fe80::1', 'fe80::1', true],
    ['::1', '::1/128', true],
    ['::2', '::1/128', false],
    ['2001:db8::1', '::/0', true],
    ['2001:db8:abcd:12::1', '2001:db8:abcd:12::/64', true],
    ['2001:db8:abcd:13::1', '2001:db8:abcd:12::/64', false],
  ])('IPv6 %s in %s → %s', (ip, range, expected) => {
    expect(inRange(ip, range)).toBe(expected);
  });

  it.each([
    // How a dual-stack socket reports an IPv4 peer. Before 0.11.0 this never
    // matched an IPv4 range, so an IPv4 DENY was skipped.
    ['::ffff:10.1.2.3', '10.0.0.0/8', true],
    ['::FFFF:10.1.2.3', '10.0.0.0/8', true],
    ['::ffff:a01:203', '10.0.0.0/8', true],
    ['::ffff:11.1.2.3', '10.0.0.0/8', false],
    ['10.1.2.3', '::ffff:10.0.0.0/104', true],
    ['::ffff:10.1.2.3', '::ffff:10.0.0.0/104', true],
  ])('IPv4-mapped %s in %s → %s', (ip, range, expected) => {
    expect(inRange(ip, range)).toBe(expected);
  });

  it('an IPv4 address is not in an IPv6 range and the other way round', () => {
    expect(inRange('10.0.0.1', '2001:db8::/32')).toBe(false);
    expect(inRange('2001:db8::1', '10.0.0.0/8')).toBe(false);
  });

  it('parseIpRange refuses what is not an address or CIDR', () => {
    for (const bad of [
      '',
      '10.0.0',
      '10.0.0.0/',
      '10.0.0.0/-1',
      '10.0.0.0/33',
      'fe80::/129',
      '::/1x',
      'host.example',
      5,
    ]) {
      expect(parseIpRange(bad)).toBeNull();
    }
    expect(parseIpRange(' 10.0.0.0/8 ')).not.toBeNull();
  });
});

describe('policy engine: client scoping', () => {
  const scopedDeny = policy({
    id: 'scoped-deny',
    name: 'deny-for-app-a',
    effect: 'DENY',
    clientId: 'app-a',
  });
  const scopedAllow = policy({
    id: 'scoped-allow',
    name: 'allow-for-app-a',
    effect: 'ALLOW',
    clientId: 'app-a',
  });

  it('policyAppliesToClient', () => {
    expect(policyAppliesToClient({ clientId: null }, undefined)).toBe(true);
    expect(policyAppliesToClient({ clientId: null }, 'app-a')).toBe(true);
    expect(policyAppliesToClient({ clientId: 'app-a' }, 'app-a')).toBe(true);
    expect(policyAppliesToClient({ clientId: 'app-a' }, 'app-b')).toBe(false);
    expect(policyAppliesToClient({ clientId: 'app-a' }, undefined)).toBe(false);
  });

  it('a client-scoped policy does not apply to a request without clientId', () => {
    // Before 0.11.0 this applied to every request without a clientId.
    const result = evaluatePolicies([scopedAllow], request());
    expect(result.decision).toBe('DENY');
    expect(result.evaluatedCount).toBe(0);
  });

  it('a client-scoped policy applies to its own client only', () => {
    expect(
      evaluatePolicies([scopedAllow], request({ clientId: 'app-a' })).decision,
    ).toBe('ALLOW');
    expect(
      evaluatePolicies([scopedAllow], request({ clientId: 'app-b' })).decision,
    ).toBe('DENY');
    expect(
      evaluatePolicies([allowAll, scopedDeny], request({ clientId: 'app-a' }))
        .decision,
    ).toBe('DENY');
    expect(
      evaluatePolicies([allowAll, scopedDeny], request({ clientId: 'app-b' }))
        .decision,
    ).toBe('ALLOW');
  });

  it('global policies apply to every request, with or without clientId', () => {
    const globalDeny = policy({ id: 'g', name: 'g', effect: 'DENY' });
    for (const clientId of [undefined, 'app-a']) {
      expect(
        evaluatePolicies([scopedAllow, globalDeny], request({ clientId }))
          .decision,
      ).toBe('DENY');
    }
  });
});
