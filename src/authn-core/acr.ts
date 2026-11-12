// ─── ACR Level Constants ──────────────────────────────────────────────────────

/** ACR level for password-only authentication (level 1). */
export const ACR_PASSWORD = 'urn:idenplane:acr:password';

/** ACR level for password + MFA/TOTP authentication (level 2). */
export const ACR_MFA = 'urn:idenplane:acr:mfa';

/** ACR level for WebAuthn/passkey authentication (level 3). */
export const ACR_WEBAUTHN = 'urn:idenplane:acr:webauthn';

/** All supported ACR values, ordered from lowest to highest assurance. */
export const ACR_VALUES_SUPPORTED = [
  ACR_PASSWORD,
  ACR_MFA,
  ACR_WEBAUTHN,
] as const;

export type AcrValue = (typeof ACR_VALUES_SUPPORTED)[number];

/** Numeric strength mapping: higher number = stronger authentication. */
const ACR_LEVEL_STRENGTH: Record<string, number> = {
  [ACR_PASSWORD]: 1,
  [ACR_MFA]: 2,
  [ACR_WEBAUTHN]: 3,
};

/** Numeric strength of an ACR value; unknown values (and null) count as 0. */
export function acrStrength(acr: string | null | undefined): number {
  return (acr && ACR_LEVEL_STRENGTH[acr]) || 0;
}

/** The strongest of the given ACR values, or `ACR_PASSWORD` if none is known. */
export function strongestAcr(
  ...candidates: Array<string | null | undefined>
): string {
  let best: string = ACR_PASSWORD;
  for (const acr of candidates) {
    if (acr && acrStrength(acr) > acrStrength(best)) best = acr;
  }
  return best;
}

/** The ACR a risk score requires: WebAuthn when CRITICAL (80+), else MFA. */
export function riskStepUpAcr(riskScore: number): string {
  return riskScore >= 80 ? ACR_WEBAUTHN : ACR_MFA;
}

/**
 * Returns true if `candidate` satisfies `required` (i.e. is at least as
 * strong as required).
 */
export function satisfiesAcr(candidate: string, required: string): boolean {
  return acrStrength(candidate) >= acrStrength(required);
}

/**
 * The strongest of the given ACR requirements, or null if none is set.
 * Unlike `strongestAcr`, unset values are skipped rather than defaulting to
 * `ACR_PASSWORD`, an unknown value is kept as is, and on equal strength the
 * earlier requirement wins.
 */
export function resolveRequiredAcr(
  ...candidates: Array<string | null | undefined>
): string | null {
  let required: string | null = null;
  for (const acr of candidates) {
    if (!acr) continue;
    if (!required || acrStrength(acr) > acrStrength(required)) required = acr;
  }
  return required;
}

/**
 * Derive RFC 8176 `amr` values from a session's satisfied ACR. We can only
 * infer methods from the ACR level (we don't track per-method history on the
 * SSO session), so each level maps to its canonical method set:
 *   - WebAuthn  → ['hwk']        (hardware key; matches the passkey login path)
 *   - MFA       → ['pwd', 'otp'] (password + second factor)
 *   - otherwise → ['pwd']        (password only)
 * Must be checked strongest-first so a WebAuthn session (which also satisfies
 * MFA) is not mislabelled as password+otp.
 */
export function amrForSessionAcr(sessionAcr: string): string[] {
  if (satisfiesAcr(sessionAcr, ACR_WEBAUTHN)) {
    return ['hwk'];
  }
  if (satisfiesAcr(sessionAcr, ACR_MFA)) {
    return ['pwd', 'otp'];
  }
  return ['pwd'];
}
