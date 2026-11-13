import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Realm, User } from '@prisma/client';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { LoginService } from '../login/login.service.js';
import { SecondFactorVerifier } from '../login/second-factor-verifier.service.js';
import {
  PasskeyUserMismatchError,
  WebAuthnService,
} from '../webauthn/webauthn.service.js';
import type { StepOutcome } from '../authn-core/flow-contracts.js';
import type { RuntimeStep } from './flow-graph.js';

/** A password-endpoint submission (password and ldap steps). */
export interface PasswordStepInput {
  username: string;
  password: string;
}

/** A second-factor submission, as the TOTP page posts it. */
export interface TotpStepInput {
  code?: string;
  recoveryCode?: string;
  smsCode?: string;
}

/** A passkey assertion and the browser's challenge handle. */
export interface WebAuthnStepInput {
  response: AuthenticationResponseJSON;
  binding: string | undefined;
}

const LOCKED_MESSAGE = 'Account is temporarily locked';

/**
 * The credential checks behind each flow step type. They reuse the checks of
 * the built-in login (and so its brute-force accounting) and report a
 * {@link StepOutcome}; what happens next is the runtime's decision.
 */
@Injectable()
export class FlowStepHandlers {
  constructor(
    private readonly loginService: LoginService,
    private readonly secondFactorVerifier: SecondFactorVerifier,
    private readonly webAuthnService: WebAuthnService,
  ) {}

  /**
   * `password` and `ldap` steps. With `pinned` (the user is already
   * identified), any other username is refused *before* the password is
   * checked, so the flow never tests or resets another account's password.
   */
  async password(
    realm: Realm,
    step: RuntimeStep,
    input: PasswordStepInput,
    pinned: User | null,
    ip: string,
  ): Promise<StepOutcome & { user?: User }> {
    const username = (input.username ?? '').trim();
    if (pinned && username !== pinned.username) {
      return { kind: 'user_mismatch' };
    }
    if (!username || !input.password) {
      return { kind: 'failed', message: 'Invalid credentials' };
    }

    let user: User;
    try {
      user = await this.loginService.validateCredentials(
        realm,
        username,
        input.password,
        ip,
      );
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        return err.message.startsWith(LOCKED_MESSAGE)
          ? { kind: 'locked', message: err.message }
          : { kind: 'failed', message: 'Invalid credentials' };
      }
      throw err;
    }

    if (pinned && user.id !== pinned.id) return { kind: 'user_mismatch' };

    if (step.type === 'ldap') {
      // An LDAP step proves a directory password: a local password does not
      // count, and a configured provider must be the user's own.
      const providerId = step.config?.['federationProviderId'];
      if (
        !user.federationLink ||
        (typeof providerId === 'string' &&
          providerId &&
          user.federationLink !== providerId)
      ) {
        return { kind: 'failed', message: 'Invalid credentials' };
      }
    }

    return { kind: 'passed', userId: user.id, amr: ['pwd'], user };
  }

  /**
   * `totp` steps: an authenticator, texted or recovery code for `userId`,
   * through the same verifier (and per-user rate limit) as the built-in
   * second-factor page. `binding` ties a texted code to this transaction.
   */
  async totp(
    realm: Realm,
    userId: string,
    input: TotpStepInput,
    binding: string,
    ip: string,
  ): Promise<StepOutcome> {
    const result = await this.secondFactorVerifier.verify(
      realm,
      userId,
      {
        code: input.code,
        recoveryCode: input.recoveryCode,
        smsCode: input.smsCode,
      },
      binding,
      ip,
    );
    if (result.ok) {
      return {
        kind: 'passed',
        userId,
        amr: [result.factor === 'sms' ? 'sms' : 'otp'],
      };
    }
    if (result.reason === 'rate_limited') {
      return {
        kind: 'locked',
        message: 'Too many failed attempts. Please try again later.',
      };
    }
    return {
      kind: 'failed',
      message: result.tooManyAttempts
        ? 'Too many failed attempts. Please try again later.'
        : 'Invalid code. Please try again.',
    };
  }

  /**
   * `webauthn` steps: the assertion must answer the challenge bound to this
   * browser, and once the user is identified it must be their own passkey.
   */
  async webauthn(
    realm: Realm,
    input: WebAuthnStepInput,
    expectedUserId: string | null,
  ): Promise<StepOutcome & { user?: User }> {
    if (!input.binding) {
      return {
        kind: 'failed',
        message:
          'Authentication challenge expired or not found. Please try again.',
      };
    }
    try {
      const { user } = await this.webAuthnService.verifyAuthentication(
        realm,
        input.response,
        input.binding,
        undefined,
        expectedUserId ?? undefined,
      );
      return { kind: 'passed', userId: user.id, amr: ['hwk'], user };
    } catch (err) {
      if (err instanceof PasskeyUserMismatchError) {
        return { kind: 'user_mismatch' };
      }
      if (
        err instanceof BadRequestException &&
        /counter rollback/i.test(err.message)
      ) {
        // A cloned authenticator: never an occasion for a fallback.
        return { kind: 'locked', message: 'This passkey cannot be used.' };
      }
      if (
        err instanceof BadRequestException ||
        err instanceof NotFoundException
      ) {
        return { kind: 'failed', message: err.message };
      }
      throw err;
    }
  }
}
