import type {
  SamlIdpConfig,
  SamlMetadataFields,
  SamlSpEndpoints,
} from '../../types';

/** NameID formats the server accepts, with short labels. */
export const NAMEID_FORMATS: ReadonlyArray<{ value: string; label: string }> = [
  {
    value: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
    label: 'Persistent (recommended)',
  },
  {
    value: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    label: 'Email address',
  },
  {
    value: 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified',
    label: 'Unspecified',
  },
  {
    value: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient',
    label: 'Transient (needs a subject attribute)',
  },
  {
    value: 'urn:oasis:names:tc:SAML:1.1:nameid-format:WindowsDomainQualifiedName',
    label: 'Windows domain qualified name',
  },
  {
    value: 'urn:oasis:names:tc:SAML:1.1:nameid-format:X509SubjectName',
    label: 'X.509 subject name',
  },
  {
    value: 'urn:oasis:names:tc:SAML:2.0:nameid-format:kerberos',
    label: 'Kerberos',
  },
];

/** The SAML part of the identity provider form, as the inputs hold it. */
export interface SamlForm {
  entityId: string;
  ssoUrl: string;
  ssoBinding: 'redirect' | 'post';
  /** PEM certificates, one after another (or base64 bodies on blank-line-separated blocks). */
  certificates: string;
  nameIdFormat: string;
  signAuthnRequests: boolean;
  wantAssertionsSigned: boolean;
  wantResponseSigned: boolean;
  allowSha1: boolean;
  sloUrl: string;
  clockSkewSeconds: string;
  subjectAttribute: string;
  usernameSource: 'nameId' | 'email' | 'attribute';
  emailAttribute: string;
  firstNameAttribute: string;
  lastNameAttribute: string;
  usernameAttribute: string;
}

export const emptySamlForm = (): SamlForm => ({
  entityId: '',
  ssoUrl: '',
  ssoBinding: 'redirect',
  certificates: '',
  nameIdFormat: NAMEID_FORMATS[0].value,
  signAuthnRequests: false,
  wantAssertionsSigned: true,
  wantResponseSigned: false,
  allowSha1: false,
  sloUrl: '',
  clockSkewSeconds: '60',
  subjectAttribute: '',
  usernameSource: 'email',
  emailAttribute: '',
  firstNameAttribute: '',
  lastNameAttribute: '',
  usernameAttribute: '',
});

/** The certificates in a text box: each PEM block, or each base64 block. */
export function splitCertificates(text: string): string[] {
  const pems = text.match(
    /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
  );
  if (pems) return pems.map((p) => p.trim());
  return text
    .split(/\n\s*\n/)
    .map((block) => block.replace(/\s+/g, ''))
    .filter(Boolean);
}

export function samlFormFromConfig(
  config: SamlIdpConfig | null | undefined,
): SamlForm {
  if (!config) return emptySamlForm();
  return {
    entityId: config.entityId,
    ssoUrl: config.ssoUrl,
    ssoBinding: config.ssoBinding,
    certificates: config.signingCertificates.map((c) => c.trim()).join('\n'),
    nameIdFormat: config.nameIdFormat,
    signAuthnRequests: config.signAuthnRequests,
    wantAssertionsSigned: config.wantAssertionsSigned,
    wantResponseSigned: config.wantResponseSigned,
    allowSha1: config.allowSha1,
    sloUrl: config.sloUrl ?? '',
    clockSkewSeconds: String(config.clockSkewSeconds),
    subjectAttribute: config.subjectAttribute ?? '',
    usernameSource: config.usernameSource,
    emailAttribute: config.attributes.email ?? '',
    firstNameAttribute: config.attributes.firstName ?? '',
    lastNameAttribute: config.attributes.lastName ?? '',
    usernameAttribute: config.attributes.username ?? '',
  };
}

/** The fields IdP metadata fills, over what the form already holds. */
export function applyMetadata(form: SamlForm, m: SamlMetadataFields): SamlForm {
  return {
    ...form,
    entityId: m.entityId,
    ssoUrl: m.ssoUrl,
    ssoBinding: m.ssoBinding,
    certificates: m.signingCertificates.map((c) => c.trim()).join('\n'),
    nameIdFormat: m.nameIdFormat,
    sloUrl: m.sloUrl ?? '',
    signAuthnRequests: m.signAuthnRequests ?? form.signAuthnRequests,
  };
}

/** The `samlConfig` the API takes; the server checks it. */
export function samlConfigFromForm(form: SamlForm): Partial<SamlIdpConfig> {
  const opt = (v: string) => (v.trim() ? v.trim() : null);
  const skew = Number(form.clockSkewSeconds);
  return {
    entityId: form.entityId.trim(),
    ssoUrl: form.ssoUrl.trim(),
    ssoBinding: form.ssoBinding,
    signingCertificates: splitCertificates(form.certificates),
    nameIdFormat: form.nameIdFormat,
    signAuthnRequests: form.signAuthnRequests,
    wantAssertionsSigned: form.wantAssertionsSigned,
    wantResponseSigned: form.wantResponseSigned,
    allowSha1: form.allowSha1,
    sloUrl: opt(form.sloUrl),
    clockSkewSeconds: Number.isFinite(skew) ? skew : 60,
    subjectAttribute: opt(form.subjectAttribute),
    usernameSource: form.usernameSource,
    attributes: {
      email: opt(form.emailAttribute),
      firstName: opt(form.firstNameAttribute),
      lastName: opt(form.lastNameAttribute),
      username: opt(form.usernameAttribute),
    },
  };
}

/**
 * The SP endpoints of a provider not saved yet, from this console's own
 * address (the server's BASE_URL is the same in a normal deployment; the
 * saved provider shows the server's own values).
 */
export function previewSpEndpoints(
  origin: string,
  realmName: string,
  alias: string,
): SamlSpEndpoints {
  const base = `${origin}/realms/${encodeURIComponent(realmName)}/broker/${alias ? encodeURIComponent(alias) : '{alias}'}/saml`;
  return {
    entityId: `${base}/metadata`,
    acsUrl: `${base}/acs`,
    metadataUrl: `${base}/metadata`,
  };
}
