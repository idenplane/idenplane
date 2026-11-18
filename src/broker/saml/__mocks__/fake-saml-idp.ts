import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { SignedXml } from 'xml-crypto';
import { spCertificatePem } from '../saml-sp-credentials.js';

/**
 * A SAML identity provider for tests: a real RSA key and X.509 certificate
 * made here (no checked-in keys), and responses signed with them as an IdP
 * signs them. Used by the broker's unit tests and the e2e test.
 */

export const RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
export const RSA_SHA1 = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
export const SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';
export const SHA1 = 'http://www.w3.org/2000/09/xmldsig#sha1';
const EXC_C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
export const PERSISTENT =
  'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent';

export interface FakeIdp {
  entityId: string;
  privateKeyPem: string;
  certificatePem: string;
}

/** A new IdP key pair and self-signed certificate. */
export async function makeFakeIdp(
  entityId = 'https://idp.example.test/saml',
  modulusLength = 2048,
): Promise<FakeIdp> {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const certificatePem = await spCertificatePem(
    {
      kid: randomBytes(8).toString('hex'),
      algorithm: 'RS256',
      publicKey,
      privateKey,
      createdAt: new Date(),
    },
    'fake-idp',
  );
  return { entityId, privateKeyPem: privateKey, certificatePem };
}

export interface FakeResponseOptions {
  idp: FakeIdp;
  spEntityId: string;
  acsUrl: string;
  requestId: string;
  nameId?: string;
  nameIdFormat?: string | null;
  attributes?: Record<string, string[]>;
  responseId?: string;
  assertionId?: string;
  /** Assertion Issuer (default: the IdP's entity ID). */
  issuer?: string;
  /** Response Issuer; null leaves it out. */
  responseIssuer?: string | null;
  /** null leaves it out. */
  destination?: string | null;
  recipient?: string;
  /** null leaves the AudienceRestriction out. */
  audience?: string | null;
  /** Response InResponseTo; null leaves it out. */
  inResponseTo?: string | null;
  /** SubjectConfirmationData InResponseTo. */
  confirmationInResponseTo?: string;
  issueInstant?: Date;
  notBefore?: Date;
  notOnOrAfter?: Date;
  confirmationNotOnOrAfter?: Date;
  status?: string;
  signAssertion?: boolean;
  signResponse?: boolean;
  /** Sign with this key instead of the IdP's. */
  signingKeyPem?: string;
  sha1?: boolean;
  /** Raw XML placed in the Assertion after the AuthnStatement. */
  extraStatements?: string;
}

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const newId = () => `_${randomBytes(16).toString('hex')}`;

/** The unsigned Assertion element. */
export function assertionXml(
  o: FakeResponseOptions & { assertionId: string },
): string {
  const now = o.issueInstant ?? new Date();
  const notBefore = o.notBefore ?? new Date(now.getTime() - 60_000);
  const notOnOrAfter = o.notOnOrAfter ?? new Date(now.getTime() + 5 * 60_000);
  const scdNotOnOrAfter =
    o.confirmationNotOnOrAfter ?? new Date(now.getTime() + 5 * 60_000);
  const format =
    o.nameIdFormat === null
      ? ''
      : ` Format="${esc(o.nameIdFormat ?? PERSISTENT)}"`;
  const attrs = Object.entries(o.attributes ?? {})
    .map(
      ([name, values]) =>
        `<saml:Attribute Name="${esc(name)}">${values
          .map(
            (v) =>
              `<saml:AttributeValue xsi:type="xs:string">${esc(v)}</saml:AttributeValue>`,
          )
          .join('')}</saml:Attribute>`,
    )
    .join('');
  return (
    `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ID="${o.assertionId}" Version="2.0" IssueInstant="${now.toISOString()}">` +
    `<saml:Issuer>${esc(o.issuer ?? o.idp.entityId)}</saml:Issuer>` +
    `<saml:Subject><saml:NameID${format}>${esc(o.nameId ?? 'user-123')}</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">` +
    `<saml:SubjectConfirmationData InResponseTo="${esc(o.confirmationInResponseTo ?? o.requestId)}" NotOnOrAfter="${scdNotOnOrAfter.toISOString()}" Recipient="${esc(o.recipient ?? o.acsUrl)}"/>` +
    `</saml:SubjectConfirmation></saml:Subject>` +
    `<saml:Conditions NotBefore="${notBefore.toISOString()}" NotOnOrAfter="${notOnOrAfter.toISOString()}">` +
    (o.audience === null
      ? ''
      : `<saml:AudienceRestriction><saml:Audience>${esc(o.audience ?? o.spEntityId)}</saml:Audience></saml:AudienceRestriction>`) +
    `</saml:Conditions>` +
    `<saml:AuthnStatement AuthnInstant="${now.toISOString()}" SessionIndex="${o.assertionId}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>` +
    (o.extraStatements ?? '') +
    (attrs
      ? `<saml:AttributeStatement>${attrs}</saml:AttributeStatement>`
      : '') +
    `</saml:Assertion>`
  );
}

/**
 * Signs the element with ID `id` in `xml`, the Signature placed right
 * after that element's Issuer (as the schema requires).
 */
export function signElement(
  xml: string,
  id: string,
  keyPem: string,
  sha1 = false,
): string {
  const sig = new SignedXml({
    privateKey: keyPem,
    signatureAlgorithm: sha1 ? RSA_SHA1 : RSA_SHA256,
    canonicalizationAlgorithm: EXC_C14N,
  });
  sig.addReference({
    xpath: `//*[@ID='${id}']`,
    digestAlgorithm: sha1 ? SHA1 : SHA256,
    transforms: [ENVELOPED, EXC_C14N],
  });
  sig.computeSignature(xml, {
    location: {
      reference: `//*[@ID='${id}']/*[local-name(.)='Issuer']`,
      action: 'after',
    },
  });
  return sig.getSignedXml();
}

/** A Response as an IdP posts it, signed as the options say. */
export function responseXml(o: FakeResponseOptions): string {
  const responseId = o.responseId ?? newId();
  const assertionId = o.assertionId ?? newId();
  const key = o.signingKeyPem ?? o.idp.privateKeyPem;
  let assertion = assertionXml({ ...o, assertionId });
  if (o.signAssertion ?? true) {
    assertion = signElement(assertion, assertionId, key, o.sha1);
  }
  const now = o.issueInstant ?? new Date();
  const destination =
    o.destination === null
      ? ''
      : ` Destination="${esc(o.destination ?? o.acsUrl)}"`;
  const inResponseTo =
    o.inResponseTo === null
      ? ''
      : ` InResponseTo="${esc(o.inResponseTo ?? o.requestId)}"`;
  const responseIssuer =
    o.responseIssuer === null
      ? ''
      : `<saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">${esc(o.responseIssuer ?? o.idp.entityId)}</saml:Issuer>`;
  let xml =
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="${responseId}" Version="2.0" IssueInstant="${now.toISOString()}"${destination}${inResponseTo}>` +
    responseIssuer +
    `<samlp:Status><samlp:StatusCode Value="${esc(o.status ?? 'urn:oasis:names:tc:SAML:2.0:status:Success')}"/></samlp:Status>` +
    assertion +
    `</samlp:Response>`;
  if (o.signResponse) {
    xml = signElement(xml, responseId, key, o.sha1);
  }
  return xml;
}

/** The SAMLResponse form value. */
export const encodeResponse = (xml: string) =>
  Buffer.from(xml, 'utf-8').toString('base64');
