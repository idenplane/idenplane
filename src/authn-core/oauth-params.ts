export interface AuthorizeParams {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  nonce?: string;
  /** Space-separated list of requested ACR values (highest preference first). */
  acr_values?: string;
  /**
   * OIDC prompt parameter.
   * - none: return error if user is not authenticated
   * - login: force re-authentication
   * - consent: show consent screen
   * - select_account: show account selection
   */
  prompt?: string;
}

/**
 * The OAuth authorization request parameters the hosted forms (login,
 * registration, MFA) carry through as hidden fields and redirects.
 */
export const OAUTH_FORM_PARAM_KEYS = [
  'client_id',
  'redirect_uri',
  'response_type',
  'scope',
  'state',
  'nonce',
  'code_challenge',
  'code_challenge_method',
] as const;

/**
 * The parameters the authorization endpoint relays to the login page. Only
 * these are forwarded, to prevent open-redirect and parameter-injection
 * attacks via arbitrary query string forwarding.
 */
export const OAUTH_RELAY_PARAM_KEYS = [
  ...OAUTH_FORM_PARAM_KEYS,
  'prompt',
  'acr_values',
  'login_hint',
] as const;

/** The non-empty values of `keys` in `src`, in the order of `keys`. */
export function pickOAuthParams(
  src: Record<string, string | undefined>,
  keys: readonly string[],
): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const key of keys) {
    const value = src[key];
    if (value) picked[key] = value;
  }
  return picked;
}
