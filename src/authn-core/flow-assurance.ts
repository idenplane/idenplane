/**
 * How strong a flow sign-in is, computed only from its receipts, and how
 * strong it has to be. Pure functions.
 */
import {
  ACR_MFA,
  ACR_PASSWORD,
  ACR_WEBAUTHN,
  acrStrength,
  resolveRequiredAcr,
  satisfiesAcr,
} from './acr.js';
import { isIdentifyingType, type Receipt } from './flow-contracts.js';

/**
 * The authentication factor each kind of receipt proves. Two receipts of
 * the same factor are one factor: a sign-in link and an emailed code both
 * prove control of the same mailbox, and a password plus an LDAP password
 * are both something the user knows.
 */
export type AuthnFactor =
  'knowledge' | 'device' | 'mailbox' | 'federated' | 'passkey';

export const RECEIPT_FACTOR: Readonly<Record<Receipt['kind'], AuthnFactor>> = {
  password: 'knowledge',
  ldap: 'knowledge',
  totp: 'device',
  enrolment: 'device',
  webauthn: 'passkey',
  email_otp: 'mailbox',
  magic_link: 'mailbox',
  social: 'federated',
};

/**
 * The kinds of step that are a second factor. An identifying step never is,
 * even after another one: a password plus a sign-in link or a federated
 * sign-in is two ways of saying who you are, not a second factor.
 */
const SECOND_FACTOR_KINDS: ReadonlySet<Receipt['kind']> = new Set([
  'totp',
  'enrolment',
  'email_otp',
]);

/**
 * The ACR the receipts prove, or null when they identify no one. Computed
 * from the kind of step each receipt is for (never from its `amr`, which
 * can be the same for different factors):
 * - a passkey → WebAuthn;
 * - an identifying step (password, ldap, sign-in link, social) plus a
 *   second-factor step (authenticator, texted or emailed code, an MFA
 *   enrolment) of a different factor than every identifying step → MFA;
 * - otherwise an identifying step → password. A sign-in link and an
 *   emailed code prove the same mailbox, so together they stay at the
 *   password level.
 * Steps that identify no one (a second factor alone) prove nothing.
 */
export function acrFromReceipts(receipts: readonly Receipt[]): string | null {
  if (receipts.some((r) => RECEIPT_FACTOR[r.kind] === 'passkey')) {
    return ACR_WEBAUTHN;
  }
  const identifying = receipts.filter(
    (r) => r.kind !== 'enrolment' && isIdentifyingType(r.kind),
  );
  if (identifying.length === 0) return null;
  const identityFactors = new Set(
    identifying.map((r) => RECEIPT_FACTOR[r.kind]),
  );
  const secondFactor = receipts.some(
    (r) =>
      SECOND_FACTOR_KINDS.has(r.kind) &&
      !identityFactors.has(RECEIPT_FACTOR[r.kind]),
  );
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

/**
 * What the OIDC `claims` parameter asks of `acr` as an Essential Claim
 * (OIDC Core §5.5.1.1): the weakest of the requested values this server
 * knows (the hierarchy of ACR_VALUES_SUPPORTED: a stronger level satisfies
 * a weaker one), or `unsupported` when none of them is known, which no
 * sign-in can meet. Null when `acr` is not requested as essential.
 */
export type EssentialAcr =
  { kind: 'acr'; acr: string } | { kind: 'unsupported' };

export function essentialAcrFromClaimsParam(
  claims: string | null | undefined,
): EssentialAcr | null {
  if (!claims) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(claims);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  const requested: string[] = [];
  let essential = false;
  for (const section of [p['id_token'], p['userinfo']]) {
    if (!section || typeof section !== 'object') continue;
    const acr = (section as Record<string, unknown>)['acr'];
    if (!acr || typeof acr !== 'object') continue;
    const {
      value,
      values,
      essential: flag,
    } = acr as {
      value?: unknown;
      values?: unknown;
      essential?: unknown;
    };
    if (flag !== true) continue;
    essential = true;
    if (typeof value === 'string') requested.push(value);
    if (Array.isArray(values)) {
      for (const v of values) if (typeof v === 'string') requested.push(v);
    }
  }
  if (!essential) return null;
  const known = requested.filter((v) => acrStrength(v) > 0);
  // Essential with no value: any level this server issues will do.
  if (requested.length === 0) return { kind: 'acr', acr: ACR_PASSWORD };
  if (known.length === 0) return { kind: 'unsupported' };
  const weakest = known.reduce((a, b) =>
    acrStrength(b) < acrStrength(a) ? b : a,
  );
  return { kind: 'acr', acr: weakest };
}

/** Whether a sign-in at `acr` (null: nothing proven) meets `essential`. */
export function meetsEssentialAcr(
  acr: string | null | undefined,
  essential: EssentialAcr | null,
): boolean {
  if (!essential) return true;
  if (essential.kind === 'unsupported') return false;
  return !!acr && acrStrength(acr) > 0 && satisfiesAcr(acr, essential.acr);
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
  /**
   * An `acr` the request asks for as an Essential Claim, enforced only
   * with ENFORCE_ACR_ON_FRESH_LOGIN (null otherwise). It becomes part of
   * the mandatory requirement, as for the built-in sign-in.
   */
  essentialAcr?: string | null;
}

export interface TargetAcr {
  /** The strongest of every requirement, or null if none applies. */
  target: string | null;
  /**
   * The part that must be met or the sign-in fails: the client's own
   * requirement, the MFA rule and an enforced essential `acr`. The rest
   * (`acr_values`, a voluntary `claims` acr, risk) is met when the user
   * has the means, as in the built-in login.
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
      input.essentialAcr,
    ),
    mandatory: resolveRequiredAcr(
      input.clientRequiredAcr,
      mfa,
      input.essentialAcr,
    ),
  };
}

/** Whether `acr` (null: nothing proven) meets `required` (null: nothing). */
export function meetsAcr(acr: string | null, required: string | null): boolean {
  if (!required) return acr !== null;
  return acr !== null && satisfiesAcr(acr, required);
}
