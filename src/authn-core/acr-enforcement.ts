import {
  OAUTH_FORM_PARAM_KEYS,
  OAUTH_RELAY_PARAM_KEYS,
} from './oauth-params.js';

/**
 * Operator switch for enforcing a requested `acr` on a fresh sign-in.
 *
 * Off by default. With it on, a fresh browser sign-in honours what the
 * authorization request asks of `acr`:
 * - the login form carries `acr_values` and `claims` (as it carries
 *   `prompt`), so the second factor is asked for when the user has one;
 * - an `acr` requested as an Essential Claim through the OIDC `claims`
 *   parameter (OIDC Core §5.5.1.1) is mandatory, as a client's own
 *   `requiredAcr` is: the user answers their second factor or enrols one,
 *   and a sign-in that still cannot meet it ends with
 *   `unmet_authentication_requirements` instead of a code at a weaker
 *   level. `acr_values` stays voluntary, as OIDC Core defines it.
 *
 * Enabled only by the exact (case-insensitive) value `true`, like the other
 * boolean switches.
 */
export const ENFORCE_ACR_ON_FRESH_LOGIN_ENV = 'ENFORCE_ACR_ON_FRESH_LOGIN';

export function isEnforceAcrOnFreshLoginEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[ENFORCE_ACR_ON_FRESH_LOGIN_ENV]?.trim().toLowerCase() === 'true';
}

/**
 * The authorization error for an essential `acr` that cannot be met
 * (OpenID Connect Core Error Code `unmet_authentication_requirements`).
 */
export const UNMET_AUTHENTICATION_REQUIREMENTS =
  'unmet_authentication_requirements';

/** The request parameters that carry what is asked of `acr`. */
export const ACR_REQUEST_PARAM_KEYS = ['acr_values', 'claims'] as const;

/**
 * The parameters the authorization endpoint relays to the login page: the
 * OAuth relay list, plus `claims` with the switch on (`acr_values` is
 * relayed already).
 */
export function relayParamKeys(
  env: NodeJS.ProcessEnv = process.env,
): readonly string[] {
  return isEnforceAcrOnFreshLoginEnabled(env)
    ? [...OAUTH_RELAY_PARAM_KEYS, 'claims']
    : OAUTH_RELAY_PARAM_KEYS;
}

/**
 * The authorization-request parameters a built-in login form carries: the
 * OAuth form fields, plus `acr_values` and `claims` with the switch on.
 */
export function loginFormParamKeys(
  env: NodeJS.ProcessEnv = process.env,
): readonly string[] {
  return isEnforceAcrOnFreshLoginEnabled(env)
    ? [...OAUTH_FORM_PARAM_KEYS, ...ACR_REQUEST_PARAM_KEYS]
    : OAUTH_FORM_PARAM_KEYS;
}
