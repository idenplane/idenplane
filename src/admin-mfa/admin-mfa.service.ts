import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Realm, User } from '@prisma/client';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { MfaService } from '../mfa/mfa.service.js';
import {
  WebAuthnService,
  type WebAuthnRelyingParty,
} from '../webauthn/webauthn.service.js';
import { BruteForceService } from '../brute-force/brute-force.service.js';
import { EventsService } from '../events/events.service.js';
import {
  LoginEventType,
  OperationType,
  ResourceType,
  type OperationTypeValue,
} from '../events/event-types.js';
import {
  AdminPrincipalService,
  type AdminMfaPolicy,
} from '../admin-rbac/admin-principal.service.js';
import { MASTER_REALM } from '../admin-rbac/admin-access-policy.js';
import { ACR_MFA, ACR_WEBAUTHN } from '../authn-core/acr.js';
import { adminWebAuthnRp } from './admin-webauthn-rp.js';
import { SessionsService } from '../sessions/sessions.service.js';

/** A pending console sign-in that has passed the password. */
export const ADMIN_MFA_CHALLENGE = 'admin_mfa_challenge';
/** How long the second step may take, in seconds. */
export const ADMIN_MFA_CHALLENGE_TTL_SECONDS = 5 * 60;
/** Answers allowed per challenge. */
export const ADMIN_MFA_CHALLENGE_MAX_ATTEMPTS = 5;
/** Challenges per admin per window, so a known password can't mint many. */
const CHALLENGES_PER_WINDOW = 5;
const CHALLENGE_WINDOW_SECONDS = 5 * 60;

/** A console second factor an admin can answer with. */
export type AdminMfaMethod = 'totp' | 'passkey' | 'recovery';

/** How a second factor was proved, for the token. */
export interface AdminMfaProof {
  method: AdminMfaMethod;
  /** RFC 8176 authentication methods, including the password. */
  amr: string[];
  acr: string;
}

/** Who made a change, for the audit trail. */
export interface AdminMfaActor {
  /** An admin user id, or `api-key:admin`. */
  userId: string;
  ipAddress?: string;
}

export interface AdminFactors {
  totp: boolean;
  passkeys: number;
}

export interface AdminMfaStatus {
  policy: AdminMfaPolicy;
  enrolled: boolean;
  totp: boolean;
  passkeys: Array<{
    id: string;
    name: string | null;
    createdAt: Date;
    lastUsedAt: Date | null;
  }>;
  recoveryCodes: { remaining: number; oldFormat: boolean };
}

export function proofFor(method: AdminMfaMethod): AdminMfaProof {
  switch (method) {
    case 'totp':
      return { method, amr: ['pwd', 'otp', 'mfa'], acr: ACR_MFA };
    case 'passkey':
      return { method, amr: ['pwd', 'hwk', 'mfa'], acr: ACR_WEBAUTHN };
    case 'recovery':
      return { method, amr: ['pwd', 'mfa'], acr: ACR_MFA };
  }
}

interface ChallengeData {
  userId: string;
}

/**
 * Second factors for the admin console (docs/docs/security/admin-mfa.md).
 *
 * The factors are the master realm account's own: its TOTP credential (with
 * MfaService's replay protection), its passkeys (WebAuthnService, under the
 * console's relying party) and its recovery codes. SMS is not accepted.
 *
 * This service never signs tokens: AdminAuthService does, once a factor has
 * been proved here.
 */
@Injectable()
export class AdminMfaService {
  private readonly logger = new Logger(AdminMfaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly mfa: MfaService,
    private readonly webAuthn: WebAuthnService,
    private readonly bruteForce: BruteForceService,
    private readonly events: EventsService,
    private readonly principals: AdminPrincipalService,
    private readonly config: ConfigService,
    private readonly sessions: SessionsService,
  ) {}

  // ── Realm, relying party, policy ─────────────────────────────────────

  async masterRealm(): Promise<Realm> {
    const realm = await this.prisma.realm.findUnique({
      where: { name: MASTER_REALM },
    });
    if (!realm) throw new UnauthorizedException('Admin system not initialized');
    return realm;
  }

  relyingParty(master: Realm): WebAuthnRelyingParty {
    return adminWebAuthnRp(master, {
      ADMIN_WEBAUTHN_RP_ID: this.config.get<string>('ADMIN_WEBAUTHN_RP_ID'),
      ADMIN_WEBAUTHN_ORIGINS: this.config.get<string>('ADMIN_WEBAUTHN_ORIGINS'),
      BASE_URL: this.config.get<string>('BASE_URL'),
    });
  }

  policy(): Promise<AdminMfaPolicy> {
    return this.principals.adminMfaPolicy();
  }

  /** Changes the stored requirement. Refused when ADMIN_MFA_REQUIRED fixes it. */
  async setPolicy(
    required: boolean,
    actor: AdminMfaActor,
  ): Promise<AdminMfaPolicy> {
    const current = await this.policy();
    if (current.source === 'environment') {
      throw new ConflictException(
        'The admin MFA requirement is set by ADMIN_MFA_REQUIRED on the server and cannot be changed here',
      );
    }
    await this.prisma.adminSecurityPolicy.upsert({
      where: { id: 1 },
      create: { id: 1, mfaRequired: required, updatedBy: actor.userId },
      update: { mfaRequired: required, updatedBy: actor.userId },
    });
    await this.audit(actor, OperationType.UPDATE, 'admin-mfa/policy', {
      action: 'set-requirement',
      required,
      previous: current.required,
    });
    return { required, source: 'setting' };
  }

  // ── Factors ──────────────────────────────────────────────────────────

  async factors(userId: string): Promise<AdminFactors> {
    const [totp, passkeys] = await Promise.all([
      this.prisma.userCredential.findFirst({
        where: { userId, type: 'totp', verified: true },
        select: { id: true },
      }),
      this.prisma.webAuthnCredential.count({ where: { userId } }),
    ]);
    return { totp: !!totp, passkeys };
  }

  static hasFactor(f: AdminFactors): boolean {
    return f.totp || f.passkeys > 0;
  }

  /** The methods the second step offers. */
  async methods(userId: string): Promise<AdminMfaMethod[]> {
    const [f, codes] = await Promise.all([
      this.factors(userId),
      this.mfa.getRecoveryCodeStatus(userId),
    ]);
    const methods: AdminMfaMethod[] = [];
    if (f.totp) methods.push('totp');
    if (f.passkeys > 0) methods.push('passkey');
    if (codes.remaining > 0) methods.push('recovery');
    return methods;
  }

  async status(userId: string): Promise<AdminMfaStatus> {
    const [policy, f, passkeys, recoveryCodes] = await Promise.all([
      this.policy(),
      this.factors(userId),
      this.prisma.webAuthnCredential.findMany({
        where: { userId },
        select: {
          id: true,
          friendlyName: true,
          createdAt: true,
          lastUsedAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.mfa.getRecoveryCodeStatus(userId),
    ]);
    return {
      policy,
      enrolled: AdminMfaService.hasFactor(f),
      totp: f.totp,
      passkeys: passkeys.map((p) => ({
        id: p.id,
        name: p.friendlyName,
        createdAt: p.createdAt,
        lastUsedAt: p.lastUsedAt,
      })),
      recoveryCodes,
    };
  }

  // ── Sign-in challenge ────────────────────────────────────────────────

  /**
   * A one-time handle for the second step of a console sign-in. Only its
   * SHA-256 is stored, under a pending-action type of its own, so neither
   * the hosted login pages nor the console can use the other's.
   */
  async createChallenge(userId: string): Promise<string> {
    const recent = await this.prisma.pendingAction.count({
      where: {
        type: ADMIN_MFA_CHALLENGE,
        data: { path: ['userId'], equals: userId },
        createdAt: {
          gte: new Date(Date.now() - CHALLENGE_WINDOW_SECONDS * 1000),
        },
      },
    });
    if (recent >= CHALLENGES_PER_WINDOW) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: 'Too many sign-in attempts. Please try again later.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const token = this.crypto.generateSecret(32);
    const data: ChallengeData = { userId };
    await this.prisma.pendingAction.create({
      data: {
        tokenHash: this.crypto.sha256(token),
        type: ADMIN_MFA_CHALLENGE,
        data: { ...data },
        expiresAt: new Date(
          Date.now() + ADMIN_MFA_CHALLENGE_TTL_SECONDS * 1000,
        ),
      },
    });
    return token;
  }

  /** The challenge's admin, without spending an attempt (passkey options). */
  async peekChallenge(token: string): Promise<ChallengeData | null> {
    const action = await this.prisma.pendingAction.findUnique({
      where: { tokenHash: this.crypto.sha256(token) },
    });
    if (
      !action ||
      action.type !== ADMIN_MFA_CHALLENGE ||
      action.expiresAt <= new Date() ||
      action.attempts >= ADMIN_MFA_CHALLENGE_MAX_ATTEMPTS
    ) {
      return null;
    }
    return action.data as unknown as ChallengeData;
  }

  /**
   * Spends one attempt atomically, before the answer is checked, so parallel
   * answers cannot get more than ADMIN_MFA_CHALLENGE_MAX_ATTEMPTS guesses.
   * Unknown, expired and spent challenges are dropped.
   */
  async spendChallengeAttempt(token: string): Promise<ChallengeData | null> {
    const tokenHash = this.crypto.sha256(token);
    const { count } = await this.prisma.pendingAction.updateMany({
      where: {
        tokenHash,
        type: ADMIN_MFA_CHALLENGE,
        expiresAt: { gt: new Date() },
        attempts: { lt: ADMIN_MFA_CHALLENGE_MAX_ATTEMPTS },
      },
      data: { attempts: { increment: 1 } },
    });
    if (count === 0) {
      await this.prisma.pendingAction.deleteMany({
        where: { tokenHash, type: ADMIN_MFA_CHALLENGE },
      });
      return null;
    }
    const action = await this.prisma.pendingAction.findUnique({
      where: { tokenHash },
    });
    return action ? (action.data as unknown as ChallengeData) : null;
  }

  /** Claims the challenge after a correct answer: true for the one winner. */
  async consumeChallenge(token: string): Promise<boolean> {
    const { count } = await this.prisma.pendingAction.deleteMany({
      where: {
        tokenHash: this.crypto.sha256(token),
        type: ADMIN_MFA_CHALLENGE,
      },
    });
    return count === 1;
  }

  /** The WebAuthn binding of a sign-in challenge (never the token itself). */
  challengeBinding(token: string): string {
    return `admin-login:${this.crypto.sha256(token)}`;
  }

  /** The WebAuthn binding of an in-session step-up. */
  stepUpBinding(userId: string): string {
    return `admin-step-up:${userId}`;
  }

  // ── Proving a factor ─────────────────────────────────────────────────

  /**
   * Refuses (429) when the account is locked or has spent its second-factor
   * guesses. Reads the user again: a lock can have been set a moment ago.
   */
  private async assertNotLocked(master: Realm, userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.realmId !== master.id || !user.enabled) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const lock = this.bruteForce.checkLocked(master, user);
    const limit = await this.bruteForce.checkTotpRateLimit(master, userId);
    if (lock.locked || limit.blocked) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message:
            'Account locked due to too many failed attempts. Please try again later.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return user;
  }

  private async recordFailure(
    master: Realm,
    userId: string,
    method: AdminMfaMethod,
    ipAddress?: string,
  ): Promise<void> {
    await this.bruteForce.recordTotpFailure(master, userId, ipAddress);
    await this.events
      .recordLoginEvent({
        realmId: master.id,
        userId,
        type: LoginEventType.MFA_VERIFY_ERROR,
        ipAddress,
        error: 'invalid_second_factor',
        details: { via: 'admin-console', method },
      })
      .catch(() => undefined);
  }

  private async recordSuccess(
    master: Realm,
    userId: string,
    method: AdminMfaMethod,
    ipAddress?: string,
  ): Promise<void> {
    await this.bruteForce.resetTotpFailures(master.id, userId);
    await this.events
      .recordLoginEvent({
        realmId: master.id,
        userId,
        type: LoginEventType.MFA_VERIFY,
        ipAddress,
        details: { via: 'admin-console', method },
      })
      .catch(() => undefined);
  }

  /**
   * Checks a TOTP or recovery code. Returns the proof, or null for a wrong
   * code (counted against the account's brute-force limits). Throws 429
   * while the account is locked.
   */
  async verifyCode(
    userId: string,
    method: 'totp' | 'recovery',
    code: string,
    ipAddress?: string,
  ): Promise<AdminMfaProof | null> {
    const master = await this.masterRealm();
    await this.assertNotLocked(master, userId);
    const answer = typeof code === 'string' ? code.trim() : '';
    const ok =
      answer.length > 0 &&
      answer.length <= 64 &&
      (method === 'totp'
        ? await this.mfa.verifyTotp(userId, answer)
        : await this.mfa.verifyRecoveryCode(userId, answer));
    if (!ok) {
      await this.recordFailure(master, userId, method, ipAddress);
      return null;
    }
    await this.recordSuccess(master, userId, method, ipAddress);
    if (method === 'recovery') {
      this.logger.warn(`Admin ${userId} used a recovery code`);
    }
    return proofFor(method);
  }

  async passkeyOptions(
    userId: string,
    binding: string,
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const master = await this.masterRealm();
    if ((await this.factors(userId)).passkeys === 0) {
      throw new BadRequestException('No passkey is registered for this admin');
    }
    return this.webAuthn.generateAuthenticationOptions(
      master,
      userId,
      binding,
      this.relyingParty(master),
    );
  }

  /** Checks a passkey assertion of this admin. Null when it fails. */
  async verifyPasskey(
    userId: string,
    response: AuthenticationResponseJSON,
    binding: string,
    ipAddress?: string,
  ): Promise<AdminMfaProof | null> {
    const master = await this.masterRealm();
    await this.assertNotLocked(master, userId);
    try {
      await this.webAuthn.verifyAuthentication(
        master,
        response,
        binding,
        undefined,
        userId,
        this.relyingParty(master),
      );
    } catch (err) {
      this.logger.warn(
        `Admin ${userId} passkey check failed: ${(err as Error).message}`,
      );
      await this.recordFailure(master, userId, 'passkey', ipAddress);
      return null;
    }
    await this.recordSuccess(master, userId, 'passkey', ipAddress);
    return proofFor('passkey');
  }

  // ── Enrolment ────────────────────────────────────────────────────────

  async startTotp(user: Pick<User, 'id' | 'username'>) {
    if ((await this.factors(user.id)).totp) {
      throw new ConflictException('An authenticator app is already set up');
    }
    return this.mfa.setupTotp(user.id, MASTER_REALM, user.username);
  }

  /**
   * Activates the pending authenticator with its first code, and claims
   * that code so it cannot be replayed as a sign-in. Returns the recovery
   * codes when this is the admin's first factor, else null.
   */
  async activateTotp(
    userId: string,
    code: string,
    actor: AdminMfaActor,
  ): Promise<{ recoveryCodes: string[] | null } | null> {
    const answer = typeof code === 'string' ? code.trim() : '';
    if (!/^\d{6,8}$/.test(answer)) return null;
    const first = !AdminMfaService.hasFactor(await this.factors(userId));
    const issued = await this.mfa.verifyAndActivateTotp(userId, answer);
    if (issued === null) return null;
    await this.mfa.claimTotpCode(userId, answer);
    await this.audit(
      actor,
      OperationType.CREATE,
      `admin-accounts/${userId}/mfa/totp`,
      {
        action: 'enrol-totp',
        userId,
      },
    );
    return {
      recoveryCodes: await this.firstFactorCodes(userId, first, issued),
    };
  }

  /**
   * Recovery codes for a first factor. Activating TOTP may already have
   * issued them (`issued`, empty when the admin still had unused codes).
   */
  private async firstFactorCodes(
    userId: string,
    first: boolean,
    issued?: string[],
  ): Promise<string[] | null> {
    if (issued && issued.length > 0) return issued;
    if (!first) return null;
    return this.mfa.ensureRecoveryCodes(userId);
  }

  async passkeyRegistrationOptions(
    user: User,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const master = await this.masterRealm();
    return this.webAuthn.generateRegistrationOptions(
      user,
      master,
      this.relyingParty(master),
    );
  }

  async registerPasskey(
    user: User,
    response: RegistrationResponseJSON,
    name: string | undefined,
    actor: AdminMfaActor,
  ): Promise<{
    recoveryCodes: string[] | null;
    passkey: { id: string; name: string | null };
  }> {
    const master = await this.masterRealm();
    const first = !AdminMfaService.hasFactor(await this.factors(user.id));
    const credential = await this.webAuthn.verifyRegistration(
      user,
      master,
      response,
      name?.trim().slice(0, 64) || 'Admin console passkey',
      this.relyingParty(master),
    );
    await this.audit(
      actor,
      OperationType.CREATE,
      `admin-accounts/${user.id}/mfa/passkeys/${credential.id}`,
      { action: 'enrol-passkey', userId: user.id },
    );
    return {
      recoveryCodes: await this.firstFactorCodes(user.id, first),
      passkey: { id: credential.id, name: credential.friendlyName },
    };
  }

  /** Refuses to remove the last factor while MFA is required. */
  private async assertKeepsAFactor(
    userId: string,
    after: AdminFactors,
  ): Promise<void> {
    if (AdminMfaService.hasFactor(after)) return;
    if ((await this.policy()).required) {
      throw new ConflictException(
        'MFA is required for every admin: set up another factor before removing this one',
      );
    }
  }

  async removeTotp(userId: string, actor: AdminMfaActor): Promise<void> {
    const f = await this.factors(userId);
    if (!f.totp) throw new NotFoundException('No authenticator app is set up');
    await this.assertKeepsAFactor(userId, { ...f, totp: false });
    await this.prisma.userCredential.deleteMany({
      where: { userId, type: 'totp' },
    });
    await this.dropCodesWithoutFactor(userId);
    await this.audit(
      actor,
      OperationType.DELETE,
      `admin-accounts/${userId}/mfa/totp`,
      {
        action: 'remove-totp',
        userId,
      },
    );
  }

  async removePasskey(
    userId: string,
    passkeyId: string,
    actor: AdminMfaActor,
  ): Promise<void> {
    const f = await this.factors(userId);
    const passkey = await this.prisma.webAuthnCredential.findFirst({
      where: { id: passkeyId, userId },
      select: { id: true },
    });
    if (!passkey) throw new NotFoundException('Passkey not found');
    await this.assertKeepsAFactor(userId, { ...f, passkeys: f.passkeys - 1 });
    await this.prisma.webAuthnCredential.deleteMany({
      where: { id: passkeyId, userId },
    });
    await this.dropCodesWithoutFactor(userId);
    await this.audit(
      actor,
      OperationType.DELETE,
      `admin-accounts/${userId}/mfa/passkeys/${passkeyId}`,
      { action: 'remove-passkey', userId },
    );
  }

  /** Recovery codes go with the last factor, as for end users. */
  private async dropCodesWithoutFactor(userId: string): Promise<void> {
    const f = await this.factors(userId);
    const sms = await this.prisma.userCredential.count({
      where: { userId, type: 'sms', verified: true },
    });
    if (!AdminMfaService.hasFactor(f) && sms === 0) {
      await this.prisma.recoveryCode.deleteMany({ where: { userId } });
    }
  }

  async regenerateRecoveryCodes(
    userId: string,
    actor: AdminMfaActor,
  ): Promise<string[]> {
    if (!AdminMfaService.hasFactor(await this.factors(userId))) {
      throw new BadRequestException(
        'Set up an authenticator app or a passkey first',
      );
    }
    const codes = await this.mfa.generateRecoveryCodes(userId);
    await this.audit(
      actor,
      OperationType.UPDATE,
      `admin-accounts/${userId}/mfa/recovery-codes`,
      { action: 'regenerate-recovery-codes', userId },
    );
    return codes;
  }

  /**
   * Removes every second factor of an admin (TOTP, SMS, passkeys, recovery
   * codes): a super-admin with a recent MFA check, or the admin API key as
   * break-glass. Always recorded. The admin signs in with the password next
   * and enrols again.
   */
  async reset(targetUserId: string, actor: AdminMfaActor): Promise<void> {
    if (targetUserId === actor.userId) {
      throw new BadRequestException(
        'Manage your own factors on your MFA page, not by resetting them',
      );
    }
    const master = await this.masterRealm();
    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, realmId: master.id },
      select: { id: true, username: true },
    });
    if (!target) throw new NotFoundException('Admin account not found');

    await this.mfa.disableAllFactors(target.id);
    await this.prisma.webAuthnCredential.deleteMany({
      where: { userId: target.id },
    });
    await this.prisma.pendingAction.deleteMany({
      where: {
        type: ADMIN_MFA_CHALLENGE,
        data: { path: ['userId'], equals: target.id },
      },
    });
    // A reset is a credential change: the admin is signed out everywhere,
    // console tokens included, and signs in again with the password.
    await this.sessions.revokeAllUserSessions(master, target.id);
    await this.audit(
      actor,
      OperationType.DELETE,
      `admin-accounts/${target.id}/mfa`,
      {
        action: 'reset-mfa',
        userId: target.id,
        username: target.username,
        by: actor.userId.startsWith('api-key:') ? 'api-key' : 'admin',
      },
    );
  }

  // ── Audit ────────────────────────────────────────────────────────────

  /**
   * An admin event in the master realm, recorded even when admin events are
   * off there, and a warning in the log. Never a code or a secret.
   */
  private async audit(
    actor: AdminMfaActor,
    operationType: OperationTypeValue,
    resourcePath: string,
    representation: Record<string, unknown>,
  ): Promise<void> {
    this.logger.warn(
      `Admin MFA: ${String(representation['action'])} on ${resourcePath} by ${actor.userId}`,
    );
    const master = await this.masterRealm();
    await this.events.recordAdminEvent({
      realmId: master.id,
      adminUserId: actor.userId,
      operationType,
      resourceType: ResourceType.ADMIN_MFA,
      resourcePath,
      representation,
      ipAddress: actor.ipAddress,
      always: true,
    });
  }
}
