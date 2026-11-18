import { X509Certificate } from 'node:crypto';

/**
 * The settings of a `saml` identity provider (Idenplane as a SAML 2.0
 * service provider), stored in `identity_providers.saml_config`.
 *
 * One validator, {@link validateSamlConfig}, checks every way a config gets
 * in: the admin API, realm import (v1 and v2), the migration importers and
 * IdP metadata import. What it returns is normalized (certificates as PEM,
 * defaults filled), so the broker can trust a stored config's shape.
 */

export const NAMEID_FORMATS = {
  unspecified: 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified',
  emailAddress: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
  persistent: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
  transient: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient',
  x509SubjectName: 'urn:oasis:names:tc:SAML:1.1:nameid-format:X509SubjectName',
  windowsDomainQualifiedName:
    'urn:oasis:names:tc:SAML:1.1:nameid-format:WindowsDomainQualifiedName',
  kerberos: 'urn:oasis:names:tc:SAML:2.0:nameid-format:kerberos',
} as const;

const KNOWN_NAMEID_FORMATS: ReadonlySet<string> = new Set(
  Object.values(NAMEID_FORMATS),
);

export type SamlSsoBinding = 'redirect' | 'post';
export type SamlUsernameSource = 'nameId' | 'email' | 'attribute';

/** Names of the SAML attributes the broker reads (exact match). */
export interface SamlAttributeMapping {
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /** Read when `usernameSource` is `attribute`. */
  username?: string | null;
}

export interface SamlIdpConfig {
  /** The IdP's entity ID: the only Issuer accepted. */
  entityId: string;
  /** Where AuthnRequests go. */
  ssoUrl: string;
  ssoBinding: SamlSsoBinding;
  /**
   * The IdP's signing certificates (PEM). A signature by any of them is
   * accepted, so a new one can be added before the IdP rolls over.
   */
  signingCertificates: string[];
  /** Asked for in NameIDPolicy, and the only NameID Format accepted. */
  nameIdFormat: string;
  /** Sign AuthnRequests with the realm's signing key. */
  signAuthnRequests: boolean;
  /** Require a valid signature on the Assertion itself. */
  wantAssertionsSigned: boolean;
  /** Require a valid signature on the Response. */
  wantResponseSigned: boolean;
  /** Accept RSA-SHA1 and SHA-1 digests. Off unless set. */
  allowSha1: boolean;
  /** Stored only: Idenplane does not send or accept SAML logout messages. */
  sloUrl: string | null;
  /** Allowed clock difference with the IdP, in seconds. */
  clockSkewSeconds: number;
  /**
   * The attribute whose value identifies the user at the IdP (the link
   * key). Null: the NameID does.
   */
  subjectAttribute: string | null;
  usernameSource: SamlUsernameSource;
  attributes: SamlAttributeMapping;
}

export const SAML_CONFIG_LIMITS = {
  maxCertificates: 5,
  minRsaBits: 2048,
  maxClockSkewSeconds: 600,
  defaultClockSkewSeconds: 60,
  maxStringLength: 2048,
} as const;

/** Defaults for a config that leaves a field out. */
export const SAML_CONFIG_DEFAULTS = {
  ssoBinding: 'redirect' as SamlSsoBinding,
  nameIdFormat: NAMEID_FORMATS.persistent,
  signAuthnRequests: false,
  wantAssertionsSigned: true,
  wantResponseSigned: false,
  allowSha1: false,
  clockSkewSeconds: SAML_CONFIG_LIMITS.defaultClockSkewSeconds,
  usernameSource: 'email' as SamlUsernameSource,
};

/**
 * Attribute names tried when the mapping leaves one out, in order: the
 * short names (Okta, Google, Keycloak), the WS-Federation claim URIs
 * (Entra ID, ADFS) and the LDAP OIDs.
 */
export const DEFAULT_ATTRIBUTE_NAMES: Readonly<
  Record<'email' | 'firstName' | 'lastName', readonly string[]>
> = {
  email: [
    'email',
    'mail',
    'emailAddress',
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
    'urn:oid:0.9.2342.19200300.100.1.3',
  ],
  firstName: [
    'firstName',
    'givenName',
    'given_name',
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
    'urn:oid:2.5.4.42',
  ],
  lastName: [
    'lastName',
    'surname',
    'sn',
    'family_name',
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
    'urn:oid:2.5.4.4',
  ],
};

const KEYS: ReadonlySet<string> = new Set([
  'entityId',
  'ssoUrl',
  'ssoBinding',
  'signingCertificates',
  'nameIdFormat',
  'signAuthnRequests',
  'wantAssertionsSigned',
  'wantResponseSigned',
  'allowSha1',
  'sloUrl',
  'clockSkewSeconds',
  'subjectAttribute',
  'usernameSource',
  'attributes',
]);

const ATTRIBUTE_KEYS: ReadonlySet<string> = new Set([
  'email',
  'firstName',
  'lastName',
  'username',
]);

export type SamlConfigResult =
  { ok: true; config: SamlIdpConfig } | { ok: false; errors: string[] };

/** Whether `host` is a loopback name or address (http allowed there). */
function isLoopback(host: string): boolean {
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '[::1]' ||
    /^127\.\d+\.\d+\.\d+$/.test(host)
  );
}

/** An https URL (http only on loopback, for local testing). */
export function isSamlEndpointUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  if (value.length > SAML_CONFIG_LIMITS.maxStringLength) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  return (
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && isLoopback(url.hostname))
  );
}

/**
 * A certificate as PEM, from PEM or the bare base64 body (as copied out of
 * metadata). Null when it is not one.
 */
export function certificateToPem(value: string): string | null {
  const trimmed = value.trim();
  let body: string;
  if (trimmed.includes('-----BEGIN')) {
    const match =
      /^-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\s]+)-----END CERTIFICATE-----$/.exec(
        trimmed,
      );
    if (!match) return null;
    body = match[1];
  } else {
    body = trimmed;
  }
  body = body.replace(/\s+/g, '');
  if (!body || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return null;
  return `-----BEGIN CERTIFICATE-----\n${(body.match(/.{1,64}/g) ?? []).join(
    '\n',
  )}\n-----END CERTIFICATE-----\n`;
}

/**
 * Checks one IdP signing certificate: an X.509 certificate with an RSA key
 * of at least 2048 bits. Returns the PEM, or why it is refused. Expiry is
 * not checked: SAML trusts the configured key, not the certificate's dates
 * (IdPs such as ADFS publish self-signed certificates), and a stored
 * certificate cannot stop working on its expiry date without warning.
 */
export function checkSigningCertificate(
  value: unknown,
): { pem: string } | { error: string } {
  if (typeof value !== 'string' || !value.trim()) {
    return { error: 'is empty' };
  }
  if (value.length > 16 * 1024) return { error: 'is too long' };
  const pem = certificateToPem(value);
  if (!pem) return { error: 'is not a PEM or base64 X.509 certificate' };
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(pem);
  } catch {
    return { error: 'cannot be read as an X.509 certificate' };
  }
  const key = cert.publicKey;
  if (key.asymmetricKeyType !== 'rsa') {
    return {
      error: `has a ${key.asymmetricKeyType ?? 'unknown'} key; only RSA signing keys are supported`,
    };
  }
  const bits = key.asymmetricKeyDetails?.modulusLength ?? 0;
  if (bits < SAML_CONFIG_LIMITS.minRsaBits) {
    return {
      error: `has a ${bits}-bit RSA key; at least ${SAML_CONFIG_LIMITS.minRsaBits} bits are required`,
    };
  }
  return { pem };
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Checks and normalizes a `saml` provider's config. Unknown keys, wrong
 * types and unusable values are errors (never silently dropped), so what an
 * admin or an import sent is what is stored.
 */
export function validateSamlConfig(input: unknown): SamlConfigResult {
  const errors: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['samlConfig must be an object'] };
  }
  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!KEYS.has(key)) errors.push(`samlConfig.${key} is not a known setting`);
  }
  const tooLong = (v: string | null) =>
    v !== null && v.length > SAML_CONFIG_LIMITS.maxStringLength;

  const entityId = str(raw['entityId']);
  if (!entityId)
    errors.push('samlConfig.entityId (the IdP entity ID) is required');
  else if (tooLong(entityId)) errors.push('samlConfig.entityId is too long');

  const ssoUrl = str(raw['ssoUrl']);
  if (!ssoUrl) errors.push('samlConfig.ssoUrl (the IdP SSO URL) is required');
  else if (!isSamlEndpointUrl(ssoUrl))
    errors.push('samlConfig.ssoUrl must be an https URL');

  const bool = (key: string, fallback: boolean): boolean => {
    const v = raw[key];
    if (v === undefined || v === null) return fallback;
    if (typeof v !== 'boolean') {
      errors.push(`samlConfig.${key} must be a boolean`);
      return fallback;
    }
    return v;
  };

  const ssoBindingRaw = raw['ssoBinding'] ?? SAML_CONFIG_DEFAULTS.ssoBinding;
  if (ssoBindingRaw !== 'redirect' && ssoBindingRaw !== 'post') {
    errors.push("samlConfig.ssoBinding must be 'redirect' or 'post'");
  }

  const certs: string[] = [];
  const certsRaw = raw['signingCertificates'];
  if (!Array.isArray(certsRaw) || certsRaw.length === 0) {
    errors.push(
      'samlConfig.signingCertificates must list at least one IdP signing certificate',
    );
  } else if (certsRaw.length > SAML_CONFIG_LIMITS.maxCertificates) {
    errors.push(
      `samlConfig.signingCertificates may list at most ${SAML_CONFIG_LIMITS.maxCertificates} certificates`,
    );
  } else {
    certsRaw.forEach((c, i) => {
      const checked = checkSigningCertificate(c);
      if ('error' in checked) {
        errors.push(`samlConfig.signingCertificates[${i}] ${checked.error}`);
      } else if (!certs.includes(checked.pem)) {
        certs.push(checked.pem);
      }
    });
  }

  const nameIdFormat =
    raw['nameIdFormat'] === undefined || raw['nameIdFormat'] === null
      ? SAML_CONFIG_DEFAULTS.nameIdFormat
      : str(raw['nameIdFormat']);
  if (!nameIdFormat || !KNOWN_NAMEID_FORMATS.has(nameIdFormat)) {
    errors.push(
      `samlConfig.nameIdFormat must be one of: ${[...KNOWN_NAMEID_FORMATS].join(', ')}`,
    );
  }

  const signAuthnRequests = bool(
    'signAuthnRequests',
    SAML_CONFIG_DEFAULTS.signAuthnRequests,
  );
  const wantAssertionsSigned = bool(
    'wantAssertionsSigned',
    SAML_CONFIG_DEFAULTS.wantAssertionsSigned,
  );
  const wantResponseSigned = bool(
    'wantResponseSigned',
    SAML_CONFIG_DEFAULTS.wantResponseSigned,
  );
  const allowSha1 = bool('allowSha1', SAML_CONFIG_DEFAULTS.allowSha1);

  let sloUrl: string | null = null;
  if (
    raw['sloUrl'] !== undefined &&
    raw['sloUrl'] !== null &&
    raw['sloUrl'] !== ''
  ) {
    if (!isSamlEndpointUrl(raw['sloUrl'])) {
      errors.push('samlConfig.sloUrl must be an https URL');
    } else {
      sloUrl = raw['sloUrl'];
    }
  }

  let clockSkewSeconds: number = SAML_CONFIG_DEFAULTS.clockSkewSeconds;
  const skewRaw = raw['clockSkewSeconds'];
  if (skewRaw !== undefined && skewRaw !== null) {
    if (
      typeof skewRaw !== 'number' ||
      !Number.isInteger(skewRaw) ||
      skewRaw < 0 ||
      skewRaw > SAML_CONFIG_LIMITS.maxClockSkewSeconds
    ) {
      errors.push(
        `samlConfig.clockSkewSeconds must be a whole number from 0 to ${SAML_CONFIG_LIMITS.maxClockSkewSeconds}`,
      );
    } else {
      clockSkewSeconds = skewRaw;
    }
  }

  let subjectAttribute: string | null = null;
  if (
    raw['subjectAttribute'] !== undefined &&
    raw['subjectAttribute'] !== null &&
    raw['subjectAttribute'] !== ''
  ) {
    subjectAttribute = str(raw['subjectAttribute']);
    if (!subjectAttribute || tooLong(subjectAttribute)) {
      errors.push('samlConfig.subjectAttribute must be an attribute name');
    }
  }

  const attributes: SamlAttributeMapping = {};
  const attrsRaw = raw['attributes'];
  if (attrsRaw !== undefined && attrsRaw !== null) {
    if (typeof attrsRaw !== 'object' || Array.isArray(attrsRaw)) {
      errors.push('samlConfig.attributes must be an object');
    } else {
      for (const [key, value] of Object.entries(attrsRaw)) {
        if (!ATTRIBUTE_KEYS.has(key)) {
          errors.push(`samlConfig.attributes.${key} is not a known attribute`);
          continue;
        }
        if (value === undefined || value === null || value === '') continue;
        const name = str(value);
        if (!name || tooLong(name)) {
          errors.push(`samlConfig.attributes.${key} must be an attribute name`);
          continue;
        }
        attributes[key as keyof SamlAttributeMapping] = name;
      }
    }
  }

  const usernameSource =
    raw['usernameSource'] ?? SAML_CONFIG_DEFAULTS.usernameSource;
  if (
    usernameSource !== 'nameId' &&
    usernameSource !== 'email' &&
    usernameSource !== 'attribute'
  ) {
    errors.push(
      "samlConfig.usernameSource must be 'nameId', 'email' or 'attribute'",
    );
  } else if (usernameSource === 'attribute' && !attributes.username) {
    errors.push(
      "samlConfig.attributes.username is required when usernameSource is 'attribute'",
    );
  }

  // A transient NameID changes at every sign-in: as the link key it would
  // create a new account each time.
  if (nameIdFormat === NAMEID_FORMATS.transient && !subjectAttribute) {
    errors.push(
      'a transient NameID cannot identify the user; set samlConfig.subjectAttribute or use a persistent NameID format',
    );
  }

  // The assertion is always covered by a verified signature (see
  // saml-response-verifier.ts); these only add requirements.
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    config: {
      entityId: entityId!,
      ssoUrl: ssoUrl!,
      ssoBinding: ssoBindingRaw as SamlSsoBinding,
      signingCertificates: certs,
      nameIdFormat: nameIdFormat!,
      signAuthnRequests,
      wantAssertionsSigned,
      wantResponseSigned,
      allowSha1,
      sloUrl,
      clockSkewSeconds,
      subjectAttribute,
      usernameSource: usernameSource as SamlUsernameSource,
      attributes,
    },
  };
}

/** A stored config, checked again (a row could predate a stricter rule). */
export function storedSamlConfig(value: unknown): SamlIdpConfig | null {
  const result = validateSamlConfig(value);
  return result.ok ? result.config : null;
}

/**
 * The column values a `saml` provider stores in the OAuth columns, which it
 * does not use. They stay empty strings (not null) so the columns' types,
 * and with them realm export/import, are unchanged.
 */
export const SAML_UNUSED_OAUTH_COLUMNS = {
  clientId: '',
  authorizationUrl: '',
  tokenUrl: '',
  userinfoUrl: null,
  jwksUrl: null,
  issuer: null,
  defaultScopes: '',
} as const;
