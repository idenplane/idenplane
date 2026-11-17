import {
  DEFAULT_ATTRIBUTE_NAMES,
  NAMEID_FORMATS,
  type SamlIdpConfig,
} from '../../identity-providers/saml-config.js';
import type { ExternalUserInfo } from '../broker.service.js';
import {
  SamlResponseError,
  type VerifiedSamlAssertion,
} from './saml-response-verifier.js';

const MAX_VALUE_LENGTH = 512;

/** The first value of the first attribute present among `names`. */
function firstValue(
  attributes: Record<string, string[]>,
  names: readonly string[],
): string | undefined {
  for (const name of names) {
    const value = attributes[name]?.find((v) => v.length > 0);
    if (value !== undefined) return value.slice(0, MAX_VALUE_LENGTH);
  }
  return undefined;
}

function mapped(
  attributes: Record<string, string[]>,
  configured: string | null | undefined,
  defaults: readonly string[],
): string | undefined {
  return firstValue(attributes, configured ? [configured] : defaults);
}

/** A plausible email address, or undefined. */
function asEmail(value: string | undefined): string | undefined {
  if (!value || value.length > 320) return undefined;
  return /^[^\s@]+@[^\s@]+$/.test(value) ? value : undefined;
}

/**
 * The external account a verified assertion vouches for, in the broker's
 * terms (the same shape an OIDC userinfo response becomes), so the account
 * linking and creation that follow are the OIDC broker's.
 *
 * - `sub` (the link key): the configured `subjectAttribute`, else the
 *   NameID. A transient NameID is never used as the link key: it changes
 *   at every sign-in.
 * - email, first and last name: the mapped attributes, or the usual names
 *   (DEFAULT_ATTRIBUTE_NAMES) when no mapping is set; an emailAddress
 *   NameID is the email when no attribute carries one.
 * - `emailVerified`: SAML has no "verified" flag, so it is the provider's
 *   `trustEmail` setting. An admin turns that on only for an IdP whose
 *   email values users cannot set themselves (see the SAML guide).
 * - `preferredUsername`: per `usernameSource`.
 */
export function externalUserFromAssertion(
  assertion: VerifiedSamlAssertion,
  config: SamlIdpConfig,
  trustEmail: boolean,
): ExternalUserInfo {
  const { attributes } = assertion;

  let sub: string | undefined;
  if (config.subjectAttribute) {
    sub = firstValue(attributes, [config.subjectAttribute]);
    if (!sub) {
      throw new SamlResponseError(
        `the assertion has no ${JSON.stringify(config.subjectAttribute)} attribute (the configured subject attribute)`,
        'The identity provider did not send the attribute that identifies the user.',
      );
    }
  } else {
    if (
      assertion.nameIdFormat === NAMEID_FORMATS.transient ||
      config.nameIdFormat === NAMEID_FORMATS.transient
    ) {
      throw new SamlResponseError(
        'a transient NameID cannot identify the user and no subject attribute is set',
        'The identity provider sent a temporary user identifier. Configure a persistent NameID or a subject attribute.',
      );
    }
    sub = assertion.nameId;
  }

  let email = asEmail(
    mapped(attributes, config.attributes.email, DEFAULT_ATTRIBUTE_NAMES.email),
  );
  if (
    !email &&
    !config.attributes.email &&
    assertion.nameIdFormat === NAMEID_FORMATS.emailAddress
  ) {
    email = asEmail(assertion.nameId);
  }
  const givenName = mapped(
    attributes,
    config.attributes.firstName,
    DEFAULT_ATTRIBUTE_NAMES.firstName,
  );
  const familyName = mapped(
    attributes,
    config.attributes.lastName,
    DEFAULT_ATTRIBUTE_NAMES.lastName,
  );

  let preferredUsername: string | undefined;
  switch (config.usernameSource) {
    case 'nameId':
      preferredUsername = assertion.nameId.slice(0, MAX_VALUE_LENGTH);
      break;
    case 'email':
      preferredUsername = email;
      break;
    case 'attribute':
      preferredUsername = config.attributes.username
        ? firstValue(attributes, [config.attributes.username])
        : undefined;
      break;
  }

  const name = [givenName, familyName].filter(Boolean).join(' ') || undefined;
  return {
    sub,
    email,
    emailVerified: email ? trustEmail : undefined,
    name,
    givenName,
    familyName,
    preferredUsername,
  };
}
