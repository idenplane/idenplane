/**
 * Strict parsing and signature verification of the SAML requests the IdP
 * receives (AuthnRequest, over the HTTP-Redirect and HTTP-POST bindings).
 *
 * Every field the IdP acts on is read from what the signature covers, never
 * from the document the signature was found in:
 *
 * - HTTP-POST (enveloped XML signature): exactly one ds:Signature, a direct
 *   child of the root, with one Reference to the root's ID; the fields are
 *   then read from the canonical bytes xml-crypto verified
 *   (`getSignedReferences()`), parsed again.
 * - HTTP-Redirect (SAML bindings §3.4.4.1): the signature is checked over
 *   the query-string octets exactly as received, `SAMLRequest`, `RelayState`
 *   and `SigAlg` in that order, and the request and RelayState are decoded
 *   from those same octets.
 *
 * Documents with a DTD, comments, processing instructions, CDATA, entity
 * references, duplicate ID attributes or unexpected elements are refused
 * before any of that, so no two parts of the code can disagree about which
 * element or which text they are looking at.
 */
import {
  createPublicKey,
  verify as cryptoVerify,
  type KeyObject,
} from 'crypto';
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';

export const SAML_PROTOCOL_NS = 'urn:oasis:names:tc:SAML:2.0:protocol';
export const SAML_ASSERTION_NS = 'urn:oasis:names:tc:SAML:2.0:assertion';
export const XMLDSIG_NS = 'http://www.w3.org/2000/09/xmldsig#';

/** Longest request ID accepted (and stored for the replay check). */
export const MAX_REQUEST_ID_LENGTH = 256;

/**
 * Signature algorithms accepted on requests, with the Node.js digest each
 * one uses. SHA-1 is not accepted: no per-SP legacy opt-in exists, and an SP
 * that can sign with RSA-SHA1 can sign with RSA-SHA256.
 */
export const ALLOWED_SIGNATURE_ALGORITHMS: Readonly<Record<string, string>> = {
  'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256': 'sha256',
  'http://www.w3.org/2001/04/xmldsig-more#rsa-sha512': 'sha512',
};

/** Digest algorithms accepted in an enveloped signature's Reference. */
export const ALLOWED_DIGEST_ALGORITHMS: ReadonlySet<string> = new Set([
  'http://www.w3.org/2001/04/xmlenc#sha256',
  'http://www.w3.org/2001/04/xmlenc#sha512',
]);

/** Canonicalization algorithms accepted (none of the #WithComments forms). */
export const ALLOWED_C14N_ALGORITHMS: ReadonlySet<string> = new Set([
  'http://www.w3.org/2001/10/xml-exc-c14n#',
  'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
]);

/** Reference transforms accepted: enveloped-signature and canonicalization. */
export const ALLOWED_TRANSFORMS: ReadonlySet<string> = new Set([
  'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
  ...ALLOWED_C14N_ALGORITHMS,
]);

/**
 * The children an AuthnRequest may have, in schema order, each at most
 * once (SAML core §3.4.1 and §3.2.1).
 */
const AUTHN_REQUEST_CHILDREN: ReadonlyArray<readonly [string, string]> = [
  [SAML_ASSERTION_NS, 'Issuer'],
  [XMLDSIG_NS, 'Signature'],
  [SAML_PROTOCOL_NS, 'Extensions'],
  [SAML_ASSERTION_NS, 'Subject'],
  [SAML_PROTOCOL_NS, 'NameIDPolicy'],
  [SAML_ASSERTION_NS, 'Conditions'],
  [SAML_PROTOCOL_NS, 'RequestedAuthnContext'],
  [SAML_PROTOCOL_NS, 'Scoping'],
];

/** The ID attribute names xml-crypto resolves a Reference URI against. */
const ID_ATTRIBUTE_NAMES: ReadonlySet<string> = new Set(['ID', 'Id', 'id']);

/** XML NCName (the type of a SAML ID), any Unicode letter allowed. */
export const NCNAME = /^[\p{L}_][\p{L}\p{N}\p{M}\p{Pc}.\-·]*$/u;

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_SECTION_NODE = 4;
const ENTITY_REFERENCE_NODE = 5;
const PROCESSING_INSTRUCTION_NODE = 7;
const COMMENT_NODE = 8;
const DOCUMENT_TYPE_NODE = 10;

/**
 * A request the IdP refuses. `reason` is logged; the client only sees
 * `publicMessage`, so it learns which check failed but not the details.
 */
export class SamlRequestError extends Error {
  constructor(
    readonly reason: string,
    readonly publicMessage = 'Invalid SAMLRequest',
  ) {
    super(reason);
    this.name = 'SamlRequestError';
  }
}

const SIGNATURE_FAILED = 'AuthnRequest signature validation failed';

/** A value from the request, quoted and cut short for a log line. */
export function q(value: string | null | undefined): string {
  return JSON.stringify(value ?? '').slice(0, 200);
}

/** The fields of an AuthnRequest, read from one element. */
export interface SamlAuthnRequest {
  id: string;
  issuer: string;
  /** As sent; checked by the caller (freshness), not here. */
  issueInstant: string | null;
  destination: string | null;
  acsUrl: string | null;
  protocolBinding: string | null;
  /** NameIDPolicy/@Format. */
  nameIdPolicy: string | null;
  forceAuthn: boolean;
  isPassive: boolean;
  requestedAuthnContext: {
    comparison: string | null;
    classRefs: string[];
  } | null;
}

/** A strictly parsed request, before any signature was checked. */
export interface ParsedSamlRequest {
  xml: string;
  root: Element;
  /** Read from the unsigned document: only good for finding the SP. */
  request: SamlAuthnRequest;
}

// ─── STRICT PARSING ─────────────────────────────────────

/**
 * Parses XML with every xmldom warning and error treated as fatal (xmldom
 * otherwise recovers and returns a partial document), and refuses anything
 * an AuthnRequest has no use for.
 */
export function parseStrictXml(xml: string): Document {
  // Refused before parsing: xmldom keeps a DTD as a node but never applies
  // it, so a DTD could only make two parsers read the document differently.
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new SamlRequestError('the document has a DTD');
  }
  const fail = (msg: unknown): never => {
    throw new SamlRequestError(
      `malformed XML: ${q(typeof msg === 'string' ? msg : 'parser error')}`,
    );
  };
  let doc: Document;
  try {
    doc = new DOMParser({
      errorHandler: { warning: fail, error: fail, fatalError: fail },
    }).parseFromString(xml, 'text/xml');
  } catch (err) {
    if (err instanceof SamlRequestError) throw err;
    throw new SamlRequestError(`malformed XML: ${q((err as Error).message)}`);
  }
  checkDocumentStructure(doc);
  return doc;
}

/**
 * One root element; nothing else at the top but the XML declaration; no
 * DTD, comment, processing instruction, CDATA or entity reference anywhere;
 * no ID value used twice.
 */
function checkDocumentStructure(doc: Document): void {
  let elements = 0;
  for (const node of Array.from(doc.childNodes)) {
    if (node.nodeType === ELEMENT_NODE) {
      elements++;
    } else if (
      node.nodeType === PROCESSING_INSTRUCTION_NODE &&
      (node as ProcessingInstruction).target.toLowerCase() === 'xml'
    ) {
      // xmldom keeps the XML declaration as a processing instruction.
    } else if (node.nodeType === TEXT_NODE && !node.nodeValue?.trim()) {
      // Whitespace around the root.
    } else {
      throw new SamlRequestError(
        `unexpected node (type ${node.nodeType}) outside the root element`,
      );
    }
  }
  if (elements !== 1 || !doc.documentElement) {
    throw new SamlRequestError('the document must have exactly one root');
  }

  // The document level was checked above; now the root element and below.
  const ids = new Set<string>();
  const walk = (nodes: ArrayLike<Node>): void => {
    for (const child of Array.from(nodes)) {
      switch (child.nodeType) {
        case ELEMENT_NODE: {
          const el = child as Element;
          for (const attr of Array.from(el.attributes)) {
            if (!ID_ATTRIBUTE_NAMES.has(attr.localName ?? attr.name)) continue;
            if (ids.has(attr.value)) {
              throw new SamlRequestError(
                `ID ${q(attr.value)} is used more than once`,
              );
            }
            ids.add(attr.value);
          }
          walk(el.childNodes);
          break;
        }
        case TEXT_NODE:
          break;
        case COMMENT_NODE:
          throw new SamlRequestError('the document contains a comment');
        case PROCESSING_INSTRUCTION_NODE:
          throw new SamlRequestError(
            'the document contains a processing instruction',
          );
        case CDATA_SECTION_NODE:
          throw new SamlRequestError('the document contains a CDATA section');
        case ENTITY_REFERENCE_NODE:
        case DOCUMENT_TYPE_NODE:
          throw new SamlRequestError('the document has a DTD');
        default:
          throw new SamlRequestError(`unexpected node type ${child.nodeType}`);
      }
    }
  };
  walk([doc.documentElement]);
}

/** Parses a decoded SAMLRequest and reads its AuthnRequest, unverified. */
export function parseAuthnRequest(xml: string): ParsedSamlRequest {
  const doc = parseStrictXml(xml);
  const root = doc.documentElement;
  return { xml, root, request: extractAuthnRequest(root) };
}

// ─── FIELD EXTRACTION ───────────────────────────────────

export function childElements(el: Element): Element[] {
  return Array.from(el.childNodes).filter(
    (n): n is Element => n.nodeType === ELEMENT_NODE,
  );
}

export function is(el: Element, ns: string, localName: string): boolean {
  return el.namespaceURI === ns && el.localName === localName;
}

/** The text of an element that may hold only text. */
export function textOf(el: Element, what: string): string {
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType !== TEXT_NODE) {
      throw new SamlRequestError(`${what} must contain text only`);
    }
  }
  return (el.textContent ?? '').trim();
}

export function attr(el: Element, name: string): string | null {
  return el.hasAttribute(name) ? el.getAttribute(name) : null;
}

function xsBoolean(el: Element, name: string): boolean {
  const value = attr(el, name);
  if (value === null || value === 'false' || value === '0') return false;
  if (value === 'true' || value === '1') return true;
  throw new SamlRequestError(`${name} is not a boolean`);
}

/**
 * Reads an AuthnRequest from its root element. The element's children
 * must follow the schema (each known child at most once, nothing else), so
 * there is exactly one Issuer, NameIDPolicy and so on to read.
 */
export function extractAuthnRequest(root: Element): SamlAuthnRequest {
  if (!is(root, SAML_PROTOCOL_NS, 'AuthnRequest')) {
    throw new SamlRequestError(
      'the root element is not a samlp:AuthnRequest',
      'Invalid AuthnRequest: root element not found',
    );
  }
  const version = attr(root, 'Version');
  if (version !== null && version !== '2.0') {
    throw new SamlRequestError(`unsupported SAML version ${q(version)}`);
  }

  const found = new Map<string, Element>();
  let lastIndex = -1;
  for (const child of childElements(root)) {
    const index = AUTHN_REQUEST_CHILDREN.findIndex(([ns, name]) =>
      is(child, ns, name),
    );
    if (index < 0) {
      throw new SamlRequestError(
        `unexpected element ${q(`{${child.namespaceURI ?? ''}}${child.localName}`)} in AuthnRequest`,
      );
    }
    if (index <= lastIndex) {
      throw new SamlRequestError(
        `${q(child.localName)} is repeated or out of order in AuthnRequest`,
      );
    }
    lastIndex = index;
    found.set(child.localName, child);
  }

  const issuerEl = found.get('Issuer');
  const issuer = issuerEl ? textOf(issuerEl, 'Issuer') : '';
  if (!issuer) {
    throw new SamlRequestError(
      'AuthnRequest has no Issuer',
      'AuthnRequest missing Issuer',
    );
  }

  const id = attr(root, 'ID') ?? '';
  if (!id) {
    throw new SamlRequestError(
      'AuthnRequest has no ID',
      'AuthnRequest missing ID',
    );
  }
  if (id.length > MAX_REQUEST_ID_LENGTH || !NCNAME.test(id)) {
    throw new SamlRequestError('AuthnRequest ID is not a valid xs:ID');
  }

  const nameIdPolicyEl = found.get('NameIDPolicy');
  if (nameIdPolicyEl && childElements(nameIdPolicyEl).length > 0) {
    throw new SamlRequestError('NameIDPolicy must be empty');
  }

  let requestedAuthnContext: SamlAuthnRequest['requestedAuthnContext'] = null;
  const racEl = found.get('RequestedAuthnContext');
  if (racEl) {
    const classRefs: string[] = [];
    for (const child of childElements(racEl)) {
      if (is(child, SAML_ASSERTION_NS, 'AuthnContextClassRef')) {
        classRefs.push(textOf(child, 'AuthnContextClassRef'));
      } else if (!is(child, SAML_ASSERTION_NS, 'AuthnContextDeclRef')) {
        throw new SamlRequestError(
          `unexpected element ${q(child.localName)} in RequestedAuthnContext`,
        );
      }
    }
    requestedAuthnContext = {
      comparison: attr(racEl, 'Comparison'),
      classRefs,
    };
  }

  return {
    id,
    issuer,
    issueInstant: attr(root, 'IssueInstant'),
    destination: attr(root, 'Destination'),
    acsUrl: attr(root, 'AssertionConsumerServiceURL'),
    protocolBinding: attr(root, 'ProtocolBinding'),
    nameIdPolicy: nameIdPolicyEl ? attr(nameIdPolicyEl, 'Format') : null,
    forceAuthn: xsBoolean(root, 'ForceAuthn'),
    isPassive: xsBoolean(root, 'IsPassive'),
    requestedAuthnContext,
  };
}

// ─── KEYS ───────────────────────────────────────────────

/**
 * The key a service provider's registered certificate verifies with. The
 * field holds an X.509 certificate in PEM, the certificate's bare base64
 * body (as copied out of SP metadata) or a PEM public key.
 */
export function spVerificationKey(certificate: string): KeyObject {
  const trimmed = certificate.trim();
  const pem = trimmed.includes('-----BEGIN')
    ? trimmed
    : `-----BEGIN CERTIFICATE-----\n${(
        trimmed.replace(/\s+/g, '').match(/.{1,64}/g) ?? []
      ).join('\n')}\n-----END CERTIFICATE-----\n`;
  try {
    return createPublicKey(pem);
  } catch (err) {
    throw new SamlRequestError(
      `the service provider's certificate cannot be read: ${(err as Error).message}`,
      SIGNATURE_FAILED,
    );
  }
}

// ─── HTTP-POST: ENVELOPED XML SIGNATURE ─────────────────

function onlyChild(parent: Element, ns: string, name: string): Element {
  const matches = childElements(parent).filter((c) => is(c, ns, name));
  if (matches.length !== 1) {
    throw new SamlRequestError(
      `expected exactly one ${name} in ${parent.localName}`,
      SIGNATURE_FAILED,
    );
  }
  return matches[0];
}

function algorithmOf(el: Element): string {
  return el.getAttribute('Algorithm') ?? '';
}

/**
 * Checks the shape of the request's enveloped signature before xml-crypto
 * sees it: one Signature, on the root, with one Reference to the root, and
 * only allowed algorithms.
 */
function checkEnvelopedSignatureShape(root: Element): Element {
  const doc = root.ownerDocument;
  const signatures = Array.from(
    doc.getElementsByTagNameNS(XMLDSIG_NS, 'Signature'),
  );
  if (signatures.length === 0) {
    throw new SamlRequestError(
      'the request has no signature',
      'AuthnRequest is not signed',
    );
  }
  if (signatures.length > 1) {
    throw new SamlRequestError(
      `the request has ${signatures.length} signatures`,
      SIGNATURE_FAILED,
    );
  }
  const signature = signatures[0];
  if (signature.parentNode !== root) {
    throw new SamlRequestError(
      'the signature is not a child of the root element',
      SIGNATURE_FAILED,
    );
  }
  for (const child of childElements(signature)) {
    if (
      !is(child, XMLDSIG_NS, 'SignedInfo') &&
      !is(child, XMLDSIG_NS, 'SignatureValue') &&
      !is(child, XMLDSIG_NS, 'KeyInfo')
    ) {
      throw new SamlRequestError(
        `unexpected element ${q(child.localName)} in Signature`,
        SIGNATURE_FAILED,
      );
    }
  }

  const signedInfo = onlyChild(signature, XMLDSIG_NS, 'SignedInfo');
  onlyChild(signature, XMLDSIG_NS, 'SignatureValue');
  const c14n = algorithmOf(
    onlyChild(signedInfo, XMLDSIG_NS, 'CanonicalizationMethod'),
  );
  if (!ALLOWED_C14N_ALGORITHMS.has(c14n)) {
    throw new SamlRequestError(
      `canonicalization ${q(c14n)} is not allowed`,
      SIGNATURE_FAILED,
    );
  }
  const sigAlg = algorithmOf(
    onlyChild(signedInfo, XMLDSIG_NS, 'SignatureMethod'),
  );
  if (!(sigAlg in ALLOWED_SIGNATURE_ALGORITHMS)) {
    throw new SamlRequestError(
      `signature algorithm ${q(sigAlg)} is not allowed`,
      SIGNATURE_FAILED,
    );
  }

  const reference = onlyChild(signedInfo, XMLDSIG_NS, 'Reference');
  const rootId = root.getAttribute('ID') ?? '';
  const uri = reference.getAttribute('URI');
  if (!rootId || uri !== `#${rootId}`) {
    throw new SamlRequestError(
      `the signature references ${q(uri)}, not the root element`,
      SIGNATURE_FAILED,
    );
  }
  const digest = algorithmOf(onlyChild(reference, XMLDSIG_NS, 'DigestMethod'));
  if (!ALLOWED_DIGEST_ALGORITHMS.has(digest)) {
    throw new SamlRequestError(
      `digest algorithm ${q(digest)} is not allowed`,
      SIGNATURE_FAILED,
    );
  }
  const transforms = childElements(reference).filter((c) =>
    is(c, XMLDSIG_NS, 'Transforms'),
  );
  if (transforms.length > 1) {
    throw new SamlRequestError('more than one Transforms', SIGNATURE_FAILED);
  }
  for (const transform of transforms.length
    ? childElements(transforms[0])
    : []) {
    if (
      !is(transform, XMLDSIG_NS, 'Transform') ||
      !ALLOWED_TRANSFORMS.has(algorithmOf(transform))
    ) {
      throw new SamlRequestError(
        `transform ${q(algorithmOf(transform))} is not allowed`,
        SIGNATURE_FAILED,
      );
    }
  }
  return signature;
}

/** The entries of an algorithm registry that are on an allow-list. */
export function pick<K extends string, T>(
  all: Record<K, T>,
  allowed: Iterable<string>,
): Record<K, T> {
  const out: Partial<Record<K, T>> = {};
  for (const name of allowed) {
    if (name in all) out[name as K] = all[name as K];
  }
  return out as Record<K, T>;
}

/**
 * Verifies the enveloped signature of an HTTP-POST AuthnRequest with the
 * service provider's key, and returns the AuthnRequest read from the bytes
 * the signature covers.
 */
export function verifyEnvelopedSignature(
  parsed: ParsedSamlRequest,
  key: KeyObject,
): SamlAuthnRequest {
  const signature = checkEnvelopedSignatureShape(parsed.root);

  const sig = new SignedXml({
    publicCert: key,
    // Only the registered certificate counts, never one the request carries.
    getCertFromKeyInfo: () => null,
  });
  // Defence in depth: xml-crypto itself knows only the allowed algorithms.
  sig.SignatureAlgorithms = pick(
    sig.SignatureAlgorithms,
    Object.keys(ALLOWED_SIGNATURE_ALGORITHMS),
  );
  sig.HashAlgorithms = pick(sig.HashAlgorithms, ALLOWED_DIGEST_ALGORITHMS);
  sig.CanonicalizationAlgorithms = pick(
    sig.CanonicalizationAlgorithms,
    ALLOWED_TRANSFORMS,
  );

  let valid: boolean;
  try {
    sig.loadSignature(signature);
    valid = sig.checkSignature(parsed.xml);
  } catch (err) {
    throw new SamlRequestError(
      `signature check failed: ${(err as Error).message}`,
      SIGNATURE_FAILED,
    );
  }
  if (!valid) {
    throw new SamlRequestError('the signature is not valid', SIGNATURE_FAILED);
  }

  const signed = sig.getSignedReferences();
  if (signed.length !== 1) {
    throw new SamlRequestError(
      `the signature covers ${signed.length} references`,
      SIGNATURE_FAILED,
    );
  }
  // From here on, only the signed bytes are read.
  const signedRoot = parseStrictXml(signed[0]).documentElement;
  const request = extractAuthnRequest(signedRoot);
  if (request.id !== parsed.request.id) {
    throw new SamlRequestError(
      'the signed element is not the request root',
      SIGNATURE_FAILED,
    );
  }
  return request;
}

// ─── HTTP-REDIRECT: QUERY-STRING SIGNATURE ──────────────

/** The SAML parameters of a Redirect-binding query string. */
export interface RedirectQuery {
  /** Values exactly as received, still URL-encoded. */
  raw: {
    SAMLRequest?: string;
    RelayState?: string;
    SigAlg?: string;
    Signature?: string;
  };
  samlRequest?: string;
  relayState?: string;
  sigAlg?: string;
  signature?: string;
}

const REDIRECT_PARAMS = ['SAMLRequest', 'RelayState', 'SigAlg', 'Signature'];

/** Decodes an application/x-www-form-urlencoded value as Express does. */
function formDecode(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    throw new SamlRequestError('the query string is not URL-encoded');
  }
}

/**
 * Splits a raw query string (the part after `?`) into the SAML parameters,
 * keeping each value as received for the signature check. A parameter that
 * appears twice is refused: which copy was signed would be ambiguous.
 */
export function parseRedirectQuery(rawQuery: string): RedirectQuery {
  const raw: RedirectQuery['raw'] = {};
  for (const part of rawQuery.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const name = formDecode(eq < 0 ? part : part.slice(0, eq));
    if (!REDIRECT_PARAMS.includes(name)) continue;
    const key = name as keyof RedirectQuery['raw'];
    if (raw[key] !== undefined) {
      throw new SamlRequestError(`${q(name)} appears more than once`);
    }
    raw[key] = eq < 0 ? '' : part.slice(eq + 1);
  }
  const decoded = (v: string | undefined) =>
    v === undefined ? undefined : formDecode(v);
  return {
    raw,
    samlRequest: decoded(raw.SAMLRequest),
    relayState: decoded(raw.RelayState),
    sigAlg: decoded(raw.SigAlg),
    signature: decoded(raw.Signature),
  };
}

/**
 * Verifies a Redirect-binding signature (SAML bindings §3.4.4.1) over the
 * octets `SAMLRequest=…&RelayState=…&SigAlg=…` built from the values as
 * received, not re-encoded.
 */
export function verifyRedirectSignature(
  query: RedirectQuery,
  key: KeyObject,
): void {
  const { raw } = query;
  if (raw.Signature === undefined || raw.SigAlg === undefined) {
    throw new SamlRequestError(
      'the request has no query-string signature',
      'AuthnRequest is not signed',
    );
  }
  const digest = ALLOWED_SIGNATURE_ALGORITHMS[query.sigAlg ?? ''];
  if (!digest) {
    throw new SamlRequestError(
      `signature algorithm ${q(query.sigAlg)} is not allowed`,
      SIGNATURE_FAILED,
    );
  }
  let octets = `SAMLRequest=${raw.SAMLRequest ?? ''}`;
  if (raw.RelayState !== undefined) octets += `&RelayState=${raw.RelayState}`;
  octets += `&SigAlg=${raw.SigAlg}`;

  const signature = Buffer.from(query.signature ?? '', 'base64');
  let valid: boolean;
  try {
    valid =
      signature.length > 0 &&
      cryptoVerify(digest, Buffer.from(octets, 'utf-8'), key, signature);
  } catch (err) {
    throw new SamlRequestError(
      `signature check failed: ${(err as Error).message}`,
      SIGNATURE_FAILED,
    );
  }
  if (!valid) {
    throw new SamlRequestError('the signature is not valid', SIGNATURE_FAILED);
  }
}

/**
 * In the Redirect binding the signature travels in the query string and any
 * XML signature must be removed (bindings §3.4.4.1). One that is still there
 * is refused, so nothing can mistake it for the signature that was checked.
 */
export function assertNoXmlSignature(root: Element): void {
  if (
    root.ownerDocument.getElementsByTagNameNS(XMLDSIG_NS, 'Signature').length
  ) {
    throw new SamlRequestError(
      'a Redirect-binding request carries an XML signature',
    );
  }
}
