import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { FlowStepHandlers } from './flow-step-handlers.service.js';
import { PasskeyUserMismatchError } from '../webauthn/webauthn.service.js';
import type { RuntimeStep } from './flow-graph.js';

const realm = { id: 'realm-1' } as never;
const alice = { id: 'u-alice', username: 'alice', federationLink: null };
const pw: RuntimeStep = {
  id: 'pw',
  type: 'password',
  order: 1,
  required: true,
};
const ldap: RuntimeStep = {
  id: 'ld',
  type: 'ldap',
  order: 1,
  required: true,
  config: { federationProviderId: 'corp' },
};

describe('FlowStepHandlers', () => {
  let login: { validateCredentials: jest.Mock };
  let verifier: { verify: jest.Mock };
  let webAuthn: { verifyAuthentication: jest.Mock };
  let handlers: FlowStepHandlers;

  beforeEach(() => {
    login = { validateCredentials: jest.fn().mockResolvedValue(alice) };
    verifier = { verify: jest.fn() };
    webAuthn = { verifyAuthentication: jest.fn() };
    handlers = new FlowStepHandlers(
      login as never,
      verifier as never,
      webAuthn as never,
    );
  });

  describe('password', () => {
    it('passes with the password methods', async () => {
      const out = await handlers.password(
        realm,
        pw,
        { username: 'alice', password: 'x' },
        null,
        'ip',
      );
      expect(out).toMatchObject({
        kind: 'passed',
        userId: 'u-alice',
        amr: ['pwd'],
      });
    });

    it('refuses another username than the pinned user before checking any password', async () => {
      const out = await handlers.password(
        realm,
        pw,
        { username: 'mallory', password: 'x' },
        alice as never,
        'ip',
      );
      expect(out).toEqual({ kind: 'user_mismatch' });
      expect(login.validateCredentials).not.toHaveBeenCalled();
    });

    it('reports a locked account as locked, a wrong password as failed', async () => {
      login.validateCredentials.mockRejectedValueOnce(
        new UnauthorizedException(
          'Account is temporarily locked. Please try again later.',
        ),
      );
      expect(
        (
          await handlers.password(
            realm,
            pw,
            { username: 'alice', password: 'x' },
            null,
            'ip',
          )
        ).kind,
      ).toBe('locked');
      login.validateCredentials.mockRejectedValueOnce(
        new UnauthorizedException('Invalid credentials'),
      );
      expect(
        (
          await handlers.password(
            realm,
            pw,
            { username: 'alice', password: 'x' },
            null,
            'ip',
          )
        ).kind,
      ).toBe('failed');
    });

    it('lets other errors through (never a fallback)', async () => {
      login.validateCredentials.mockRejectedValueOnce(new Error('db down'));
      await expect(
        handlers.password(
          realm,
          pw,
          { username: 'alice', password: 'x' },
          null,
          'ip',
        ),
      ).rejects.toThrow('db down');
    });

    it('an ldap step needs a directory user of the configured provider', async () => {
      expect(
        (
          await handlers.password(
            realm,
            ldap,
            { username: 'alice', password: 'x' },
            null,
            'ip',
          )
        ).kind,
      ).toBe('failed');
      login.validateCredentials.mockResolvedValue({
        ...alice,
        federationLink: 'other',
      });
      expect(
        (
          await handlers.password(
            realm,
            ldap,
            { username: 'alice', password: 'x' },
            null,
            'ip',
          )
        ).kind,
      ).toBe('failed');
      login.validateCredentials.mockResolvedValue({
        ...alice,
        federationLink: 'corp',
      });
      expect(
        (
          await handlers.password(
            realm,
            ldap,
            { username: 'alice', password: 'x' },
            null,
            'ip',
          )
        ).kind,
      ).toBe('passed');
    });
  });

  describe('totp', () => {
    it('binds a texted code to the transaction and reports the factor', async () => {
      verifier.verify.mockResolvedValue({ ok: true, factor: 'sms' });
      const out = await handlers.totp(
        realm,
        'u-alice',
        { smsCode: '1' },
        'txn-1',
        'ip',
      );
      expect(verifier.verify).toHaveBeenCalledWith(
        realm,
        'u-alice',
        { code: undefined, recoveryCode: undefined, smsCode: '1' },
        'txn-1',
        'ip',
      );
      expect(out).toEqual({ kind: 'passed', userId: 'u-alice', amr: ['sms'] });
    });

    it('maps the rate limit to locked and a wrong code to failed', async () => {
      verifier.verify.mockResolvedValueOnce({
        ok: false,
        reason: 'rate_limited',
      });
      expect(
        (await handlers.totp(realm, 'u', { code: '1' }, 't', 'ip')).kind,
      ).toBe('locked');
      verifier.verify.mockResolvedValueOnce({
        ok: false,
        reason: 'invalid',
        tooManyAttempts: false,
      });
      expect(
        (await handlers.totp(realm, 'u', { code: '1' }, 't', 'ip')).kind,
      ).toBe('failed');
    });
  });

  describe('webauthn', () => {
    it('passes the binding and the identified user to the verifier', async () => {
      webAuthn.verifyAuthentication.mockResolvedValue({ user: alice });
      const out = await handlers.webauthn(
        realm,
        { response: {} as never, binding: 'b' },
        'u-alice',
      );
      expect(webAuthn.verifyAuthentication).toHaveBeenCalledWith(
        realm,
        {},
        'b',
        undefined,
        'u-alice',
      );
      expect(out).toMatchObject({ kind: 'passed', amr: ['hwk'] });
    });

    it('maps another user’s passkey to user_mismatch', async () => {
      webAuthn.verifyAuthentication.mockRejectedValue(
        new PasskeyUserMismatchError(),
      );
      expect(
        (
          await handlers.webauthn(
            realm,
            { response: {} as never, binding: 'b' },
            'u',
          )
        ).kind,
      ).toBe('user_mismatch');
    });

    it('maps a bad assertion to failed and a counter rollback to locked', async () => {
      webAuthn.verifyAuthentication.mockRejectedValueOnce(
        new NotFoundException('Passkey not found'),
      );
      expect(
        (
          await handlers.webauthn(
            realm,
            { response: {} as never, binding: 'b' },
            null,
          )
        ).kind,
      ).toBe('failed');
      webAuthn.verifyAuthentication.mockRejectedValueOnce(
        new BadRequestException('Counter rollback detected'),
      );
      expect(
        (
          await handlers.webauthn(
            realm,
            { response: {} as never, binding: 'b' },
            null,
          )
        ).kind,
      ).toBe('locked');
    });

    it('fails without a challenge handle', async () => {
      expect(
        (
          await handlers.webauthn(
            realm,
            { response: {} as never, binding: undefined },
            null,
          )
        ).kind,
      ).toBe('failed');
      expect(webAuthn.verifyAuthentication).not.toHaveBeenCalled();
    });
  });
});
