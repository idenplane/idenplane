/**
 * Verification of the SAML Response an external identity provider posts to
 * the broker's Assertion Consumer Service (HTTP-POST binding), for
 * Idenplane as a SAML 2.0 service provider.
 *
 * Every check, and where it happens:
 *
 * 1. {@link decodeSamlResponse}: strict base64, size cap.
 * 2. `parseStrictXml` (shared with the IdP side): no DTD or entity (no
 *    XXE), no comment, processing instruction or CDATA, one root, no ID
 *    value used twice. Any xmldom warning is fatal.
 * 3. {@link readResponse} / {@link readAssertion}: the schema shape of
 *    Response, Assertion and Subject (each child in order and at most as
 *    often as the schema allows); encrypted elements refused.
 * 4. {@link verifyElementSignature}: a Signature must be a direct child of
 *    the element it signs, with one Reference to that element's ID and
 *    allow-listed algorithms only (RSA-SHA256/512; RSA-SHA1 only with
 *    `allowSha1`). It is checked with the configured certificates only,
 *    never one the message carries, each attempt on a fresh SignedXml.
 * 5. XML signature wrapping: fields are read only from the canonical bytes
 *    the signature covers, parsed again, and the signed root must be the
 *    element (type and ID) the response presents.
 * 6. {@link checkResponse} / {@link checkAssertion}: Status Success,
 *    Destination, InResponseTo, Issuer, Audience, Recipient,
 *    NotBefore/NotOnOrAfter with the configured skew, a bearer
 *    SubjectConfirmation, an AuthnStatement, the NameID format.
 *
 * Single use (the request ID and the assertion ID) is enforced by the
 * caller against the database: SamlBrokerService.
 */
import { createPublicKey, type KeyObject } from 'node:crypto';
import { SignedXml } from 'xml-crypto';
import {
  ALLOWED_C14N_ALGORITHMS,
  ALLOWED_DIGEST_ALGORITHMS,
  ALLOWED_SIGNATURE_ALGORITHMS,
  ALLOWED_TRANSFORMS,
  NCNAME,
  SAML_ASSERTION_NS,
  SAML_PROTOCOL_NS,
  SamlRequestError,
  XMLDSIG_NS,
  attr,
  childElements,
  is,
  parseStrictXml,
  pick,
  q,
} from '../../saml/saml-request-verifier.js';
import { NAMEID_FORMATS } from '../../identity-providers/saml-config.js';

export const SHA1_SIGNATURE_ALGORITHM =
  'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
export const SHA1_DIGEST_ALGORITHM = 'http://www.w3.org/2000/09/xmldsig#sha1';
export const STATUS_SUCCESS = 'urn:oasis:names:tc:SAML:2.0:status:Success';
export const BEARER = 'urn:oasis:names:tc:SAML:2.0:cm:bearer';
const XMLENC_NS = 'http://www.w3.org/2001/04/xmlenc#';

/** Largest SAMLResponse accepted, base64 as posted. */
export const MAX_SAML_RESPONSE_LENGTH = 512 * 1024;
/** Longest ID (Response, Assertion) accepted and stored. */
export const MAX_ID_LENGTH = 256;

/**
 * A response the broker refuses. `reason` is logged; the user sees only
 * `publicMessage`.
 */
export class SamlResponseError extends Error {
  constructor(
    readonly reason: string,
    readonly publicMessage = 'The identity provider’s SAML response is not valid.',
  ) {
    super(reason);
    this.name = 'SamlResponseError';
  }
}

/** The IdP answered, but with a status other than Success. */
export class SamlStatusError extends SamlResponseError {
  constructor(
    readonly statusCode: string,
    readonly subStatusCode: string | null,
  ) {
    super(
      `the response status is ${q(statusCode)}${subStatusCode ? ` / ${q(subStatusCode)}` : ''}`,
      'The identity provider did not sign you in.',
    );
    this.name = 'SamlStatusError';
  }
}

const SIGNATURE_FAILED = 'The identity provider’s signature is not valid.';

/** What the ACS expects of a response. */
export interface SamlResponseExpectations {
  /** The IdP's entity ID: the only Issuer accepted. */
  idpEntityId: string;
  /** Our entity ID: must be an Audience. */
  spEntityId: string;
  /** Our ACS URL: Destination and Recipient. */
  acsUrl: string;
  /** The AuthnRequest ID this response must answer. */
  requestId: string;
  /** The IdP's signing certificates (PEM). */
  certificates: string[];
  wantAssertionsSigned: boolean;
  wantResponseSigned: boolean;
  allowSha1: boolean;
  clockSkewSeconds: number;
  /** The configured NameID format; `unspecified` accepts any. */
  nameIdFormat: string;
  /** For tests; defaults to Date.now(). */
  now?: number;
}

/** An assertion that passed every check. */
export interface VerifiedSamlAssertion {
  responseId: string;
  assertionId: string;
  issuer: string;
  nameId: string;
  nameIdFormat: string | null;
  sessionIndex: string | null;
  /** Attribute name → its text values. */
  attributes: Record<string, string[]>;
  /**
   * After this time no copy of the assertion can pass the time checks;
   * the replay record must last at least this long.
   */
  replayUntil: number;
  /** Which signatures were present and verified. */
  signed: { response: boolean; assertion: boolean };
}

// ─── DECODING AND PARSING ───────────────────────────────

/** The XML of a posted SAMLResponse. */
export function decodeSamlResponse(value: unknown): string {
  if (typeof value !== 'string' || !value) {
    throw new SamlResponseError('no SAMLResponse in the request');
  }
  if (value.length > MAX_SAML_RESPONSE_LENGTH) {
    throw new SamlResponseError('the SAMLResponse is too large');
  }
  const compact = value.replace(/[\r\n\t ]+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact) || compact.length % 4 !== 0) {
    throw new SamlResponseError('the SAMLResponse is not base64');
  }
  return Buffer.from(compact, 'base64').toString('utf-8');
}

/** parseStrictXml, with its refusals reported as response errors. */
function parseXml(xml: string): Document {
  try {
    return parseStrictXml(xml);
  } catch (err) {
    if (err instanceof SamlRequestError) {
      throw new SamlResponseError(err.reason);
    }
    throw err;
  }
}

// ─── SCHEMA SHAPE ───────────────────────────────────────

interface ChildSpec {
  ns: string;
  name: string;
  /** Children of one group may come in any order; groups in order. */
  group: number;
  min: number;
  max: number;
}

const spec = (
  ns: string,
  name: string,
  group: number,
  min: number,
  max: number,
): ChildSpec => ({ ns, name, group, min, max });

/**
 * The children of `el`, checked against `specs`: nothing unknown, groups in
 * order, each child within its bounds. Keyed by local name.
 */
function readChildren(
  el: Element,
  specs: readonly ChildSpec[],
  what: string,
): Map<string, Element[]> {
  const found = new Map<string, Element[]>();
  let group = -1;
  for (const child of childElements(el)) {
    const s = specs.find((c) => is(child, c.ns, c.name));
    if (!s) {
      throw new SamlResponseError(
        `unexpected element ${q(`{${child.namespaceURI ?? ''}}${child.localName}`)} in ${what}`,
      );
    }
    if (s.group < group) {
      throw new SamlResponseError(`${q(s.name)} is out of order in ${what}`);
    }
    group = s.group;
    const list = found.get(s.name) ?? [];
    list.push(child);
    if (list.length > s.max) {
      throw new SamlResponseError(`${q(s.name)} is repeated in ${what}`);
    }
    found.set(s.name, list);
  }
  for (const s of specs) {
    if ((found.get(s.name)?.length ?? 0) < s.min) {
      throw new SamlResponseError(`${what} has no ${s.name}`);
    }
  }
  return found;
}

const one = (m: Map<string, Element[]>, name: string): Element | undefined =>
  m.get(name)?.[0];

/** The text of an element that may hold only text. */
function text(el: Element, what: string): string {
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType !== 3) {
      throw new SamlResponseError(`${what} must contain text only`);
    }
  }
  return (el.textContent ?? '').trim();
}

const RESPONSE_CHILDREN = [
  spec(SAML_ASSERTION_NS, 'Issuer', 0, 0, 1),
  spec(XMLDSIG_NS, 'Signature', 1, 0, 1),
  spec(SAML_PROTOCOL_NS, 'Extensions', 2, 0, 1),
  spec(SAML_PROTOCOL_NS, 'Status', 3, 1, 1),
  spec(SAML_ASSERTION_NS, 'Assertion', 4, 0, 1),
] as const;

const ASSERTION_CHILDREN = [
  spec(SAML_ASSERTION_NS, 'Issuer', 0, 1, 1),
  spec(XMLDSIG_NS, 'Signature', 1, 0, 1),
  spec(SAML_ASSERTION_NS, 'Subject', 2, 1, 1),
  spec(SAML_ASSERTION_NS, 'Conditions', 3, 1, 1),
  spec(SAML_ASSERTION_NS, 'Advice', 4, 0, 1),
  spec(SAML_ASSERTION_NS, 'AuthnStatement', 5, 1, Infinity),
  spec(SAML_ASSERTION_NS, 'AttributeStatement', 5, 0, Infinity),
  spec(SAML_ASSERTION_NS, 'AuthzDecisionStatement', 5, 0, Infinity),
] as const;

const SUBJECT_CHILDREN = [
  spec(SAML_ASSERTION_NS, 'NameID', 0, 1, 1),
  spec(SAML_ASSERTION_NS, 'SubjectConfirmation', 1, 1, Infinity),
] as const;

const SUBJECT_CONFIRMATION_CHILDREN = [
  spec(SAML_ASSERTION_NS, 'NameID', 0, 0, 1),
  spec(SAML_ASSERTION_NS, 'SubjectConfirmationData', 1, 0, 1),
] as const;

const CONDITIONS_CHILDREN = [
  spec(SAML_ASSERTION_NS, 'AudienceRestriction', 0, 1, Infinity),
  spec(SAML_ASSERTION_NS, 'OneTimeUse', 0, 0, 1),
  spec(SAML_ASSERTION_NS, 'ProxyRestriction', 0, 0, 1),
] as const;

const STATUS_CHILDREN = [
  spec(SAML_PROTOCOL_NS, 'StatusCode', 0, 1, 1),
  spec(SAML_PROTOCOL_NS, 'StatusMessage', 1, 0, 1),
  spec(SAML_PROTOCOL_NS, 'StatusDetail', 2, 0, 1),
] as const;

/** A SAML ID: present, an NCName, not too long. */
function idOf(el: Element, what: string): string {
  const id = attr(el, 'ID') ?? '';
  if (!id || id.length > MAX_ID_LENGTH || !NCNAME.test(id)) {
    throw new SamlResponseError(`${what} has no valid ID`);
  }
  return id;
}

function checkVersion(el: Element, what: string): void {
  if (attr(el, 'Version') !== '2.0') {
    throw new SamlResponseError(`${what} is not SAML 2.0`);
  }
}

/**
 * Anything encrypted is refused before any other check, with a message
 * that says so: the broker does not decrypt (no xml-encryption support).
 */
function refuseEncryption(doc: Document): void {
  for (const name of [
    'EncryptedAssertion',
    'EncryptedID',
    'EncryptedAttribute',
  ]) {
    if (doc.getElementsByTagNameNS(SAML_ASSERTION_NS, name).length) {
      throw new SamlResponseError(
        `the response has an ${name}`,
        'The identity provider encrypted the assertion. Idenplane does not support encrypted assertions: turn assertion encryption off for this application at the identity provider.',
      );
    }
  }
  if (doc.getElementsByTagNameNS(XMLENC_NS, 'EncryptedData').length) {
    throw new SamlResponseError(
      'the response has xenc:EncryptedData',
      'The identity provider encrypted part of the response. Idenplane does not support encrypted assertions.',
    );
  }
}

// ─── SIGNATURES ─────────────────────────────────────────

function algorithmOf(el: Element): string {
  return el.getAttribute('Algorithm') ?? '';
}

function onlyChild(parent: Element, ns: string, name: string): Element {
  const matches = childElements(parent).filter((c) => is(c, ns, name));
  if (matches.length !== 1) {
    throw new SamlResponseError(
      `expected exactly one ${name} in ${parent.localName}`,
      SIGNATURE_FAILED,
    );
  }
  return matches[0];
}

/** The signature and digest algorithms accepted, with or without SHA-1. */
function algorithms(allowSha1: boolean): {
  signature: Set<string>;
  digest: Set<string>;
} {
  const signature = new Set(Object.keys(ALLOWED_SIGNATURE_ALGORITHMS));
  const digest = new Set(ALLOWED_DIGEST_ALGORITHMS);
  if (allowSha1) {
    signature.add(SHA1_SIGNATURE_ALGORITHM);
    digest.add(SHA1_DIGEST_ALGORITHM);
  }
  return { signature, digest };
}

/**
 * The shape of the enveloped signature of `el`: a direct child, with one
 * SignedInfo, one Reference to `#el/@ID`, and allow-listed algorithms only.
 */
function checkSignatureShape(
  signature: Element,
  el: Element,
  allowSha1: boolean,
): void {
  if (signature.parentNode !== el) {
    throw new SamlResponseError(
      `a signature is not a child of the ${el.localName} it signs`,
      SIGNATURE_FAILED,
    );
  }
  for (const child of childElements(signature)) {
    if (
      !is(child, XMLDSIG_NS, 'SignedInfo') &&
      !is(child, XMLDSIG_NS, 'SignatureValue') &&
      !is(child, XMLDSIG_NS, 'KeyInfo')
    ) {
      throw new SamlResponseError(
        `unexpected element ${q(child.localName)} in Signature`,
        SIGNATURE_FAILED,
      );
    }
  }
  const allowed = algorithms(allowSha1);
  const signedInfo = onlyChild(signature, XMLDSIG_NS, 'SignedInfo');
  onlyChild(signature, XMLDSIG_NS, 'SignatureValue');
  const c14n = algorithmOf(
    onlyChild(signedInfo, XMLDSIG_NS, 'CanonicalizationMethod'),
  );
  if (!ALLOWED_C14N_ALGORITHMS.has(c14n)) {
    throw new SamlResponseError(
      `canonicalization ${q(c14n)} is not allowed`,
      SIGNATURE_FAILED,
    );
  }
  const sigAlg = algorithmOf(
    onlyChild(signedInfo, XMLDSIG_NS, 'SignatureMethod'),
  );
  if (!allowed.signature.has(sigAlg)) {
    throw new SamlResponseError(
      `signature algorithm ${q(sigAlg)} is not allowed`,
      sigAlg === SHA1_SIGNATURE_ALGORITHM
        ? 'The identity provider signed with SHA-1, which is not accepted. Configure it to sign with SHA-256.'
        : SIGNATURE_FAILED,
    );
  }
  const reference = onlyChild(signedInfo, XMLDSIG_NS, 'Reference');
  const id = attr(el, 'ID') ?? '';
  const uri = reference.getAttribute('URI');
  if (!id || uri !== `#${id}`) {
    throw new SamlResponseError(
      `the ${el.localName} signature references ${q(uri)}, not the ${el.localName}`,
      SIGNATURE_FAILED,
    );
  }
  const digest = algorithmOf(onlyChild(reference, XMLDSIG_NS, 'DigestMethod'));
  if (!allowed.digest.has(digest)) {
    throw new SamlResponseError(
      `digest algorithm ${q(digest)} is not allowed`,
      digest === SHA1_DIGEST_ALGORITHM
        ? 'The identity provider signed with SHA-1, which is not accepted. Configure it to sign with SHA-256.'
        : SIGNATURE_FAILED,
    );
  }
  const transforms = childElements(reference).filter((c) =>
    is(c, XMLDSIG_NS, 'Transforms'),
  );
  if (transforms.length > 1) {
    throw new SamlResponseError('more than one Transforms', SIGNATURE_FAILED);
  }
  for (const transform of transforms.length
    ? childElements(transforms[0])
    : []) {
    if (
      !is(transform, XMLDSIG_NS, 'Transform') ||
      !ALLOWED_TRANSFORMS.has(algorithmOf(transform))
    ) {
      throw new SamlResponseError(
        `transform ${q(algorithmOf(transform))} is not allowed`,
        SIGNATURE_FAILED,
      );
    }
  }
}

/** The public keys of the configured certificates. */
export function verificationKeys(certificates: readonly string[]): KeyObject[] {
  const keys: KeyObject[] = [];
  for (const pem of certificates) {
    try {
      keys.push(createPublicKey(pem));
    } catch {
      // A certificate that cannot be read verifies nothing; the config
      // validator refuses such certificates, so this is only a stale row.
    }
  }
  if (!keys.length) {
    throw new SamlResponseError(
      'no usable signing certificate is configured',
      SIGNATURE_FAILED,
    );
  }
  return keys;
}

/**
 * Verifies the enveloped signature `signature` of `el` in the document
 * `xml` with one of `keys`, and returns the canonical bytes it covers.
 * Each attempt uses a fresh SignedXml (one instance accumulates what it
 * has verified), restricted to the allowed algorithms (so an HMAC
 * algorithm, keyed with a public certificate, can never be loaded).
 */
function verifyElementSignature(
  xml: string,
  el: Element,
  signature: Element,
  keys: readonly KeyObject[],
  allowSha1: boolean,
): string {
  checkSignatureShape(signature, el, allowSha1);
  const allowed = algorithms(allowSha1);
  const reasons: string[] = [];
  for (const key of keys) {
    const sig = new SignedXml({
      publicCert: key,
      // Only the configured certificates count, never one in KeyInfo.
      getCertFromKeyInfo: () => null,
    });
    sig.SignatureAlgorithms = pick(sig.SignatureAlgorithms, allowed.signature);
    sig.HashAlgorithms = pick(sig.HashAlgorithms, allowed.digest);
    sig.CanonicalizationAlgorithms = pick(
      sig.CanonicalizationAlgorithms,
      ALLOWED_TRANSFORMS,
    );
    try {
      sig.loadSignature(signature);
      if (!sig.checkSignature(xml)) {
        reasons.push('not valid');
        continue;
      }
    } catch (err) {
      reasons.push((err as Error).message);
      continue;
    }
    const signed = sig.getSignedReferences();
    if (signed.length !== 1) {
      throw new SamlResponseError(
        `the ${el.localName} signature covers ${signed.length} references`,
        SIGNATURE_FAILED,
      );
    }
    return signed[0];
  }
  throw new SamlResponseError(
    `the ${el.localName} signature does not verify with any configured certificate (${reasons
      .map((r) => q(r))
      .join(', ')})`,
    SIGNATURE_FAILED,
  );
}

/**
 * The element the signed bytes hold, parsed again; it must be an element
 * of the same type and ID as the one the signature was found on.
 */
function signedElement(bytes: string, el: Element): Element {
  const root = parseXml(bytes).documentElement;
  if (
    root.namespaceURI !== el.namespaceURI ||
    root.localName !== el.localName ||
    attr(root, 'ID') !== attr(el, 'ID')
  ) {
    throw new SamlResponseError(
      `the signed element is not the ${el.localName} presented`,
      SIGNATURE_FAILED,
    );
  }
  return root;
}

// ─── TIME ───────────────────────────────────────────────

const XS_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

function timeOf(value: string | null, what: string): number {
  if (!value || !XS_DATE_TIME.test(value)) {
    throw new SamlResponseError(`${what} ${q(value)} is not an xs:dateTime`);
  }
  const zoned = /(Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`;
  const time = Date.parse(zoned);
  if (Number.isNaN(time)) {
    throw new SamlResponseError(`${what} ${q(value)} is not a date`);
  }
  return time;
}

function optionalTime(el: Element, name: string, what: string): number | null {
  const value = attr(el, name);
  return value === null ? null : timeOf(value, `${what} ${name}`);
}

const EXPIRED =
  'The identity provider’s SAML response has expired. Please sign in again.';

// ─── RESPONSE ───────────────────────────────────────────

interface ResponseParts {
  root: Element;
  children: Map<string, Element[]>;
}

function readResponse(root: Element): ResponseParts {
  if (!is(root, SAML_PROTOCOL_NS, 'Response')) {
    throw new SamlResponseError('the root element is not a samlp:Response');
  }
  checkVersion(root, 'Response');
  idOf(root, 'Response');
  return {
    root,
    children: readChildren(root, RESPONSE_CHILDREN, 'Response'),
  };
}

/** The top-level StatusCode, and its first nested one. */
function statusOf(status: Element): { code: string; sub: string | null } {
  const children = readChildren(status, STATUS_CHILDREN, 'Status');
  const codeEl = one(children, 'StatusCode')!;
  const code = attr(codeEl, 'Value') ?? '';
  const subEl = childElements(codeEl).find((c) =>
    is(c, SAML_PROTOCOL_NS, 'StatusCode'),
  );
  return { code, sub: subEl ? attr(subEl, 'Value') : null };
}

/**
 * The Response-level checks. When the Response is not signed these fields
 * are not authenticated; the same facts are checked again on the signed
 * assertion (SubjectConfirmationData Recipient and InResponseTo, Issuer).
 */
function checkResponse(
  parts: ResponseParts,
  exp: SamlResponseExpectations,
  now: number,
): void {
  const { root, children } = parts;
  const destination = attr(root, 'Destination');
  if (destination !== exp.acsUrl) {
    throw new SamlResponseError(
      `Destination ${q(destination)} is not ${q(exp.acsUrl)}`,
    );
  }
  const inResponseTo = attr(root, 'InResponseTo');
  if (inResponseTo === null) {
    throw new SamlResponseError(
      'the response has no InResponseTo (IdP-initiated sign-in is not supported)',
      'Sign-in must start at Idenplane: sign-in started at the identity provider (IdP-initiated SSO) is not supported.',
    );
  }
  if (inResponseTo !== exp.requestId) {
    throw new SamlResponseError(
      `InResponseTo ${q(inResponseTo)} is not the request ${q(exp.requestId)}`,
    );
  }
  const issuerEl = one(children, 'Issuer');
  if (issuerEl) {
    checkIssuer(issuerEl, exp, 'Response');
  }
  const issued = timeOf(attr(root, 'IssueInstant'), 'Response IssueInstant');
  if (issued > now + exp.clockSkewSeconds * 1000) {
    throw new SamlResponseError(
      'the response was issued in the future',
      EXPIRED,
    );
  }
  const status = statusOf(one(children, 'Status')!);
  if (status.code !== STATUS_SUCCESS) {
    throw new SamlStatusError(status.code, status.sub);
  }
}

function checkIssuer(
  issuerEl: Element,
  exp: SamlResponseExpectations,
  what: string,
): void {
  const format = attr(issuerEl, 'Format');
  if (
    format !== null &&
    format !== 'urn:oasis:names:tc:SAML:2.0:nameid-format:entity'
  ) {
    throw new SamlResponseError(`${what} Issuer has Format ${q(format)}`);
  }
  const issuer = text(issuerEl, 'Issuer');
  if (issuer !== exp.idpEntityId) {
    throw new SamlResponseError(
      `${what} Issuer ${q(issuer)} is not the identity provider ${q(exp.idpEntityId)}`,
    );
  }
}

// ─── ASSERTION ──────────────────────────────────────────

/** Reads and checks an assertion taken from signed bytes. */
function checkAssertion(
  assertion: Element,
  exp: SamlResponseExpectations,
  now: number,
): Omit<VerifiedSamlAssertion, 'responseId' | 'signed'> {
  checkVersion(assertion, 'Assertion');
  const assertionId = idOf(assertion, 'Assertion');
  const children = readChildren(assertion, ASSERTION_CHILDREN, 'Assertion');
  const skew = exp.clockSkewSeconds * 1000;

  checkIssuer(one(children, 'Issuer')!, exp, 'Assertion');
  const issued = timeOf(
    attr(assertion, 'IssueInstant'),
    'Assertion IssueInstant',
  );
  if (issued > now + skew) {
    throw new SamlResponseError(
      'the assertion was issued in the future',
      EXPIRED,
    );
  }

  // Conditions: the time window and every AudienceRestriction.
  const conditions = one(children, 'Conditions')!;
  const condChildren = readChildren(
    conditions,
    CONDITIONS_CHILDREN,
    'Conditions',
  );
  const notBefore = optionalTime(conditions, 'NotBefore', 'Conditions');
  const notOnOrAfter = optionalTime(conditions, 'NotOnOrAfter', 'Conditions');
  if (notBefore !== null && now + skew < notBefore) {
    throw new SamlResponseError('the assertion is not yet valid', EXPIRED);
  }
  if (notOnOrAfter !== null && now - skew >= notOnOrAfter) {
    throw new SamlResponseError('the assertion has expired', EXPIRED);
  }
  for (const restriction of condChildren.get('AudienceRestriction') ?? []) {
    const audiences = childElements(restriction).map((a) => {
      if (!is(a, SAML_ASSERTION_NS, 'Audience')) {
        throw new SamlResponseError(
          `unexpected element ${q(a.localName)} in AudienceRestriction`,
        );
      }
      return text(a, 'Audience');
    });
    if (!audiences.includes(exp.spEntityId)) {
      throw new SamlResponseError(
        `the assertion is for ${q(audiences.join(' '))}, not ${q(exp.spEntityId)}`,
      );
    }
  }

  // Subject: the NameID, and one bearer confirmation that passes.
  const subject = one(children, 'Subject')!;
  const subjectChildren = readChildren(subject, SUBJECT_CHILDREN, 'Subject');
  const nameIdEl = one(subjectChildren, 'NameID')!;
  const nameId = text(nameIdEl, 'NameID');
  if (!nameId) throw new SamlResponseError('the NameID is empty');
  if (nameId.length > 1024)
    throw new SamlResponseError('the NameID is too long');
  const nameIdFormat = attr(nameIdEl, 'Format');
  if (
    exp.nameIdFormat !== NAMEID_FORMATS.unspecified &&
    nameIdFormat !== null &&
    nameIdFormat !== NAMEID_FORMATS.unspecified &&
    nameIdFormat !== exp.nameIdFormat
  ) {
    throw new SamlResponseError(
      `NameID Format ${q(nameIdFormat)} is not the configured ${q(exp.nameIdFormat)}`,
    );
  }

  const confirmationErrors: string[] = [];
  let confirmedUntil: number | null = null;
  for (const confirmation of subjectChildren.get('SubjectConfirmation') ?? []) {
    try {
      confirmedUntil = checkBearerConfirmation(confirmation, exp, now);
      break;
    } catch (err) {
      if (!(err instanceof SamlResponseError)) throw err;
      confirmationErrors.push(err.reason);
    }
  }
  if (confirmedUntil === null) {
    throw new SamlResponseError(
      `no SubjectConfirmation passes: ${confirmationErrors.join('; ')}`,
      confirmationErrors.some((r) => r.includes('expired'))
        ? EXPIRED
        : undefined,
    );
  }

  // AuthnStatement (at least one; the schema check counted it).
  let sessionIndex: string | null = null;
  for (const statement of children.get('AuthnStatement') ?? []) {
    timeOf(attr(statement, 'AuthnInstant'), 'AuthnInstant');
    const sessionEnd = optionalTime(
      statement,
      'SessionNotOnOrAfter',
      'AuthnStatement',
    );
    if (sessionEnd !== null && now - skew >= sessionEnd) {
      throw new SamlResponseError('the IdP session has ended', EXPIRED);
    }
    sessionIndex ??= attr(statement, 'SessionIndex');
  }

  const attributes = readAttributes(children.get('AttributeStatement') ?? []);
  const replayUntil =
    Math.max(confirmedUntil, notOnOrAfter ?? confirmedUntil) + skew;
  return {
    assertionId,
    issuer: exp.idpEntityId,
    nameId,
    nameIdFormat,
    sessionIndex,
    attributes,
    replayUntil,
  };
}

/**
 * A bearer SubjectConfirmation (SAML profiles §4.1.4.2): Recipient is our
 * ACS URL, InResponseTo our request, NotOnOrAfter required and not passed.
 * Returns its NotOnOrAfter.
 */
function checkBearerConfirmation(
  confirmation: Element,
  exp: SamlResponseExpectations,
  now: number,
): number {
  if (attr(confirmation, 'Method') !== BEARER) {
    throw new SamlResponseError(
      `SubjectConfirmation Method ${q(attr(confirmation, 'Method'))} is not bearer`,
    );
  }
  const children = readChildren(
    confirmation,
    SUBJECT_CONFIRMATION_CHILDREN,
    'SubjectConfirmation',
  );
  const data = one(children, 'SubjectConfirmationData');
  if (!data) {
    throw new SamlResponseError('a bearer SubjectConfirmation has no data');
  }
  const recipient = attr(data, 'Recipient');
  if (recipient !== exp.acsUrl) {
    throw new SamlResponseError(
      `Recipient ${q(recipient)} is not ${q(exp.acsUrl)}`,
    );
  }
  const inResponseTo = attr(data, 'InResponseTo');
  if (inResponseTo !== exp.requestId) {
    throw new SamlResponseError(
      `SubjectConfirmationData InResponseTo ${q(inResponseTo)} is not the request ${q(exp.requestId)}`,
    );
  }
  const skew = exp.clockSkewSeconds * 1000;
  const notOnOrAfter = optionalTime(
    data,
    'NotOnOrAfter',
    'SubjectConfirmationData',
  );
  if (notOnOrAfter === null) {
    throw new SamlResponseError('SubjectConfirmationData has no NotOnOrAfter');
  }
  if (now - skew >= notOnOrAfter) {
    throw new SamlResponseError('the subject confirmation has expired');
  }
  const notBefore = optionalTime(data, 'NotBefore', 'SubjectConfirmationData');
  if (notBefore !== null && now + skew < notBefore) {
    throw new SamlResponseError('the subject confirmation is not yet valid');
  }
  return notOnOrAfter;
}

/** Attribute name → text values (complex values are skipped). */
function readAttributes(statements: Element[]): Record<string, string[]> {
  const out: Record<string, string[]> = Object.create(null) as Record<
    string,
    string[]
  >;
  for (const statement of statements) {
    for (const attribute of childElements(statement)) {
      if (!is(attribute, SAML_ASSERTION_NS, 'Attribute')) {
        throw new SamlResponseError(
          `unexpected element ${q(attribute.localName)} in AttributeStatement`,
        );
      }
      const name = attr(attribute, 'Name');
      if (!name) throw new SamlResponseError('an Attribute has no Name');
      const values = (out[name] ??= []);
      for (const value of childElements(attribute)) {
        if (!is(value, SAML_ASSERTION_NS, 'AttributeValue')) {
          throw new SamlResponseError(
            `unexpected element ${q(value.localName)} in Attribute`,
          );
        }
        const textOnly = Array.from(value.childNodes).every(
          (n) => n.nodeType === 3,
        );
        if (!textOnly) continue;
        const v = (value.textContent ?? '').trim();
        if (v) values.push(v);
      }
    }
  }
  return out;
}

// ─── ENTRY POINT ────────────────────────────────────────

/**
 * Verifies a decoded SAMLResponse against what the ACS expects and returns
 * the assertion read from signed bytes. Throws SamlResponseError (or
 * SamlStatusError for a non-Success status) on any failure.
 */
export function verifySamlResponse(
  xml: string,
  exp: SamlResponseExpectations,
): VerifiedSamlAssertion {
  const now = exp.now ?? Date.now();
  const doc = parseXml(xml);
  refuseEncryption(doc);

  const presented = readResponse(doc.documentElement);
  // Response-level checks on the document as presented; a non-Success
  // status ends here (such a response normally has no assertion and no
  // signature).
  checkResponse(presented, exp, now);

  const presentedAssertion = one(presented.children, 'Assertion');
  if (!presentedAssertion) {
    throw new SamlResponseError('the response has no Assertion');
  }

  // Signatures may only sit on the Response and on the Assertion.
  const responseSignature = one(presented.children, 'Signature');
  const assertionSignature = childElements(presentedAssertion).find((c) =>
    is(c, XMLDSIG_NS, 'Signature'),
  );
  const allSignatures = Array.from(
    doc.getElementsByTagNameNS(XMLDSIG_NS, 'Signature'),
  );
  const expectedCount =
    (responseSignature ? 1 : 0) + (assertionSignature ? 1 : 0);
  if (allSignatures.length !== expectedCount) {
    throw new SamlResponseError(
      'the response has a signature on an element other than the Response or the Assertion',
      SIGNATURE_FAILED,
    );
  }

  if (exp.wantResponseSigned && !responseSignature) {
    throw new SamlResponseError(
      'the Response is not signed and a signed Response is required',
      'The identity provider’s response is not signed, and this provider requires a signed response.',
    );
  }
  if (exp.wantAssertionsSigned && !assertionSignature) {
    throw new SamlResponseError(
      'the Assertion is not signed and a signed Assertion is required',
      'The identity provider’s assertion is not signed, and this provider requires a signed assertion.',
    );
  }
  if (!responseSignature && !assertionSignature) {
    // Whatever the settings, an assertion no signature covers is refused.
    throw new SamlResponseError(
      'neither the Response nor the Assertion is signed',
      'The identity provider’s response is not signed.',
    );
  }

  const keys = verificationKeys(exp.certificates);

  // The Response signature, then the fields read from what it covers.
  let trustedResponse: Element | null = null;
  if (responseSignature) {
    const bytes = verifyElementSignature(
      xml,
      presented.root,
      responseSignature,
      keys,
      exp.allowSha1,
    );
    trustedResponse = signedElement(bytes, presented.root);
    const parts = readResponse(trustedResponse);
    checkResponse(parts, exp, now);
  }

  // The assertion to use: from the assertion's own signed bytes if it is
  // signed, else from the signed Response's bytes.
  let trustedAssertion: Element;
  if (assertionSignature) {
    const bytes = verifyElementSignature(
      xml,
      presentedAssertion,
      assertionSignature,
      keys,
      exp.allowSha1,
    );
    trustedAssertion = signedElement(bytes, presentedAssertion);
  } else {
    const fromResponse = childElements(trustedResponse!).filter((c) =>
      is(c, SAML_ASSERTION_NS, 'Assertion'),
    );
    if (fromResponse.length !== 1) {
      throw new SamlResponseError(
        'the signed Response does not hold exactly one Assertion',
        SIGNATURE_FAILED,
      );
    }
    trustedAssertion = fromResponse[0];
  }
  if (attr(trustedAssertion, 'ID') !== attr(presentedAssertion, 'ID')) {
    throw new SamlResponseError(
      'the signed assertion is not the assertion presented',
      SIGNATURE_FAILED,
    );
  }
  // When both are signed, the Response's copy of the assertion must be the
  // same assertion (it is, byte for byte, unless the document was altered).
  if (trustedResponse && assertionSignature) {
    const inSignedResponse = childElements(trustedResponse).filter((c) =>
      is(c, SAML_ASSERTION_NS, 'Assertion'),
    );
    if (
      inSignedResponse.length !== 1 ||
      attr(inSignedResponse[0], 'ID') !== attr(trustedAssertion, 'ID')
    ) {
      throw new SamlResponseError(
        'the signed Response holds a different Assertion',
        SIGNATURE_FAILED,
      );
    }
  }

  const checked = checkAssertion(trustedAssertion, exp, now);
  return {
    responseId: attr(presented.root, 'ID')!,
    ...checked,
    signed: { response: !!responseSignature, assertion: !!assertionSignature },
  };
}
