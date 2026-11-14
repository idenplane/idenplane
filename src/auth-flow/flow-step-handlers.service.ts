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
import {
  MagicLinkService,
  type FlowMagicLink,
} from '../magic-link/magic-link.service.js';
import { BrokerService } from '../broker/broker.service.js';
import { STEP_AMR, type StepOutcome } from '../authn-core/flow-contracts.js';
import type { RuntimeStep } from './flow-graph.js';
import { EmailOtpService } from './email-otp.service.js';

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

/** A code typed from the email an `email_otp` step sent. */
export interface EmailOtpStepInput {
  code?: string;
}

/** The token of a sign-in link, as the link carries it. */
export interface MagicLinkStepInput {
  token?: string;
}

/** A broker callback for a `social` step (state already verified). */
export interface SocialStepInput {
  alias: string;
  /** The provider's authorization code; absent when it refused or failed. */
  code?: string;
  /** The `flow` part of the signed broker state. */
  flow: { txn: string; step: string; nonce: string };
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
    private readonly emailOtps: EmailOtpService,
    private readonly magicLinks: MagicLinkService,
    private readonly broker: BrokerService,
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

    return {
      kind: 'passed',
      userId: user.id,
      amr: [...STEP_AMR[step.type]],
      user,
    };
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
   * `email_otp` steps: a code sent by email to the identified user for this
   * transaction (`binding`), single use, counted before it is compared.
   */
  async emailOtp(
    realm: Realm,
    userId: string,
    input: EmailOtpStepInput,
    binding: string,
  ): Promise<StepOutcome> {
    const result = await this.emailOtps.verify({
      realmId: realm.id,
      userId,
      binding,
      code: input.code,
    });
    if (result.ok) {
      return { kind: 'passed', userId, amr: [...STEP_AMR.email_otp] };
    }
    switch (result.reason) {
      case 'locked':
        return {
          kind: 'locked',
          message: 'Too many incorrect codes. Please try again later.',
        };
      case 'expired':
        return {
          kind: 'failed',
          message: 'The code has expired. Please request a new one.',
        };
      case 'not_found':
        return {
          kind: 'failed',
          message: 'Please request a code first.',
        };
      default:
        return { kind: 'failed', message: 'Invalid code. Please try again.' };
    }
  }

  /**
   * `magic_link` steps: the token must be the one the link this
   * transaction sent carries (the caller already checked that this browser
   * holds the transaction), unexpired, and used once. With `pinned`, the
   * link must have gone to that user.
   */
  async magicLink(
    input: MagicLinkStepInput,
    link: FlowMagicLink | null | undefined,
    pinned: User | null,
  ): Promise<StepOutcome> {
    if (!link || !this.magicLinks.matchesFlowLink(input.token, link)) {
      return {
        kind: 'failed',
        message: 'This sign-in link is invalid or has expired.',
      };
    }
    if (pinned && link.userId !== pinned.id) return { kind: 'user_mismatch' };
    if (!(await this.magicLinks.completeFlowLink(link.requestId))) {
      return {
        kind: 'failed',
        message: 'This sign-in link has already been used or has expired.',
      };
    }
    return {
      kind: 'passed',
      userId: link.userId,
      amr: [...STEP_AMR.magic_link],
    };
  }

  /**
   * `social` steps: the provider's answer to the redirect this transaction
   * started. Before identification the external account signs in as its
   * linked (or matched, or new) local account, as the built-in federated
   * sign-in does; after it, the external account must already belong to
   * the identified user (or be linked to them through a trusted verified
   * address), and no account is ever created.
   */
  async social(
    realm: Realm,
    step: RuntimeStep,
    input: SocialStepInput,
    pinned: User | null,
  ): Promise<StepOutcome & { user?: User }> {
    const alias = step.config?.['providerAlias'];
    if (typeof alias !== 'string' || alias !== input.alias) {
      return { kind: 'failed', message: 'Sign-in with this provider failed.' };
    }
    if (!input.code) {
      // Cancelled or refused at the provider: the fallback may run.
      return {
        kind: 'failed',
        message: 'Sign-in with the identity provider was cancelled.',
      };
    }
    let identity;
    try {
      identity = await this.broker.fetchExternalIdentity(
        realm,
        alias,
        input.code,
      );
    } catch (err) {
      if (
        err instanceof UnauthorizedException ||
        err instanceof BadRequestException ||
        err instanceof NotFoundException
      ) {
        return {
          kind: 'failed',
          message: 'Sign-in with the identity provider failed.',
        };
      }
      throw err;
    }

    if (pinned) {
      const owner = await this.broker.belongsToUser(identity, pinned);
      if (owner === 'other_user') return { kind: 'user_mismatch' };
      if (owner === 'not_linked') {
        return {
          kind: 'failed',
          message:
            'This identity provider account is not linked to your account.',
        };
      }
      return {
        kind: 'passed',
        userId: pinned.id,
        amr: [...STEP_AMR.social],
        user: pinned,
      };
    }

    let user: User;
    try {
      user = await this.broker.resolveFederatedUser(realm, identity);
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        // A link-only provider with no matching account.
        return { kind: 'failed', message: err.message };
      }
      throw err;
    }
    if (!user.enabled) {
      return { kind: 'failed', message: 'This account is disabled.' };
    }
    return {
      kind: 'passed',
      userId: user.id,
      amr: [...STEP_AMR.social],
      user,
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
      return {
        kind: 'passed',
        userId: user.id,
        amr: [...STEP_AMR.webauthn],
        user,
      };
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
