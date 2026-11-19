import { ForbiddenException } from '@nestjs/common';
import { SessionIssuer } from './session-issuer.service.js';
import { mintFlowSessionProof } from '../authn-core/flow-contracts.js';

const ENV = 'AUTH_FLOW_RUNTIME_ENABLED';
const realm = { id: 'realm-1', name: 'acme' } as never;
const user = { id: 'user-1' } as never;

describe('SessionIssuer', () => {
  let previousEnv: string | undefined;
  let login: { createLoginSession: jest.Mock };
  let resolver: { resolve: jest.Mock };
  let issuer: SessionIssuer;
  let usage: { record: jest.Mock };
  const req = { headers: {}, cookies: {}, socket: {} } as never;
  let res: { cookie: jest.Mock };

  const proof = (overrides = {}) =>
    mintFlowSessionProof({
      txnId: 't',
      realmId: 'realm-1',
      userId: 'user-1',
      flowId: 'flow-1',
      flowVersion: 2,
      ...overrides,
    });

  beforeEach(() => {
    previousEnv = process.env[ENV];
    login = { createLoginSession: jest.fn().mockResolvedValue('session') };
    resolver = { resolve: jest.fn() };
    usage = { record: jest.fn().mockResolvedValue(undefined) };
    issuer = new SessionIssuer(
      login as never,
      resolver as never,
      usage as never,
    );
    res = { cookie: jest.fn() };
  });

  afterEach(() => {
    if (previousEnv === undefined) delete process.env[ENV];
    else process.env[ENV] = previousEnv;
  });

  it('issues built-in sessions without consulting bindings when the runtime is off', async () => {
    delete process.env[ENV];
    await issuer.issue(realm, user, {}, req, res as never);
    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(login.createLoginSession).toHaveBeenCalled();
  });

  it('counts the signed-in user as active this month', async () => {
    delete process.env[ENV];
    await issuer.issue(realm, user, {}, req, res as never);
    expect(usage.record).toHaveBeenCalledWith('realm-1', 'user-1');
  });

  it('issues built-in sessions where the resolver says legacy', async () => {
    process.env[ENV] = 'true';
    resolver.resolve.mockResolvedValue({ kind: 'legacy' });
    await issuer.issue(realm, user, {}, req, res as never, { client: null });
    expect(login.createLoginSession).toHaveBeenCalled();
  });

  it.each(['bound', 'misconfigured'])(
    'refuses built-in proof where the login is %s',
    async (kind) => {
      process.env[ENV] = 'true';
      resolver.resolve.mockResolvedValue({
        kind,
        flow: { id: 'flow-1', version: 2 },
      });
      await expect(
        issuer.issue(realm, user, {}, req, res as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(login.createLoginSession).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
      expect(usage.record).not.toHaveBeenCalled();
    },
  );

  describe('flow proof', () => {
    beforeEach(() => {
      process.env[ENV] = 'true';
      resolver.resolve.mockResolvedValue({
        kind: 'bound',
        flow: { id: 'flow-1', version: 2 },
      });
    });

    it('accepts a finalised transaction of the bound flow and version', async () => {
      await issuer.issue(realm, user, {}, req, res as never, {
        proof: proof(),
      });
      expect(login.createLoginSession).toHaveBeenCalled();
    });

    it.each([
      ['another flow version', { flowVersion: 3 }],
      ['another flow', { flowId: 'flow-2' }],
      ['another user', { userId: 'user-2' }],
      ['another realm', { realmId: 'realm-2' }],
    ])('refuses %s', async (_label, overrides) => {
      await expect(
        issuer.issue(realm, user, {}, req, res as never, {
          proof: proof(overrides),
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(login.createLoginSession).not.toHaveBeenCalled();
    });

    it('refuses a look-alike proof it did not mint', async () => {
      await expect(
        issuer.issue(realm, user, {}, req, res as never, {
          proof: {
            kind: 'flow',
            txnId: 't',
            realmId: 'realm-1',
            userId: 'user-1',
            flowId: 'flow-1',
            flowVersion: 2,
          },
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
