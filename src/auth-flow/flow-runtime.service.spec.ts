import {
  FlowRuntimeService,
  MAX_FLOW_FAILURES,
} from './flow-runtime.service.js';
import type { AuthnTxn, AuthnTxnState } from './authn-transaction.store.js';
import type { RuntimeStep } from './flow-graph.js';
import { ACR_MFA, ACR_PASSWORD } from '../authn-core/acr.js';
import { AUTHN_TXN_COOKIE } from '../authn-core/cookies.js';
import { mintFlowSessionProof } from '../authn-core/flow-contracts.js';

const ENV = 'AUTH_FLOW_RUNTIME_ENABLED';

const realm = {
  id: 'realm-1',
  name: 'acme',
  authFlowsEnabled: true,
  webAuthnEnabled: true,
  registrationAllowed: false,
} as never;

const alice = {
  id: 'user-alice',
  username: 'alice',
  enabled: true,
  passwordHash: 'h',
  federationLink: null,
  email: 'a@x',
  emailVerified: true,
};

const step = (
  s: Partial<RuntimeStep> & Pick<RuntimeStep, 'id' | 'type' | 'order'>,
): RuntimeStep => ({ required: true, ...s });

function txnState(overrides: Partial<AuthnTxnState> = {}): AuthnTxnState {
  return {
    realmId: 'realm-1',
    flowId: 'flow-1',
    flowVersion: 2,
    oauthParams: {
      client_id: 'app',
      redirect_uri: 'https://app.example/cb',
      response_type: 'code',
      state: 'st',
    },
    requestedAcr: [],
    loginHint: null,
    claims: null,
    userId: null,
    mainStepId: 'pw',
    currentStepId: 'pw',
    synthetic: null,
    syntheticDone: [],
    enrolling: false,
    receipts: [],
    rememberMe: false,
    riskStepUp: false,
    riskScore: null,
    riskLevel: null,
    failures: 0,
    ...overrides,
  };
}

describe('FlowRuntimeService.dispatch', () => {
  let previousEnv: string | undefined;
  let steps: RuntimeStep[];
  let current: AuthnTxn;
  let store: Record<string, jest.Mock>;
  let handlers: Record<string, jest.Mock>;
  let resolver: { resolve: jest.Mock };
  let mfa: Record<string, jest.Mock>;
  let webAuthn: Record<string, jest.Mock>;
  let sessionIssuer: { issue: jest.Mock };
  let postAuth: { continueAuthorization: jest.Mock };
  let gates: { evaluate: jest.Mock };
  let theme: { render: jest.Mock };
  let runtime: FlowRuntimeService;
  let req: Record<string, unknown>;
  let res: Record<string, jest.Mock>;

  const flow = () => ({ id: 'flow-1', version: 2, steps, realmId: 'realm-1' });

  const password = (username = 'alice') => ({
    endpoint: 'password' as const,
    username,
    password: 'pw',
    rememberMe: false,
    deviceFingerprint: null,
    form: {},
  });
  const totp = { endpoint: 'totp' as const, code: '123456' };
  const passkey = {
    endpoint: 'webauthn' as const,
    response: {} as never,
    binding: 'b',
  };

  const committedState = (): AuthnTxnState =>
    store.commit.mock.calls.at(-1)?.[1] as AuthnTxnState;
  const redirectedTo = (): string => res.redirect.mock.calls.at(-1)?.[1];
  const renderedStatus = () => res.status.mock.calls.at(-1)?.[0];
  /** The restart notice code set on the browser, if any. */
  const notice = () =>
    res.cookie.mock.calls.find((c) => c[0] === 'IDENPLANE_LOGIN_NOTICE')?.[1];
  const AUTH_RESTART =
    /^\/realms\/acme\/protocol\/openid-connect\/auth\?client_id=app/;

  beforeEach(() => {
    previousEnv = process.env[ENV];
    process.env[ENV] = 'true';
    steps = [step({ id: 'pw', type: 'password', order: 1 })];
    current = {
      id: 'txn-1',
      version: 4,
      expiresAt: new Date(),
      state: txnState(),
    };

    store = {
      find: jest.fn(() => Promise.resolve({ status: 'active', txn: current })),
      begin: jest.fn((t: AuthnTxn) =>
        Promise.resolve({ ...t, version: t.version + 1 }),
      ),
      commit: jest.fn(
        (t: AuthnTxn, s: AuthnTxnState, o: { rotate?: boolean }) =>
          Promise.resolve({
            txn: { ...t, version: t.version + 1, state: s },
            token: o?.rotate ? 'rotated' : undefined,
          }),
      ),
      claim: jest.fn((t: AuthnTxn, s: AuthnTxnState = t.state) =>
        Promise.resolve(
          mintFlowSessionProof({
            txnId: t.id,
            realmId: 'realm-1',
            userId: s.userId as string,
            flowId: 'flow-1',
            flowVersion: 2,
          }),
        ),
      ),
      destroy: jest.fn(() => Promise.resolve()),
      create: jest.fn(),
    };
    handlers = {
      password: jest.fn(() =>
        Promise.resolve({
          kind: 'passed',
          userId: alice.id,
          amr: ['pwd'],
          user: alice,
        }),
      ),
      totp: jest.fn(() =>
        Promise.resolve({ kind: 'passed', userId: alice.id, amr: ['otp'] }),
      ),
      webauthn: jest.fn(() =>
        Promise.resolve({
          kind: 'passed',
          userId: alice.id,
          amr: ['hwk'],
          user: alice,
        }),
      ),
    };
    resolver = {
      resolve: jest.fn(() =>
        Promise.resolve({ kind: 'bound', flow: flow(), source: 'realm' }),
      ),
    };
    mfa = {
      isMfaRequired: jest.fn().mockResolvedValue(false),
      isMfaEnabled: jest.fn().mockResolvedValue(false),
      getEnrolledFactors: jest.fn().mockResolvedValue([]),
      createMfaEnrollment: jest.fn().mockResolvedValue('enrol-token'),
    };
    webAuthn = { hasCredentials: jest.fn().mockResolvedValue(false) };
    sessionIssuer = { issue: jest.fn().mockResolvedValue('session') };
    postAuth = {
      continueAuthorization: jest
        .fn()
        .mockResolvedValue('https://app.example/cb?code=c&state=st'),
    };
    gates = {
      evaluate: jest
        .fn()
        .mockResolvedValue({ kind: 'continue', riskStepUp: false }),
    };
    theme = { render: jest.fn() };
    const prisma = {
      client: { findUnique: jest.fn().mockResolvedValue({ authFlowId: null }) },
      userGroup: { findMany: jest.fn().mockResolvedValue([]) },
      userRole: { findMany: jest.fn().mockResolvedValue([]) },
    };

    runtime = new FlowRuntimeService(
      prisma as never,
      resolver as never,
      store as never,
      handlers as never,
      gates as never,
      { recordSuccess: jest.fn() } as never,
      sessionIssuer as never,
      postAuth as never,
      {
        validateAuthRequest: jest
          .fn()
          .mockResolvedValue({ id: 'client-pk', requiredAcr: null }),
      } as never,
      { findUserById: jest.fn().mockResolvedValue(alice) } as never,
      { getRiskRequiredAcr: jest.fn().mockResolvedValue(null) } as never,
      webAuthn as never,
      mfa as never,
      {} as never,
      { recordLoginEvent: jest.fn() } as never,
      theme as never,
      { generateToken: () => 'csrf', cookieName: () => 'csrf' } as never,
    );
    req = {
      cookies: { [AUTHN_TXN_COOKIE]: 'cookie-token' },
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
    };
    res = {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
      redirect: jest.fn(),
      json: jest.fn(),
    };
    res.status = jest.fn(() => res);
  });

  afterEach(() => {
    if (previousEnv === undefined) delete process.env[ENV];
    else process.env[ENV] = previousEnv;
  });

  const dispatch = (
    submission: Parameters<FlowRuntimeService['dispatch']>[1],
  ) => runtime.dispatch(realm, submission, req as never, res as never);

  describe('legacy', () => {
    it('does nothing with the runtime switched off', async () => {
      delete process.env[ENV];
      expect(await dispatch(password())).toBe(false);
      expect(store.find).not.toHaveBeenCalled();
      expect(resolver.resolve).not.toHaveBeenCalled();
    });

    it('leaves a realm without flows (and no transaction) to the built-in login', async () => {
      req.cookies = {};
      const legacyRealm = { ...(realm as object), authFlowsEnabled: false };
      expect(
        await runtime.dispatch(
          legacyRealm as never,
          password(),
          req as never,
          res as never,
        ),
      ).toBe(false);
      expect(resolver.resolve).not.toHaveBeenCalled();
    });

    it('leaves a login the resolver calls legacy to the built-in login', async () => {
      req.cookies = {};
      resolver.resolve.mockResolvedValue({ kind: 'legacy' });
      expect(await dispatch(password())).toBe(false);
    });

    it('never falls back to the built-in login in a bound realm without a transaction', async () => {
      req.cookies = {};
      expect(await dispatch(password())).toBe(true);
      expect(handlers.password).not.toHaveBeenCalled();
      // The form has no OAuth request: the login page starts afresh.
      expect(redirectedTo()).toBe('/realms/acme/login');
      expect(notice()).toBe('invalid');
    });

    it('answers 503 for a misconfigured binding without a transaction', async () => {
      req.cookies = {};
      resolver.resolve.mockResolvedValue({
        kind: 'misconfigured',
        reason: 'flow_invalid',
        flowId: 'f',
        source: 'realm',
      });
      expect(await dispatch(password())).toBe(true);
      expect(renderedStatus()).toBe(503);
    });
  });

  describe('wrong endpoint', () => {
    it('answers 400 and ends the transaction', async () => {
      expect(await dispatch(totp)).toBe(true);
      expect(renderedStatus()).toBe(400);
      expect(store.destroy).toHaveBeenCalledWith('txn-1');
      expect(handlers.totp).not.toHaveBeenCalled();
      expect(store.begin).not.toHaveBeenCalled();
      expect(res.clearCookie).toHaveBeenCalledWith(AUTHN_TXN_COOKIE, {
        path: '/realms/acme',
      });
    });

    it('answers a passkey post in JSON', async () => {
      await dispatch(passkey);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 400 }),
      );
    });

    it('treats the endpoint of the current step’s fallback as declining it', async () => {
      steps = [
        step({ id: 'pk', type: 'webauthn', order: 1, fallbackStepId: 'pw' }),
        step({ id: 'pw', type: 'password', order: 2 }),
      ];
      current.state = txnState({ mainStepId: 'pk', currentStepId: 'pk' });
      await dispatch(password());
      expect(handlers.password).toHaveBeenCalledWith(
        realm,
        expect.objectContaining({ id: 'pw' }),
        expect.anything(),
        null,
        expect.any(String),
      );
      expect(store.destroy).not.toHaveBeenCalled();
    });
  });

  describe('outcomes', () => {
    it('failed with a fallback moves to the fallback', async () => {
      steps = [
        step({ id: 'pk', type: 'webauthn', order: 1, fallbackStepId: 'pw' }),
        step({ id: 'pw', type: 'password', order: 2 }),
      ];
      current.state = txnState({ mainStepId: 'pk', currentStepId: 'pk' });
      handlers.webauthn.mockResolvedValue({ kind: 'failed', message: 'No.' });
      await dispatch(passkey);
      expect(committedState()).toMatchObject({
        currentStepId: 'pw',
        mainStepId: 'pk',
        failures: 1,
        userId: null,
        receipts: [],
      });
      expect(res.json).toHaveBeenCalledWith({
        redirectUrl: '/realms/acme/login?error=No.',
      });
      expect(store.destroy).not.toHaveBeenCalled();
    });

    it('failed without a fallback stays on the step with an error', async () => {
      handlers.password.mockResolvedValue({
        kind: 'failed',
        message: 'Invalid credentials',
      });
      await dispatch(password());
      expect(committedState()).toMatchObject({
        currentStepId: 'pw',
        failures: 1,
      });
      expect(redirectedTo()).toBe(
        '/realms/acme/login?error=Invalid+credentials',
      );
    });

    it(`starts over after ${MAX_FLOW_FAILURES} failures`, async () => {
      current.state = txnState({ failures: MAX_FLOW_FAILURES - 1 });
      handlers.password.mockResolvedValue({ kind: 'failed', message: 'x' });
      await dispatch(password());
      expect(store.destroy).toHaveBeenCalledWith('txn-1');
      expect(store.commit).not.toHaveBeenCalled();
      expect(redirectedTo()).toMatch(AUTH_RESTART);
      expect(notice()).toBe('too_many_failures');
    });

    it('locked never takes the fallback: the transaction ends', async () => {
      steps = [
        step({ id: 'pw', type: 'password', order: 1 }),
        step({ id: 'otp', type: 'totp', order: 2, fallbackStepId: 'pw2' }),
        step({ id: 'pw2', type: 'password', order: 3 }),
      ];
      current.state = txnState({
        userId: alice.id,
        mainStepId: 'otp',
        currentStepId: 'otp',
      });
      handlers.totp.mockResolvedValue({ kind: 'locked', message: 'Too many.' });
      await dispatch(totp);
      expect(store.destroy).toHaveBeenCalledWith('txn-1');
      expect(store.commit).not.toHaveBeenCalled();
      // A restart goes through /auth, rebuilt from the stored request.
      expect(redirectedTo()).toMatch(AUTH_RESTART);
      expect(notice()).toBe('locked');
    });

    it('a thrown error never takes the fallback: the transaction ends', async () => {
      steps = [
        step({ id: 'pk', type: 'webauthn', order: 1, fallbackStepId: 'pw' }),
        step({ id: 'pw', type: 'password', order: 2 }),
      ];
      current.state = txnState({ mainStepId: 'pk', currentStepId: 'pk' });
      handlers.webauthn.mockRejectedValue(new Error('boom'));
      await dispatch(passkey);
      expect(store.destroy).toHaveBeenCalledWith('txn-1');
      expect(store.commit).not.toHaveBeenCalled();
    });

    it('rejects the loser of a concurrent submission without ending the transaction', async () => {
      store.begin.mockResolvedValue(null);
      await dispatch(password());
      expect(renderedStatus()).toBe(409);
      expect(handlers.password).not.toHaveBeenCalled();
      expect(store.destroy).not.toHaveBeenCalled();
    });
  });

  describe('identified-user pin', () => {
    beforeEach(() => {
      steps = [
        step({ id: 'pw', type: 'password', order: 1 }),
        step({ id: 'otp', type: 'totp', order: 2, fallbackStepId: 'pw2' }),
        step({ id: 'pw2', type: 'password', order: 3 }),
      ];
      current.state = txnState({
        userId: alice.id,
        mainStepId: 'otp',
        currentStepId: 'pw2',
        receipts: [{ stepId: 'pw', kind: 'password', amr: ['pwd'], at: '' }],
      });
    });

    it('hands the identified user to the fallback handler', async () => {
      await dispatch(password('alice'));
      expect(handlers.password).toHaveBeenCalledWith(
        realm,
        expect.objectContaining({ id: 'pw2' }),
        expect.anything(),
        alice,
        expect.any(String),
      );
    });

    it('fails closed when a fallback answers for another user', async () => {
      handlers.password.mockResolvedValue({ kind: 'user_mismatch' });
      await dispatch(password('mallory'));
      expect(store.destroy).toHaveBeenCalledWith('txn-1');
      expect(sessionIssuer.issue).not.toHaveBeenCalled();
      expect(store.claim).not.toHaveBeenCalled();
    });

    it('fails closed when a passkey belongs to another user', async () => {
      current.state = { ...current.state, currentStepId: 'otp' };
      steps = [
        step({ id: 'pw', type: 'password', order: 1 }),
        step({ id: 'pk', type: 'webauthn', order: 2 }),
      ];
      current.state = {
        ...current.state,
        mainStepId: 'pk',
        currentStepId: 'pk',
      };
      handlers.webauthn.mockResolvedValue({ kind: 'user_mismatch' });
      await dispatch(passkey);
      expect(handlers.webauthn).toHaveBeenCalledWith(
        realm,
        expect.anything(),
        alice.id,
      );
      expect(store.destroy).toHaveBeenCalledWith('txn-1');
    });
  });

  describe('passing steps', () => {
    it('identifies, runs the gates once, rotates the cookie and moves on', async () => {
      steps = [
        step({ id: 'pw', type: 'password', order: 1 }),
        step({ id: 'otp', type: 'totp', order: 2 }),
      ];
      mfa.isMfaEnabled.mockResolvedValue(true);
      await dispatch({ ...password(), rememberMe: true });
      expect(gates.evaluate).toHaveBeenCalledTimes(1);
      expect(gates.evaluate.mock.calls[0][2]).toMatchObject({
        form: current.state.oauthParams,
        skipPasswordExpiry: false,
      });
      expect(store.commit.mock.calls[0][2]).toEqual({ rotate: true });
      expect(committedState()).toMatchObject({
        userId: alice.id,
        rememberMe: true,
        mainStepId: 'otp',
        currentStepId: 'otp',
        receipts: [expect.objectContaining({ stepId: 'pw', amr: ['pwd'] })],
      });
      expect(res.cookie).toHaveBeenCalledWith(
        AUTHN_TXN_COOKIE,
        'rotated',
        expect.objectContaining({ httpOnly: true, secure: true }),
      );
      expect(redirectedTo()).toBe('/realms/acme/totp');
    });

    it('a gate block ends the transaction', async () => {
      gates.evaluate.mockResolvedValue({
        kind: 'block',
        redirectUrl: '/realms/acme/change-password?token=t',
      });
      await dispatch(password());
      expect(store.destroy).toHaveBeenCalledWith('txn-1');
      expect(redirectedTo()).toBe('/realms/acme/change-password?token=t');
      expect(sessionIssuer.issue).not.toHaveBeenCalled();
    });

    it('skips password expiry after a passkey identification', async () => {
      steps = [step({ id: 'pk', type: 'webauthn', order: 1 })];
      current.state = txnState({ mainStepId: 'pk', currentStepId: 'pk' });
      await dispatch(passkey);
      expect(gates.evaluate.mock.calls[0][2]).toMatchObject({
        skipPasswordExpiry: true,
      });
    });

    it('finalises: claim, session with the proof and ACR/AMR from receipts, then consent / code', async () => {
      await dispatch(password());
      expect(store.claim).toHaveBeenCalledTimes(1);
      const [, user, context, , , options] = sessionIssuer.issue.mock.calls[0];
      expect(user).toBe(alice);
      expect(context).toEqual({ acr: ACR_PASSWORD, amr: ['pwd'] });
      expect(options.proof).toMatchObject({ kind: 'flow', userId: alice.id });
      expect(postAuth.continueAuthorization).toHaveBeenCalledWith(
        realm,
        alice,
        expect.objectContaining({ id: 'client-pk' }),
        current.state.oauthParams,
        { acr: ACR_PASSWORD, amr: ['pwd'] },
      );
      expect(redirectedTo()).toBe('https://app.example/cb?code=c&state=st');
    });

    it('a lost claim issues no session', async () => {
      store.claim.mockResolvedValue(null);
      await dispatch(password());
      expect(sessionIssuer.issue).not.toHaveBeenCalled();
      expect(renderedStatus()).toBe(409);
    });

    it('adds a TOTP assurance step when MFA is required and the user has a factor', async () => {
      mfa.isMfaRequired.mockResolvedValue(true);
      mfa.isMfaEnabled.mockResolvedValue(true);
      await dispatch(password());
      expect(store.claim).not.toHaveBeenCalled();
      expect(committedState()).toMatchObject({ synthetic: 'totp' });
      expect(redirectedTo()).toBe('/realms/acme/totp');
    });

    it('finalises at MFA after the assurance step', async () => {
      current.state = txnState({
        userId: alice.id,
        synthetic: 'totp',
        currentStepId: '__assurance_totp',
        receipts: [{ stepId: 'pw', kind: 'password', amr: ['pwd'], at: '' }],
      });
      mfa.isMfaRequired.mockResolvedValue(true);
      mfa.isMfaEnabled.mockResolvedValue(true);
      await dispatch(totp);
      expect(sessionIssuer.issue.mock.calls[0][2]).toEqual({
        acr: ACR_MFA,
        amr: ['pwd', 'otp'],
      });
    });

    it('takes the enrolment detour when MFA is required and the user has none', async () => {
      mfa.isMfaRequired.mockResolvedValue(true);
      await dispatch(password());
      expect(mfa.createMfaEnrollment).toHaveBeenCalledWith(
        expect.objectContaining({ authnTxnId: 'txn-1', userId: alice.id }),
      );
      expect(committedState()).toMatchObject({ enrolling: true });
      expect(redirectedTo()).toMatch(/\/account\/totp-setup/);
      expect(sessionIssuer.issue).not.toHaveBeenCalled();
    });
  });

  describe('enrolment detour', () => {
    const enrollment = (overrides = {}) => ({
      userId: alice.id,
      realmId: 'realm-1',
      factor: 'totp' as const,
      verified: true,
      authnTxnId: 'txn-1',
      ...overrides,
    });

    beforeEach(() => {
      steps = [
        step({ id: 'pw', type: 'password', order: 1 }),
        step({ id: 'otp', type: 'totp', order: 2 }),
      ];
      current.state = txnState({
        userId: alice.id,
        mainStepId: 'otp',
        currentStepId: 'otp',
        enrolling: true,
        receipts: [{ stepId: 'pw', kind: 'password', amr: ['pwd'], at: '' }],
      });
      mfa.isMfaEnabled.mockResolvedValue(true);
    });

    const resume = (e: ReturnType<typeof enrollment>) =>
      runtime.resumeAfterEnrolment(realm, e, req as never, res as never);

    it('resumes the flow with the new factor as the step receipt', async () => {
      await resume(enrollment());
      expect(sessionIssuer.issue.mock.calls[0][2]).toEqual({
        acr: ACR_MFA,
        amr: ['pwd', 'otp'],
      });
    });

    it.each([
      ['another transaction', { authnTxnId: 'txn-other' }],
      ['another user', { userId: 'user-mallory' }],
    ])('fails closed for %s', async (_label, overrides) => {
      await resume(enrollment(overrides));
      expect(store.destroy).toHaveBeenCalledWith('txn-1');
      expect(sessionIssuer.issue).not.toHaveBeenCalled();
      expect(redirectedTo()).toBe('/realms/acme/login');
      expect(notice()).toBe('invalid');
    });

    it('fails closed when the transaction is not waiting for enrolment', async () => {
      current.state = { ...current.state, enrolling: false };
      await resume(enrollment());
      expect(sessionIssuer.issue).not.toHaveBeenCalled();
    });
  });

  describe('pinned flow', () => {
    it('restarts when the flow version changed', async () => {
      resolver.resolve.mockResolvedValue({
        kind: 'bound',
        flow: { ...flow(), version: 3 },
        source: 'realm',
      });
      await dispatch(password());
      expect(handlers.password).not.toHaveBeenCalled();
      expect(store.destroy).toHaveBeenCalledWith('txn-1');
      expect(redirectedTo()).toMatch(AUTH_RESTART);
      expect(redirectedTo()).toContain('redirect_uri=');
      expect(notice()).toBe('flow_changed');
    });

    it('restarts when the transaction expired', async () => {
      store.find.mockResolvedValue({ status: 'expired', txn: current });
      await dispatch(password());
      expect(handlers.password).not.toHaveBeenCalled();
      expect(store.destroy).toHaveBeenCalledWith('txn-1');
    });

    it('refuses an unknown transaction instead of falling back', async () => {
      store.find.mockResolvedValue({ status: 'missing' });
      expect(await dispatch(password())).toBe(true);
      expect(handlers.password).not.toHaveBeenCalled();
      expect(redirectedTo()).toBe('/realms/acme/login');
      expect(notice()).toBe('invalid');
    });
  });
});
