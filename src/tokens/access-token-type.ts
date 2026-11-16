/**
 * The `typ` claim every access token Idenplane mints carries (password,
 * code, refresh, device, client-credentials and impersonation grants).
 *
 * The realm signs ID tokens (`typ: 'ID'`), logout tokens, broker state and,
 * in the master realm, admin tokens (`typ: 'admin'`) with the same key, so a
 * valid signature alone does not make a JWT an access token (ASVS 5.0 V9.2.2,
 * RFC 8725 §3.11). Anything that accepts an access token must also check this.
 */
export const ACCESS_TOKEN_TYP = 'Bearer';

/** True only for a payload minted as an access token. Fails closed. */
export function isAccessTokenPayload(payload: object): boolean {
  return (payload as { typ?: unknown }).typ === ACCESS_TOKEN_TYP;
}
