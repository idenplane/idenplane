/**
 * The messages Idenplane sends as a SAML service provider: the AuthnRequest
 * (HTTP-Redirect or HTTP-POST binding) and the SP metadata. And the reader
 * for the IdP metadata an admin imports.
 */
import { randomBytes, sign as cryptoSign } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import {
  NAMEID_FORMATS,
  certificateToPem,
  type SamlIdpConfig,
} from '../../identity-providers/saml-config.js';
import { pemBody } from './saml-sp-credentials.js';

export const BINDING_REDIRECT =
  'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect';
export const BINDING_POST = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST';
const MD_NS = 'urn:oasis:names:tc:SAML:2.0:metadata';
const DS_NS = 'http://www.w3.org/2000/09/xmldsig#';
const RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';
const EXC_C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#';

/** The SP endpoints of one `saml` identity provider in one realm. */
export interface SpEndpoints {
  entityId: string;
  acsUrl: string;
  metadataUrl: string;
}

export function spEndpoints(
  baseUrl: string,
  realmName: string,
  alias: string,
): SpEndpoints {
  const base = `${baseUrl}/realms/${encodeURIComponent(realmName)}/broker/${encodeURIComponent(alias)}/saml`;
  return {
    // The metadata URL doubles as the entity ID: unique per realm and
    // provider, distinct from the realm's own IdP entity ID, resolvable.
    entityId: `${base}/metadata`,
    acsUrl: `${base}/acs`,
    metadataUrl: `${base}/metadata`,
  };
}

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A new AuthnRequest ID: an NCName (must not start with a digit). */
export function newRequestId(): string {
  return `_${randomBytes(20).toString('hex')}`;
}

export interface AuthnRequestInput {
  id: string;
  issueInstant: Date;
  sp: SpEndpoints;
  config: SamlIdpConfig;
}

/** The AuthnRequest XML, unsigned. */
export function buildAuthnRequest(input: AuthnRequestInput): string {
  const { id, issueInstant, sp, config } = input;
  return (
    `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"` +
    ` ID="${escapeXml(id)}" Version="2.0" IssueInstant="${issueInstant.toISOString()}"` +
    ` Destination="${escapeXml(config.ssoUrl)}"` +
    ` AssertionConsumerServiceURL="${escapeXml(sp.acsUrl)}"` +
    ` ProtocolBinding="${BINDING_POST}">` +
    `<saml:Issuer>${escapeXml(sp.entityId)}</saml:Issuer>` +
    `<samlp:NameIDPolicy Format="${escapeXml(config.nameIdFormat)}" AllowCreate="true"/>` +
    `</samlp:AuthnRequest>`
  );
}

/** An enveloped RSA-SHA256 signature, placed after the Issuer. */
export function signAuthnRequestXml(
  xml: string,
  id: string,
  privateKeyPem: string,
): string {
  const sig = new SignedXml({
    privateKey: privateKeyPem,
    signatureAlgorithm: RSA_SHA256,
    canonicalizationAlgorithm: EXC_C14N,
  });
  sig.addReference({
    xpath: `//*[@ID='${id}']`,
    digestAlgorithm: SHA256,
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      EXC_C14N,
    ],
  });
  sig.computeSignature(xml, {
    location: {
      reference: `//*[local-name(.)='Issuer']`,
      action: 'after',
    },
  });
  return sig.getSignedXml();
}

/**
 * The HTTP-Redirect binding URL (SAML bindings §3.4.4): the request DEFLATEd
 * and base64-encoded, and, when signing, the signature over the encoded
 * `SAMLRequest`, `RelayState` and `SigAlg` exactly as they appear in the URL.
 */
export function redirectBindingUrl(
  ssoUrl: string,
  xml: string,
  relayState: string,
  privateKeyPem: string | null,
): string {
  const samlRequest = deflateRawSync(Buffer.from(xml, 'utf-8')).toString(
    'base64',
  );
  let query =
    `SAMLRequest=${encodeURIComponent(samlRequest)}` +
    `&RelayState=${encodeURIComponent(relayState)}`;
  if (privateKeyPem) {
    query += `&SigAlg=${encodeURIComponent(RSA_SHA256)}`;
    const signature = cryptoSign(
      'sha256',
      Buffer.from(query, 'utf-8'),
      privateKeyPem,
    ).toString('base64');
    query += `&Signature=${encodeURIComponent(signature)}`;
  }
  return `${ssoUrl}${ssoUrl.includes('?') ? '&' : '?'}${query}`;
}

/**
 * The HTTP-POST binding page: a form posting the request to the IdP,
 * submitted by a nonce'd script (the page's CSP allows only that script and
 * only that form target), with a button when scripts are off.
 */
export function postBindingPage(
  ssoUrl: string,
  xml: string,
  relayState: string,
  nonce: string,
): string {
  const samlRequest = Buffer.from(xml, 'utf-8').toString('base64');
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Signing in…</title></head>
<body>
  <form id="saml" method="POST" action="${escapeHtml(ssoUrl)}">
    <input type="hidden" name="SAMLRequest" value="${escapeHtml(samlRequest)}">
    <input type="hidden" name="RelayState" value="${escapeHtml(relayState)}">
    <noscript><p>Continue to your identity provider to sign in.</p><button type="submit">Continue</button></noscript>
  </form>
  <script nonce="${escapeHtml(nonce)}">document.getElementById('saml').submit();</script>
</body>
</html>`;
}

/** The CSP of the POST-binding page: this script, this form target. */
export function postBindingCsp(ssoUrl: string, nonce: string): string {
  const origin = new URL(ssoUrl).origin;
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `form-action ${origin}`,
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** The SP metadata of a `saml` identity provider. */
export function buildSpMetadata(input: {
  sp: SpEndpoints;
  certificatePem: string;
  config: Pick<
    SamlIdpConfig,
    'signAuthnRequests' | 'wantAssertionsSigned' | 'nameIdFormat'
  >;
}): string {
  const { sp, certificatePem, config } = input;
  return `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="${MD_NS}" entityID="${escapeXml(sp.entityId)}">
  <md:SPSSODescriptor AuthnRequestsSigned="${config.signAuthnRequests}" WantAssertionsSigned="${config.wantAssertionsSigned}" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo xmlns:ds="${DS_NS}">
        <ds:X509Data>
          <ds:X509Certificate>${pemBody(certificatePem)}</ds:X509Certificate>
        </ds:X509Data>
      </ds:KeyInfo>
    </md:KeyDescriptor>
    <md:NameIDFormat>${escapeXml(config.nameIdFormat)}</md:NameIDFormat>
    <md:AssertionConsumerService Binding="${BINDING_POST}" Location="${escapeXml(sp.acsUrl)}" index="0" isDefault="true"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>
`;
}

// ─── IDP METADATA IMPORT ────────────────────────────────

export class IdpMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdpMetadataError';
  }
}

/** Largest metadata document read. */
export const MAX_METADATA_SIZE = 1024 * 1024;

/** The config fields an IdP metadata document fills. */
export type IdpMetadataFields = Pick<
  SamlIdpConfig,
  'entityId' | 'ssoUrl' | 'ssoBinding' | 'signingCertificates' | 'nameIdFormat'
> & { sloUrl: string | null; signAuthnRequests?: boolean };

const NAMEID_PREFERENCE = [
  NAMEID_FORMATS.persistent,
  NAMEID_FORMATS.emailAddress,
  NAMEID_FORMATS.unspecified,
];

/**
 * Reads the IdP settings from SAML metadata (an EntityDescriptor, or an
 * EntitiesDescriptor holding exactly one IdP). No DTD or entity is
 * accepted. The metadata's own signature is not checked: the admin vouches
 * for what they paste, and a URL is fetched over the SSRF-safe client.
 */
export function parseIdpMetadata(xml: string): IdpMetadataFields {
  if (xml.length > MAX_METADATA_SIZE) {
    throw new IdpMetadataError('The metadata is too large.');
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new IdpMetadataError('Metadata with a DTD is not accepted.');
  }
  const fail = (msg: unknown): never => {
    throw new IdpMetadataError(
      `The metadata is not well-formed XML: ${String(msg).slice(0, 200)}`,
    );
  };
  let doc: Document;
  try {
    doc = new DOMParser({
      errorHandler: { warning: fail, error: fail, fatalError: fail },
    }).parseFromString(xml, 'text/xml');
  } catch (err) {
    if (err instanceof IdpMetadataError) throw err;
    throw new IdpMetadataError('The metadata is not well-formed XML.');
  }
  const idps = Array.from(
    doc.getElementsByTagNameNS(MD_NS, 'IDPSSODescriptor'),
  );
  if (idps.length !== 1) {
    throw new IdpMetadataError(
      idps.length === 0
        ? 'The metadata describes no SAML identity provider (no IDPSSODescriptor).'
        : 'The metadata describes more than one identity provider; paste the one to use.',
    );
  }
  const idp = idps[0];
  const entity = idp.parentNode as Element | null;
  const entityId = entity?.getAttribute('entityID')?.trim() ?? '';
  if (!entityId) {
    throw new IdpMetadataError('The metadata has no entityID.');
  }
  const direct = (parent: Element, name: string) =>
    Array.from(parent.childNodes).filter(
      (n): n is Element =>
        n.nodeType === 1 &&
        (n as Element).namespaceURI === MD_NS &&
        (n as Element).localName === name,
    );

  const certificates: string[] = [];
  for (const kd of direct(idp, 'KeyDescriptor')) {
    const use = kd.getAttribute('use');
    if (use && use !== 'signing') continue;
    for (const c of Array.from(
      kd.getElementsByTagNameNS(DS_NS, 'X509Certificate'),
    )) {
      const pem = certificateToPem(c.textContent ?? '');
      if (pem && !certificates.includes(pem)) certificates.push(pem);
    }
  }

  const sso = direct(idp, 'SingleSignOnService');
  const redirect = sso.find(
    (s) => s.getAttribute('Binding') === BINDING_REDIRECT,
  );
  const post = sso.find((s) => s.getAttribute('Binding') === BINDING_POST);
  const chosen = redirect ?? post;
  if (!chosen?.getAttribute('Location')) {
    throw new IdpMetadataError(
      'The metadata has no SingleSignOnService with the HTTP-Redirect or HTTP-POST binding.',
    );
  }
  const slo = direct(idp, 'SingleLogoutService').find(
    (s) =>
      s.getAttribute('Binding') === BINDING_REDIRECT ||
      s.getAttribute('Binding') === BINDING_POST,
  );

  const formats = direct(idp, 'NameIDFormat').map((f) =>
    (f.textContent ?? '').trim(),
  );
  const nameIdFormat =
    NAMEID_PREFERENCE.find((f) => formats.includes(f)) ??
    NAMEID_FORMATS.unspecified;

  const fields: IdpMetadataFields = {
    entityId,
    ssoUrl: chosen.getAttribute('Location')!.trim(),
    ssoBinding: chosen === redirect ? 'redirect' : 'post',
    signingCertificates: certificates,
    nameIdFormat,
    sloUrl: slo?.getAttribute('Location')?.trim() || null,
  };
  if (idp.getAttribute('WantAuthnRequestsSigned') === 'true') {
    fields.signAuthnRequests = true;
  }
  return fields;
}
