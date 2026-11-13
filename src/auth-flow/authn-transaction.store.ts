import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import {
  mintFlowSessionProof,
  type FlowSessionProof,
  type Receipt,
} from '../authn-core/flow-contracts.js';

/** `PendingAction.type` of a login transaction. */
export const AUTHN_TXN_TYPE = 'authn_txn';

/** A login transaction lives 10 minutes from its start, never extended. */
export const AUTHN_TXN_TTL_MS = 10 * 60 * 1000;

/** A step the runtime adds after the flow to reach the target ACR. */
export type SyntheticStep = 'totp' | 'webauthn';

/**
 * Everything a login transaction knows. Stored only server-side, in
 * `PendingAction.data`; the browser holds nothing but the opaque cookie.
 */
export interface AuthnTxnState {
  realmId: string;
  /** Pinned at start: a changed binding or flow version restarts the login. */
  flowId: string;
  flowVersion: number;
  /**
   * The validated authorization request. The only source of OAuth
   * parameters once the transaction exists; form fields are ignored.
   */
  oauthParams: Record<string, string>;
  /** Requested ACRs: `acr_values` (first) and `claims` acr. */
  requestedAcr: string[];
  loginHint: string | null;
  /** The request's OIDC `claims` parameter, kept for a restart. */
  claims: string | null;
  /** Null until an identifying step passes, then fixed for good. */
  userId: string | null;
  /** The main-path step being satisfied (itself or through its fallbacks). */
  mainStepId: string;
  /** The step the next submission is for: the main step or a fallback. */
  currentStepId: string;
  /** Set while an assurance step added after the flow is pending. */
  synthetic: SyntheticStep | null;
  /** Assurance steps already added, so finalisation never loops. */
  syntheticDone: SyntheticStep[];
  /** Waiting for the user to enrol a second factor (the MFA detour). */
  enrolling: boolean;
  receipts: Receipt[];
  rememberMe: boolean;
  /** Sign-in risk from the gates, for the target ACR and `risk.level`. */
  riskStepUp: boolean;
  riskScore: number | null;
  riskLevel: string | null;
  /** Failed answers so far in this transaction. */
  failures: number;
}

export interface AuthnTxn {
  id: string;
  /**
   * The optimistic-lock version (`PendingAction.attempts`). Every write is a
   * compare-and-set on it, so of two requests that read the same version
   * only one can change the transaction.
   */
  version: number;
  expiresAt: Date;
  state: AuthnTxnState;
}

export type AuthnTxnLookup =
  | { status: 'active'; txn: AuthnTxn }
  /** Past its TTL; the state is still readable, e.g. to restart the login. */
  | { status: 'expired'; txn: AuthnTxn }
  /** Unknown token: never issued, rotated away, finalised or deleted. */
  | { status: 'missing' };

/**
 * Persistence for login transactions (`PendingAction` rows of type
 * `authn_txn`): a 10-minute TTL, an optimistic lock on `attempts`, cookie
 * rotation and a single-use claim at finalisation.
 */
@Injectable()
export class AuthnTransactionStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /** Starts a transaction. Returns it and the cookie value. */
  async create(
    state: AuthnTxnState,
    now = new Date(),
  ): Promise<{ txn: AuthnTxn; token: string }> {
    const token = this.crypto.generateSecret(32);
    const expiresAt = new Date(now.getTime() + AUTHN_TXN_TTL_MS);
    const row = await this.prisma.pendingAction.create({
      data: {
        tokenHash: this.crypto.sha256(token),
        type: AUTHN_TXN_TYPE,
        data: state as unknown as Prisma.InputJsonValue,
        attempts: 0,
        expiresAt,
      },
    });
    return {
      txn: { id: row.id, version: row.attempts, expiresAt, state },
      token,
    };
  }

  /** The transaction a cookie value points to. */
  async find(token: string, now = new Date()): Promise<AuthnTxnLookup> {
    if (!token) return { status: 'missing' };
    const row = await this.prisma.pendingAction.findUnique({
      where: { tokenHash: this.crypto.sha256(token) },
    });
    if (!row || row.type !== AUTHN_TXN_TYPE) return { status: 'missing' };
    const txn: AuthnTxn = {
      id: row.id,
      version: row.attempts,
      expiresAt: row.expiresAt,
      state: row.data as unknown as AuthnTxnState,
    };
    return row.expiresAt.getTime() <= now.getTime()
      ? { status: 'expired', txn }
      : { status: 'active', txn };
  }

  /**
   * Takes the lock for one submission: bumps the version if nobody else
   * did since `txn` was read. Returns the transaction at its new version,
   * or null when a concurrent request got there first (or it expired).
   */
  async begin(txn: AuthnTxn, now = new Date()): Promise<AuthnTxn | null> {
    const { count } = await this.prisma.pendingAction.updateMany({
      where: {
        id: txn.id,
        type: AUTHN_TXN_TYPE,
        attempts: txn.version,
        expiresAt: { gt: now },
      },
      data: { attempts: { increment: 1 } },
    });
    return count === 1 ? { ...txn, version: txn.version + 1 } : null;
  }

  /**
   * Writes the new state if the version is still `txn.version`. With
   * `rotate`, the cookie value changes too (once the user is identified),
   * so a value captured earlier stops working. Returns the transaction at
   * its new version and the new cookie value (when rotated), or null when
   * the compare-and-set lost.
   */
  async commit(
    txn: AuthnTxn,
    state: AuthnTxnState,
    options: { rotate?: boolean } = {},
    now = new Date(),
  ): Promise<{ txn: AuthnTxn; token?: string } | null> {
    const token = options.rotate ? this.crypto.generateSecret(32) : undefined;
    const { count } = await this.prisma.pendingAction.updateMany({
      where: {
        id: txn.id,
        type: AUTHN_TXN_TYPE,
        attempts: txn.version,
        expiresAt: { gt: now },
      },
      data: {
        data: state as unknown as Prisma.InputJsonValue,
        attempts: { increment: 1 },
        ...(token ? { tokenHash: this.crypto.sha256(token) } : {}),
      },
    });
    if (count !== 1) return null;
    return { txn: { ...txn, version: txn.version + 1, state }, token };
  }

  /**
   * Finalisation's single-use claim: deletes the transaction if it is still
   * at `txn.version` and unexpired. Exactly one request can win; it gets the
   * proof SessionIssuer requires. Null when the claim lost (replay,
   * concurrent submit, expiry).
   *
   * @param state the final state, when this request changed it without a
   *   commit (identification and finalisation in one submission).
   */
  async claim(
    txn: AuthnTxn,
    state: AuthnTxnState = txn.state,
    now = new Date(),
  ): Promise<FlowSessionProof | null> {
    const userId = state.userId;
    // Nobody identified: nothing to finalise (and nothing is deleted).
    if (!userId) return null;
    const { count } = await this.prisma.pendingAction.deleteMany({
      where: {
        id: txn.id,
        type: AUTHN_TXN_TYPE,
        attempts: txn.version,
        expiresAt: { gt: now },
      },
    });
    if (count !== 1) return null;
    return mintFlowSessionProof({
      txnId: txn.id,
      realmId: state.realmId,
      userId,
      flowId: state.flowId,
      flowVersion: state.flowVersion,
    });
  }

  /** Ends a transaction without a session (fail closed, restart). */
  async destroy(id: string): Promise<void> {
    await this.prisma.pendingAction.deleteMany({
      where: { id, type: AUTHN_TXN_TYPE },
    });
  }
}
