/**
 * Contracts between the custom auth-flow runtime and the rest of the login
 * stack. Pure types and helpers: no Nest providers, no I/O.
 */

/** The step types the runtime can execute (the validator refuses the rest). */
export type FlowStepType =
  | 'password'
  | 'ldap'
  | 'totp'
  | 'webauthn'
  | 'email_otp'
  | 'magic_link'
  | 'social';

/**
 * The login endpoints a flow step is submitted to. Themes hard-code the
 * form actions of the first four, so the runtime sits behind them:
 * - `password`: `POST /login` (password and ldap steps);
 * - `totp`: `POST /totp` (authenticator, texted and recovery codes);
 * - `webauthn`: `POST /webauthn/authenticate/verify`;
 * - `email_otp`: `POST /login/email-otp` (a code sent by email);
 * - `magic_link`: `GET /login/magic-link?token=…` (the link in the email);
 * - `social`: `GET /broker/{alias}/callback` (back from the provider).
 */
export type LoginEndpoint =
  'password' | 'totp' | 'webauthn' | 'email_otp' | 'magic_link' | 'social';

/** Which endpoint runs each step type. */
export const STEP_ENDPOINT: Readonly<Record<FlowStepType, LoginEndpoint>> = {
  password: 'password',
  ldap: 'password',
  totp: 'totp',
  webauthn: 'webauthn',
  email_otp: 'email_otp',
  magic_link: 'magic_link',
  social: 'social',
};

/** Step types that establish who the user is. */
export const IDENTIFYING_STEP_TYPES: readonly FlowStepType[] = [
  'password',
  'ldap',
  'webauthn',
  'magic_link',
  'social',
];

/** A step type that establishes who the user is. */
export function isIdentifyingType(type: FlowStepType): boolean {
  return IDENTIFYING_STEP_TYPES.includes(type);
}

/**
 * The RFC 8176 methods a passed step records (`totp` records `sms` instead
 * for a texted code):
 * - `email_otp`: `otp`, a one-time code (RFC 8176 §2).
 * - `magic_link`: `otp` too. RFC 8176 has no value for a sign-in link; the
 *   link carries a single-use secret delivered out of band, which is what
 *   `otp` describes, and only registered values are used. How strong a
 *   sign-in is never depends on these values (see `acrFromReceipts`), so a
 *   link and an emailed code never count as two factors.
 * - `social`: none, as for the built-in federated sign-in: the methods the
 *   external provider used are not known here.
 */
export const STEP_AMR: Readonly<Record<FlowStepType, readonly string[]>> = {
  password: ['pwd'],
  ldap: ['pwd'],
  totp: ['otp'],
  webauthn: ['hwk'],
  email_otp: ['otp'],
  magic_link: ['otp'],
  social: [],
};

/**
 * Proof that one step of a login transaction was passed. Receipts are
 * written only by the server-side step handlers and stored only in the
 * transaction (never in a form or cookie); the session's ACR and AMR are
 * computed from them and from nothing else.
 */
export interface Receipt {
  /** The flow step, or a synthetic assurance step (`__assurance_*`). */
  stepId: string;
  /** How the step was passed: a step type, or an MFA enrolment detour. */
  kind: FlowStepType | 'enrolment';
  /** RFC 8176 methods the step performed, e.g. `['pwd']` or `['otp']`. */
  amr: string[];
  /** ISO timestamp of when the step was passed. */
  at: string;
}

/**
 * What a step handler reports.
 * - `passed`: the credential checked out, for `userId`.
 * - `failed`: a wrong answer; the step's fallback (if any) may run.
 * - `locked`: the account or factor is rate-limited / locked; never a fallback.
 * - `user_mismatch`: the answer belongs to someone other than the user the
 *   transaction already identified; the transaction fails closed.
 * A thrown error is treated like `locked`: never a fallback.
 */
export type StepOutcome =
  | { kind: 'passed'; userId: string; amr: string[] }
  | { kind: 'failed'; message: string }
  | { kind: 'locked'; message: string }
  | { kind: 'user_mismatch' };

// ─── Session proof ──────────────────────────────────────────

/** A session for a sign-in that did not run through a bound flow. */
export interface LegacySessionProof {
  readonly kind: 'legacy';
}

/**
 * A session for a sign-in whose login transaction was finalised (claimed,
 * single use) by the flow runtime.
 */
export interface FlowSessionProof {
  readonly kind: 'flow';
  readonly txnId: string;
  readonly realmId: string;
  readonly userId: string;
  readonly flowId: string;
  readonly flowVersion: number;
}

export type SessionProof = LegacySessionProof | FlowSessionProof;

export const LEGACY_SESSION_PROOF: LegacySessionProof = Object.freeze({
  kind: 'legacy',
});

const mintedFlowProofs = new WeakSet<object>();

/**
 * Creates the proof for a finalised transaction. Only the transaction store
 * calls this, right after its single-use claim succeeded; SessionIssuer
 * accepts only proofs created here (a structurally identical object literal
 * is refused), so no other code path can pass itself off as a flow sign-in.
 */
export function mintFlowSessionProof(
  fields: Omit<FlowSessionProof, 'kind'>,
): FlowSessionProof {
  const proof: FlowSessionProof = Object.freeze({ kind: 'flow', ...fields });
  mintedFlowProofs.add(proof);
  return proof;
}

/** Whether `proof` was created by {@link mintFlowSessionProof}. */
export function isMintedFlowSessionProof(
  proof: SessionProof,
): proof is FlowSessionProof {
  return proof.kind === 'flow' && mintedFlowProofs.has(proof);
}
