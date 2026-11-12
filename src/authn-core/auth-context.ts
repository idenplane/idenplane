/**
 * How a user authenticated (OIDC `acr` / RFC 8176 `amr`): the context an SSO
 * session was established with, and the one actually *satisfied* by the flow
 * that produced an authorization code (as opposed to the `acr_values`
 * *requested* by the client). Persisted on the session and on the code so the
 * code→token exchange can mint tokens whose `acr`/`amr` claims reflect the
 * real authentication (RFC 8176 / RFC 9068).
 */
export interface AuthContext {
  /** The ACR level satisfied (e.g. `urn:idenplane:acr:mfa`). */
  acr?: string;
  /** The authentication methods performed (e.g. `['pwd', 'otp']`). */
  amr?: string[];
  /** When the end user authenticated (OIDC `auth_time`); defaults to now. */
  authTime?: Date;
}

/** The methods to record once TOTP completes a sign-in (RFC 8176). */
export function amrWithOtp(primaryAmr: string[] | undefined): string[] {
  return [...(primaryAmr ?? ['pwd']), 'otp'];
}

/**
 * RFC 8176 methods after a second factor: `sms` for a texted code, `otp`
 * for an authenticator or recovery code.
 */
export function amrForFactor(
  primaryAmr: string[] | undefined,
  factor: string | undefined,
): string[] {
  return [...(primaryAmr ?? ['pwd']), factor === 'sms' ? 'sms' : 'otp'];
}
