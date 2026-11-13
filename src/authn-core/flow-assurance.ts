/**
 * How strong a flow sign-in is, computed only from its receipts, and how
 * strong it has to be. Pure functions.
 */
import {
  ACR_MFA,
  ACR_PASSWORD,
  ACR_WEBAUTHN,
  resolveRequiredAcr,
  satisfiesAcr,
} from './acr.js';
import type { Receipt } from './flow-contracts.js';

const FIRST_FACTOR_METHODS = new Set(['pwd']);
const SECOND_FACTOR_METHODS = new Set(['otp', 'sms']);
const HARDWARE_KEY_METHOD = 'hwk';

/**
 * The ACR the receipts prove, or null when they identify no one:
 * - a passkey (`hwk`) → WebAuthn;
 * - a first factor (`pwd`) plus a second (`otp`/`sms`) → MFA;
 * - a first factor alone → password.
 * A second factor without a first one proves nothing on its own.
 */
export function acrFromReceipts(receipts: readonly Receipt[]): string | null {
  const methods = new Set(receipts.flatMap((r) => r.amr));
  if (methods.has(HARDWARE_KEY_METHOD)) return ACR_WEBAUTHN;
  const firstFactor = [...methods].some((m) => FIRST_FACTOR_METHODS.has(m));
  if (!firstFactor) return null;
  const secondFactor = [...methods].some((m) => SECOND_FACTOR_METHODS.has(m));
  return secondFactor ? ACR_MFA : ACR_PASSWORD;
}

/** RFC 8176 methods of the receipts, in the order performed, without repeats. */
export function amrFromReceipts(receipts: readonly Receipt[]): string[] {
  const out: string[] = [];
  for (const r of receipts) {
    for (const m of r.amr) if (!out.includes(m)) out.push(m);
  }
  return out;
}

/**
 * The `acr` a request asks for through the OIDC `claims` parameter
 * (`{"id_token":{"acr":{"value"|"values":…}}}`, or under `userinfo`), or
 * null. Malformed JSON is ignored, as an absent parameter.
 */
export function acrFromClaimsParam(claims: string | undefined): string | null {
  if (!claims) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(claims);
  } catch {
    return null;
  }
  const pick = (section: unknown): string | null => {
    if (!section || typeof section !== 'object') return null;
    const acr = (section as Record<string, unknown>)['acr'];
    if (!acr || typeof acr !== 'object') return null;
    const { value, values } = acr as { value?: unknown; values?: unknown };
    if (typeof value === 'string' && value) return value;
    if (Array.isArray(values) && typeof values[0] === 'string') {
      return values[0];
    }
    return null;
  };
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  return pick(p['id_token']) ?? pick(p['userinfo']);
}

export interface TargetAcrInput {
  /** What the request asked for: `acr_values` (first) and `claims` acr. */
  requested: ReadonlyArray<string | null | undefined>;
  /** The client's configured `requiredAcr` (server-enforced policy). */
  clientRequiredAcr: string | null | undefined;
  /** A step-up flag left on this user by continuous risk evaluation. */
  riskFloor: string | null | undefined;
  /** What this sign-in's own risk assessment asks for (STEP_UP). */
  riskAcr: string | null | undefined;
  /**
   * The legacy MFA rule, exactly: the client requires MFA, the realm
   * requires it, or the user has a second factor enrolled.
   */
  mfaRequired: boolean;
}

export interface TargetAcr {
  /** The strongest of every requirement, or null if none applies. */
  target: string | null;
  /**
   * The part that must be met or the sign-in fails: the client's own
   * requirement and the MFA rule. The rest (`acr_values`, `claims`, risk)
   * is met when the user has the means, as in the built-in login.
   */
  mandatory: string | null;
}

/**
 * `strongest(requested, riskFloor, riskAcr, mfaRequired ? MFA : null)` plus
 * the client's own requirement, so a bound flow never ends weaker than the
 * built-in login would for the same user and client.
 */
export function computeTargetAcr(input: TargetAcrInput): TargetAcr {
  const mfa = input.mfaRequired ? ACR_MFA : null;
  return {
    target: resolveRequiredAcr(
      ...input.requested,
      input.clientRequiredAcr,
      input.riskFloor,
      input.riskAcr,
      mfa,
    ),
    mandatory: resolveRequiredAcr(input.clientRequiredAcr, mfa),
  };
}

/** Whether `acr` (null: nothing proven) meets `required` (null: nothing). */
export function meetsAcr(acr: string | null, required: string | null): boolean {
  if (!required) return acr !== null;
  return acr !== null && satisfiesAcr(acr, required);
}
