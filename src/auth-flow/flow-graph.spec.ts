import { ACR_MFA, ACR_PASSWORD, ACR_WEBAUTHN } from '../authn-core/acr.js';
import {
  FlowGraph,
  evaluateFlowCondition,
  type RuntimeStep,
} from './flow-graph.js';
import { validateFlowSteps } from './flow-validator.js';

const step = (
  s: Partial<RuntimeStep> & Pick<RuntimeStep, 'id' | 'type' | 'order'>,
): RuntimeStep => ({
  required: true,
  ...s,
});

function graph(steps: RuntimeStep[]): FlowGraph {
  // Every graph here is a flow the validator accepts.
  expect(validateFlowSteps(steps)).toEqual([]);
  return new FlowGraph(steps);
}

describe('FlowGraph', () => {
  it('runs the main path in order and keeps fallbacks off it', () => {
    const g = graph([
      step({ id: 'otp', type: 'totp', order: 2, fallbackStepId: 'pw2' }),
      step({ id: 'pw', type: 'password', order: 1 }),
      step({ id: 'pw2', type: 'password', order: 3, required: false }),
    ]);
    expect(g.first.id).toBe('pw');
    expect(g.mainPath.map((s) => s.id)).toEqual(['pw', 'otp']);
    expect(g.mainStepsAfter('pw').map((s) => s.id)).toEqual(['otp']);
    expect(g.mainStepsAfter('otp')).toEqual([]);
    expect(g.fallbackOf(g.step('otp')!)?.id).toBe('pw2');
    expect(g.chain(g.step('otp')!).map((s) => s.id)).toEqual(['otp', 'pw2']);
  });

  describe('impliedAcr', () => {
    it('password only → password', () => {
      expect(
        graph([step({ id: 'pw', type: 'password', order: 1 })]).impliedAcr(),
      ).toBe(ACR_PASSWORD);
    });

    it('password then a required TOTP → MFA', () => {
      expect(
        graph([
          step({ id: 'pw', type: 'password', order: 1 }),
          step({ id: 'otp', type: 'totp', order: 2 }),
        ]).impliedAcr(),
      ).toBe(ACR_MFA);
    });

    it('passkey only → WebAuthn', () => {
      expect(
        graph([step({ id: 'pk', type: 'webauthn', order: 1 })]).impliedAcr(),
      ).toBe(ACR_WEBAUTHN);
    });

    it('a password fallback lowers a passkey flow to the password level', () => {
      expect(
        graph([
          step({ id: 'pk', type: 'webauthn', order: 1, fallbackStepId: 'pw' }),
          step({ id: 'pw', type: 'password', order: 2 }),
        ]).impliedAcr(),
      ).toBe(ACR_PASSWORD);
    });

    it('an optional or conditional second factor may be skipped', () => {
      expect(
        graph([
          step({ id: 'pw', type: 'password', order: 1 }),
          step({ id: 'otp', type: 'totp', order: 2, required: false }),
        ]).impliedAcr(),
      ).toBe(ACR_PASSWORD);
      expect(
        graph([
          step({ id: 'pw', type: 'password', order: 1 }),
          step({
            id: 'otp',
            type: 'totp',
            order: 2,
            condition: { field: 'user.groups', operator: 'in', value: ['x'] },
          }),
        ]).impliedAcr(),
      ).toBe(ACR_PASSWORD);
    });

    it('takes the weakest alternative of each step', () => {
      // pw → (otp | passkey): the weaker alternative is the code.
      expect(
        graph([
          step({ id: 'pw', type: 'password', order: 1 }),
          step({ id: 'otp', type: 'totp', order: 2, fallbackStepId: 'pk' }),
          step({ id: 'pk', type: 'webauthn', order: 3 }),
        ]).impliedAcr(),
      ).toBe(ACR_MFA);
    });
  });
});

describe('evaluateFlowCondition', () => {
  const ctx = {
    user: { username: 'ann', groups: ['staff', 'eng'], emailVerified: true },
    client: { clientId: 'app' },
    risk: { level: null },
  };

  it('compares scalars', () => {
    expect(
      evaluateFlowCondition(
        { field: 'user.username', operator: 'eq', value: 'ann' },
        ctx,
      ),
    ).toBe(true);
    expect(
      evaluateFlowCondition(
        { field: 'client.clientId', operator: 'neq', value: 'app' },
        ctx,
      ),
    ).toBe(false);
  });

  it('treats in / not_in on arrays as any-of / none-of', () => {
    expect(
      evaluateFlowCondition(
        { field: 'user.groups', operator: 'in', value: ['eng'] },
        ctx,
      ),
    ).toBe(true);
    expect(
      evaluateFlowCondition(
        { field: 'user.groups', operator: 'not_in', value: ['eng'] },
        ctx,
      ),
    ).toBe(false);
  });

  it('checks presence', () => {
    expect(
      evaluateFlowCondition(
        { field: 'risk.level', operator: 'not_exists' },
        ctx,
      ),
    ).toBe(true);
    expect(
      evaluateFlowCondition({ field: 'user.email', operator: 'exists' }, ctx),
    ).toBe(false);
  });
});
