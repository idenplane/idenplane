import {
  validateFlowSteps,
  isValidFlow,
  SUPPORTED_STEP_TYPES,
  CONDITION_FIELDS,
  MAX_FLOW_STEPS,
  type FlowValidationError,
} from './flow-validator.js';
import { DEFAULT_FLOWS } from './auth-flow.service.js';

// ─── Builders ──────────────────────────────────────────────

type RawStep = Record<string, unknown>;

function step(id: string, order: number, over: RawStep = {}): RawStep {
  return {
    id,
    type: 'password',
    required: true,
    order,
    condition: null,
    fallbackStepId: null,
    config: {},
    ...over,
  };
}

const pw = (over: RawStep = {}) => step('pw', 1, over);
const totp = (order = 2, over: RawStep = {}) =>
  step('otp', order, { type: 'totp', ...over });

function codes(errors: FlowValidationError[]): string[] {
  return errors.map((e) => e.code);
}

// ─── Valid flows ───────────────────────────────────────────

describe('validateFlowSteps: valid flows', () => {
  const cases: Array<[string, unknown]> = [
    ['single password step', [pw()]],
    ['single ldap step', [step('l', 1, { type: 'ldap' })]],
    ['passwordless webauthn', [step('w', 1, { type: 'webauthn' })]],
    ['password then totp', [pw(), totp()]],
    [
      'password then webauthn (2FA)',
      [pw(), step('w', 2, { type: 'webauthn' })],
    ],
    ['array order does not matter, `order` does', [totp(5), pw()]],
    [
      'identifying fallback: password -> webauthn',
      [
        pw({ fallbackStepId: 'w' }),
        step('w', 2, { type: 'webauthn' }),
        totp(3),
      ],
    ],
    [
      'second factor fallback: webauthn -> totp (post-identification)',
      [
        pw(),
        step('w', 2, { type: 'webauthn', fallbackStepId: 'otp' }),
        totp(3),
      ],
    ],
    [
      'fallback chain without cycle',
      [
        pw({ fallbackStepId: 'l' }),
        step('l', 2, { type: 'ldap', fallbackStepId: 'w' }),
        step('w', 3, { type: 'webauthn' }),
      ],
    ],
    [
      'missing optional fields',
      [{ id: 'a', type: 'password', required: true, order: 1 }],
    ],
    ['null config', [pw({ config: null })]],
    [
      'conditional optional second step',
      [
        pw(),
        totp(2, {
          required: false,
          condition: {
            field: 'user.groups',
            operator: 'in',
            value: ['admins'],
          },
        }),
      ],
    ],
    [
      'every operator with a matching value shape',
      [
        pw(),
        totp(2, {
          condition: { field: 'user.email', operator: 'eq', value: 'a@b.c' },
        }),
        step('s3', 3, {
          type: 'totp',
          condition: { field: 'risk.level', operator: 'neq', value: 0 },
        }),
        step('s4', 4, {
          type: 'totp',
          condition: {
            field: 'user.roles',
            operator: 'not_in',
            value: ['x', 1, true],
          },
        }),
        step('s5', 5, {
          type: 'totp',
          condition: { field: 'user.totpEnrolled', operator: 'exists' },
        }),
        step('s6', 6, {
          type: 'totp',
          condition: {
            field: 'client.clientId',
            operator: 'not_exists',
            value: null,
          },
        }),
      ],
    ],
    [
      'every config key the admin UI emits',
      [
        step('l', 1, { type: 'ldap', config: { federationProviderId: 'abc' } }),
        step('t', 2, {
          type: 'totp',
          config: { issuer: 'Acme', digits: 8, algorithm: 'SHA256' },
        }),
        step('w', 3, {
          type: 'webauthn',
          config: { rpName: 'Acme', userVerification: 'required' },
        }),
      ],
    ],
    [
      `exactly ${MAX_FLOW_STEPS} steps`,
      [
        pw(),
        ...Array.from({ length: MAX_FLOW_STEPS - 1 }, (_, i) =>
          step(`t${i}`, i + 2, { type: 'totp' }),
        ),
      ],
    ],
  ];

  it.each(cases)('%s', (_name, steps) => {
    expect(validateFlowSteps(steps)).toEqual([]);
    expect(isValidFlow(steps)).toBe(true);
  });

  it.each(DEFAULT_FLOWS.map((f) => [f.name, f.steps] as const))(
    'built-in default flow "%s" is valid',
    (_name, steps) => {
      expect(validateFlowSteps(steps)).toEqual([]);
    },
  );
});

// ─── Invalid flows ─────────────────────────────────────────

describe('validateFlowSteps: invalid flows', () => {
  const cases: Array<{
    name: string;
    steps: unknown;
    expect: Array<{ code: string; path: string }>;
  }> = [
    // Shape and size
    {
      name: 'not an array',
      steps: { a: 1 },
      expect: [{ code: 'steps_not_array', path: 'steps' }],
    },
    {
      name: 'null',
      steps: null,
      expect: [{ code: 'steps_not_array', path: 'steps' }],
    },
    {
      name: 'empty',
      steps: [],
      expect: [{ code: 'too_few_steps', path: 'steps' }],
    },
    {
      name: `more than ${MAX_FLOW_STEPS} steps`,
      steps: [
        pw(),
        ...Array.from({ length: MAX_FLOW_STEPS }, (_, i) =>
          step(`t${i}`, i + 2, { type: 'totp' }),
        ),
      ],
      expect: [{ code: 'too_many_steps', path: 'steps' }],
    },
    {
      name: 'step not an object',
      steps: [pw(), 'x'],
      expect: [{ code: 'step_not_object', path: 'steps[1]' }],
    },
    {
      name: 'step is an array',
      steps: [[]],
      expect: [{ code: 'step_not_object', path: 'steps[0]' }],
    },

    // Ids and orders
    {
      name: 'empty id',
      steps: [pw({ id: '' })],
      expect: [{ code: 'invalid_id', path: 'steps[0].id' }],
    },
    {
      name: 'blank id',
      steps: [pw({ id: '   ' })],
      expect: [{ code: 'invalid_id', path: 'steps[0].id' }],
    },
    {
      name: 'id too long',
      steps: [pw({ id: 'x'.repeat(101) })],
      expect: [{ code: 'invalid_id', path: 'steps[0].id' }],
    },
    {
      name: 'numeric id',
      steps: [pw({ id: 7 })],
      expect: [{ code: 'invalid_id', path: 'steps[0].id' }],
    },
    {
      name: 'duplicate ids (both flagged)',
      steps: [pw({ id: 'dup' }), totp(2, { id: 'dup' })],
      expect: [
        { code: 'duplicate_id', path: 'steps[0].id' },
        { code: 'duplicate_id', path: 'steps[1].id' },
      ],
    },
    {
      name: 'order 0',
      steps: [pw({ order: 0 })],
      expect: [{ code: 'invalid_order', path: 'steps[0].order' }],
    },
    {
      name: 'fractional order',
      steps: [pw({ order: 1.5 })],
      expect: [{ code: 'invalid_order', path: 'steps[0].order' }],
    },
    {
      name: 'string order',
      steps: [pw({ order: '1' })],
      expect: [{ code: 'invalid_order', path: 'steps[0].order' }],
    },
    {
      name: 'duplicate orders (both flagged)',
      steps: [pw(), totp(1)],
      expect: [
        { code: 'duplicate_order', path: 'steps[0].order' },
        { code: 'duplicate_order', path: 'steps[1].order' },
      ],
    },
    {
      name: 'non-boolean required',
      steps: [pw(), totp(2, { required: 'yes' })],
      expect: [{ code: 'invalid_required', path: 'steps[1].required' }],
    },

    // Types
    ...['social', 'email_otp', 'magic_link', 'consent', 'sms', ''].map((t) => ({
      name: `unsupported type '${t}'`,
      steps: [pw(), totp(2, { type: t })],
      expect: [{ code: 'unsupported_type', path: 'steps[1].type' }],
    })),
    {
      name: 'missing type',
      steps: [pw(), totp(2, { type: undefined })],
      expect: [{ code: 'unsupported_type', path: 'steps[1].type' }],
    },

    // First step
    {
      name: 'first step does not identify (totp)',
      steps: [totp(1), step('pw', 2)],
      expect: [{ code: 'first_step_not_identifying', path: 'steps[0].type' }],
    },
    {
      name: 'first step (by order, not position) does not identify',
      steps: [step('pw', 2), totp(1)],
      expect: [{ code: 'first_step_not_identifying', path: 'steps[1].type' }],
    },
    {
      name: 'first step optional',
      steps: [pw({ required: false })],
      expect: [{ code: 'first_step_not_required', path: 'steps[0].required' }],
    },
    {
      name: 'first step conditional',
      steps: [pw({ condition: { field: 'user.email', operator: 'exists' } })],
      expect: [{ code: 'first_step_conditional', path: 'steps[0].condition' }],
    },

    // Fallbacks
    {
      name: 'empty-string fallback',
      steps: [pw({ fallbackStepId: '' })],
      expect: [{ code: 'invalid_fallback', path: 'steps[0].fallbackStepId' }],
    },
    {
      name: 'numeric fallback',
      steps: [pw({ fallbackStepId: 3 })],
      expect: [{ code: 'invalid_fallback', path: 'steps[0].fallbackStepId' }],
    },
    {
      name: 'unknown fallback',
      steps: [pw({ fallbackStepId: 'ghost' })],
      expect: [
        { code: 'fallback_unknown_step', path: 'steps[0].fallbackStepId' },
      ],
    },
    {
      name: 'self fallback',
      steps: [pw({ fallbackStepId: 'pw' })],
      expect: [{ code: 'fallback_self', path: 'steps[0].fallbackStepId' }],
    },
    {
      name: 'fallback to the first step',
      steps: [pw(), totp(2, { fallbackStepId: 'pw' })],
      expect: [
        { code: 'fallback_to_first_step', path: 'steps[1].fallbackStepId' },
      ],
    },
    {
      name: 'fallback cycle reachable from the main path',
      steps: [
        pw({ fallbackStepId: 'a' }),
        step('a', 2, { type: 'ldap', fallbackStepId: 'b' }),
        step('b', 3, { type: 'webauthn', fallbackStepId: 'a' }),
      ],
      expect: [{ code: 'fallback_cycle', path: 'steps[1].fallbackStepId' }],
    },
    {
      name: 'detached fallback cycle: cycle and both steps unreachable',
      steps: [
        pw(),
        step('a', 2, { type: 'totp', fallbackStepId: 'b' }),
        step('b', 3, { type: 'totp', fallbackStepId: 'a' }),
      ],
      expect: [
        { code: 'fallback_cycle', path: 'steps[1].fallbackStepId' },
        { code: 'unreachable_step', path: 'steps[1]' },
        { code: 'unreachable_step', path: 'steps[2]' },
      ],
    },
    {
      name: 'identifying step falls back to a non-identifying step',
      steps: [pw({ fallbackStepId: 'otp' }), totp(2)],
      expect: [
        { code: 'fallback_not_identifying', path: 'steps[0].fallbackStepId' },
      ],
    },
    {
      name: 'identification chain: second hop to a non-identifying step',
      steps: [
        pw({ fallbackStepId: 'w' }),
        step('w', 2, { type: 'webauthn', fallbackStepId: 'otp' }),
        totp(3),
      ],
      expect: [
        { code: 'fallback_not_identifying', path: 'steps[1].fallbackStepId' },
      ],
    },

    // Conditions
    {
      name: 'condition not an object',
      steps: [pw(), totp(2, { condition: 'x' })],
      expect: [{ code: 'condition_invalid', path: 'steps[1].condition' }],
    },
    {
      name: 'condition field not whitelisted',
      steps: [
        pw(),
        totp(2, { condition: { field: 'user.password', operator: 'exists' } }),
      ],
      expect: [
        {
          code: 'condition_field_not_allowed',
          path: 'steps[1].condition.field',
        },
      ],
    },
    {
      name: 'condition field prototype trick',
      steps: [
        pw(),
        totp(2, {
          condition: { field: '__proto__.polluted', operator: 'exists' },
        }),
      ],
      expect: [
        {
          code: 'condition_field_not_allowed',
          path: 'steps[1].condition.field',
        },
      ],
    },
    {
      name: 'unknown operator',
      steps: [
        pw(),
        totp(2, {
          condition: { field: 'user.email', operator: 'regex', value: '.*' },
        }),
      ],
      expect: [
        {
          code: 'condition_operator_invalid',
          path: 'steps[1].condition.operator',
        },
      ],
    },
    {
      name: 'eq with an array value',
      steps: [
        pw(),
        totp(2, {
          condition: { field: 'user.email', operator: 'eq', value: ['a'] },
        }),
      ],
      expect: [
        { code: 'condition_value_invalid', path: 'steps[1].condition.value' },
      ],
    },
    {
      name: 'eq with an object value',
      steps: [
        pw(),
        totp(2, {
          condition: { field: 'user.email', operator: 'eq', value: { a: 1 } },
        }),
      ],
      expect: [
        { code: 'condition_value_invalid', path: 'steps[1].condition.value' },
      ],
    },
    {
      name: 'in with a scalar',
      steps: [
        pw(),
        totp(2, {
          condition: { field: 'user.groups', operator: 'in', value: 'admins' },
        }),
      ],
      expect: [
        { code: 'condition_value_invalid', path: 'steps[1].condition.value' },
      ],
    },
    {
      name: 'in with an empty array',
      steps: [
        pw(),
        totp(2, {
          condition: { field: 'user.groups', operator: 'in', value: [] },
        }),
      ],
      expect: [
        { code: 'condition_value_invalid', path: 'steps[1].condition.value' },
      ],
    },
    {
      name: 'not_in with nested arrays',
      steps: [
        pw(),
        totp(2, {
          condition: {
            field: 'user.groups',
            operator: 'not_in',
            value: [['a']],
          },
        }),
      ],
      expect: [
        { code: 'condition_value_invalid', path: 'steps[1].condition.value' },
      ],
    },
    {
      name: 'exists with a value',
      steps: [
        pw(),
        totp(2, {
          condition: { field: 'user.email', operator: 'exists', value: 'x' },
        }),
      ],
      expect: [
        { code: 'condition_value_invalid', path: 'steps[1].condition.value' },
      ],
    },

    // Config
    {
      name: 'config not an object',
      steps: [pw({ config: 'x' })],
      expect: [{ code: 'config_invalid', path: 'steps[0].config' }],
    },
    {
      name: 'config array',
      steps: [pw({ config: [] })],
      expect: [{ code: 'config_invalid', path: 'steps[0].config' }],
    },
    {
      name: 'password takes no config',
      steps: [pw({ config: { minLength: 8 } })],
      expect: [
        { code: 'config_unknown_key', path: 'steps[0].config.minLength' },
      ],
    },
    {
      name: 'totp unknown key',
      steps: [pw(), totp(2, { config: { period: 30 } })],
      expect: [{ code: 'config_unknown_key', path: 'steps[1].config.period' }],
    },
    {
      name: 'totp digits 7',
      steps: [pw(), totp(2, { config: { digits: 7 } })],
      expect: [
        { code: 'config_invalid_value', path: 'steps[1].config.digits' },
      ],
    },
    {
      name: 'totp digits as string',
      steps: [pw(), totp(2, { config: { digits: '6' } })],
      expect: [
        { code: 'config_invalid_value', path: 'steps[1].config.digits' },
      ],
    },
    {
      name: 'totp algorithm MD5',
      steps: [pw(), totp(2, { config: { algorithm: 'MD5' } })],
      expect: [
        { code: 'config_invalid_value', path: 'steps[1].config.algorithm' },
      ],
    },
    {
      name: 'totp issuer not a string',
      steps: [pw(), totp(2, { config: { issuer: 5 } })],
      expect: [
        { code: 'config_invalid_value', path: 'steps[1].config.issuer' },
      ],
    },
    {
      name: 'webauthn userVerification invalid',
      steps: [
        step('w', 1, {
          type: 'webauthn',
          config: { userVerification: 'always' },
        }),
      ],
      expect: [
        {
          code: 'config_invalid_value',
          path: 'steps[0].config.userVerification',
        },
      ],
    },
    {
      name: 'webauthn rpName too long',
      steps: [
        step('w', 1, { type: 'webauthn', config: { rpName: 'x'.repeat(101) } }),
      ],
      expect: [
        { code: 'config_invalid_value', path: 'steps[0].config.rpName' },
      ],
    },
    {
      name: 'ldap unknown key',
      steps: [step('l', 1, { type: 'ldap', config: { bindDn: 'cn=x' } })],
      expect: [{ code: 'config_unknown_key', path: 'steps[0].config.bindDn' }],
    },
  ];

  it.each(cases)('$name', ({ steps, expect: expected }) => {
    const errors = validateFlowSteps(steps);
    expect(errors.map((e) => ({ code: e.code, path: e.path }))).toEqual(
      expected,
    );
    for (const e of errors) expect(e.message.length).toBeGreaterThan(0);
    expect(isValidFlow(steps)).toBe(false);
  });
});

// ─── Behaviour ─────────────────────────────────────────────

describe('validateFlowSteps: behaviour', () => {
  it('reports several independent problems at once', () => {
    const errors = validateFlowSteps([
      pw({ required: false, config: { x: 1 } }),
      totp(2, { type: 'consent' }),
    ]);
    expect(codes(errors).sort()).toEqual(
      [
        'config_unknown_key',
        'first_step_not_required',
        'unsupported_type',
      ].sort(),
    );
  });

  it('stops before graph rules when ids/orders are ambiguous', () => {
    const errors = validateFlowSteps([
      totp(1, { id: 'x' }),
      step('x', 2, { fallbackStepId: 'ghost' }),
    ]);
    // Only the structural error, not first_step_not_identifying / fallback_unknown_step.
    expect(codes(errors)).toEqual(['duplicate_id', 'duplicate_id']);
  });

  it('never throws on hostile input', () => {
    const inputs: unknown[] = [
      undefined,
      0,
      'steps',
      [null],
      [Object.create(null)],
      [{ id: {}, order: {}, type: {}, condition: [], config: 1 }],
    ];
    for (const input of inputs) {
      expect(() => validateFlowSteps(input)).not.toThrow();
      expect(validateFlowSteps(input).length).toBeGreaterThan(0);
    }
  });

  it('lists the supported types in the unsupported_type message', () => {
    const [e] = validateFlowSteps([pw(), totp(2, { type: 'social' })]);
    for (const t of SUPPORTED_STEP_TYPES) expect(e.message).toContain(t);
    expect(e.message).toMatch(/not supported by the flow runtime yet/);
  });

  it('accepts every whitelisted condition field', () => {
    for (const field of CONDITION_FIELDS) {
      expect(
        validateFlowSteps([
          pw(),
          totp(2, { condition: { field, operator: 'exists' } }),
        ]),
      ).toEqual([]);
    }
  });
});
