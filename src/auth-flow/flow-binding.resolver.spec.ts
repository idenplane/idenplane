import { FlowBindingResolver } from './flow-binding.resolver.js';
import {
  AUTH_FLOW_RUNTIME_ENV,
  isAuthFlowRuntimeEnabled,
} from './auth-flow-runtime.js';

const VALID_STEPS = [
  { id: 'pw', type: 'password', required: true, order: 1 },
  { id: 'otp', type: 'totp', required: true, order: 2 },
];

function flow(id: string, steps: unknown = VALID_STEPS) {
  return { id, realmId: 'realm-a', name: id, steps, version: 1 };
}

describe('isAuthFlowRuntimeEnabled', () => {
  it.each<[string | undefined, boolean]>([
    [undefined, false],
    ['', false],
    ['false', false],
    ['0', false],
    ['1', false],
    ['yes', false],
    ['true', true],
    ['TRUE', true],
    [' true ', true],
  ])('%p -> %p', (value, expected) => {
    const env: NodeJS.ProcessEnv = {};
    if (value !== undefined) env[AUTH_FLOW_RUNTIME_ENV] = value;
    expect(isAuthFlowRuntimeEnabled(env)).toBe(expected);
  });
});

describe('FlowBindingResolver.resolve', () => {
  const original = process.env[AUTH_FLOW_RUNTIME_ENV];
  let findFirst: jest.Mock;
  let resolver: FlowBindingResolver;

  const enabledRealm = {
    id: 'realm-a',
    authFlowsEnabled: true,
    browserFlowId: 'realm-flow',
  };

  beforeEach(() => {
    process.env[AUTH_FLOW_RUNTIME_ENV] = 'true';
    findFirst = jest.fn();
    resolver = new FlowBindingResolver({
      authenticationFlow: { findFirst },
    } as never);
  });

  afterAll(() => {
    if (original === undefined) delete process.env[AUTH_FLOW_RUNTIME_ENV];
    else process.env[AUTH_FLOW_RUNTIME_ENV] = original;
  });

  // Step 1
  it('legacy when AUTH_FLOW_RUNTIME_ENABLED is unset, even with bindings', async () => {
    delete process.env[AUTH_FLOW_RUNTIME_ENV];
    await expect(
      resolver.resolve(enabledRealm, { authFlowId: 'client-flow' }),
    ).resolves.toEqual({ kind: 'legacy' });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('legacy when AUTH_FLOW_RUNTIME_ENABLED is not "true"', async () => {
    process.env[AUTH_FLOW_RUNTIME_ENV] = 'false';
    await expect(resolver.resolve(enabledRealm, null)).resolves.toEqual({
      kind: 'legacy',
    });
    expect(findFirst).not.toHaveBeenCalled();
  });

  // Step 2
  it('legacy when the realm switch is off, even with realm and client bindings', async () => {
    await expect(
      resolver.resolve(
        { ...enabledRealm, authFlowsEnabled: false },
        { authFlowId: 'client-flow' },
      ),
    ).resolves.toEqual({ kind: 'legacy' });
    expect(findFirst).not.toHaveBeenCalled();
  });

  // Step 3
  it('legacy when neither the client nor the realm binds a flow', async () => {
    await expect(
      resolver.resolve(
        { ...enabledRealm, browserFlowId: null },
        { authFlowId: null },
      ),
    ).resolves.toEqual({ kind: 'legacy' });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('legacy with no client and no realm flow', async () => {
    await expect(
      resolver.resolve({ ...enabledRealm, browserFlowId: null }, undefined),
    ).resolves.toEqual({ kind: 'legacy' });
  });

  it('the client override wins over the realm browser flow', async () => {
    findFirst.mockResolvedValue(flow('client-flow'));
    const r = await resolver.resolve(enabledRealm, {
      authFlowId: 'client-flow',
    });
    expect(r).toMatchObject({ kind: 'bound', source: 'client' });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'client-flow', realmId: 'realm-a' },
    });
  });

  it('falls back to the realm browser flow when the client has none', async () => {
    findFirst.mockResolvedValue(flow('realm-flow'));
    const r = await resolver.resolve(enabledRealm, { authFlowId: null });
    expect(r).toMatchObject({ kind: 'bound', source: 'realm' });
    if (r.kind === 'bound') expect(r.flow.id).toBe('realm-flow');
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'realm-flow', realmId: 'realm-a' },
    });
  });

  it('uses the realm browser flow when there is no client', async () => {
    findFirst.mockResolvedValue(flow('realm-flow'));
    await expect(resolver.resolve(enabledRealm, null)).resolves.toMatchObject({
      kind: 'bound',
      source: 'realm',
    });
  });

  // Step 4
  it('misconfigured (not legacy, not another flow) when the bound flow is not in the realm', async () => {
    findFirst.mockResolvedValue(null);
    await expect(
      resolver.resolve(enabledRealm, { authFlowId: 'flow-of-other-realm' }),
    ).resolves.toEqual({
      kind: 'misconfigured',
      reason: 'flow_not_found',
      flowId: 'flow-of-other-realm',
      source: 'client',
    });
    // Exactly one lookup: no fallback to the realm flow, isDefault or "any flow".
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('misconfigured when the bound flow fails validation', async () => {
    findFirst.mockResolvedValue(
      flow('realm-flow', [
        { id: 'otp', type: 'totp', required: true, order: 1 },
      ]),
    );
    const r = await resolver.resolve(enabledRealm, null);
    expect(r).toMatchObject({
      kind: 'misconfigured',
      reason: 'flow_invalid',
      flowId: 'realm-flow',
      source: 'realm',
    });
    if (r.kind === 'misconfigured') {
      expect(r.errors?.map((e) => e.code)).toContain(
        'first_step_not_identifying',
      );
    }
  });

  it('misconfigured when the stored steps JSON is not an array', async () => {
    findFirst.mockResolvedValue(flow('realm-flow', { broken: true }));
    await expect(resolver.resolve(enabledRealm, null)).resolves.toMatchObject({
      kind: 'misconfigured',
      reason: 'flow_invalid',
    });
  });

  it('propagates database errors instead of degrading to legacy', async () => {
    findFirst.mockRejectedValue(new Error('db down'));
    await expect(resolver.resolve(enabledRealm, null)).rejects.toThrow(
      'db down',
    );
  });
});
