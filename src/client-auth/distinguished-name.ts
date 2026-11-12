/**
 * X.500 distinguished names for RFC 8705 `tls_client_auth`: read from a
 * certificate's DER, or from the RFC 4514 string a client is registered
 * with, and compared as parsed RDNs rather than as text.
 *
 * Comparison follows RFC 5280 §7.1: the same number of RDNs in the same
 * order, each RDN the same set of attributes, attribute types by OID, and
 * string values compared case-insensitively after Unicode NFKC and
 * insignificant-space folding. A value that is not a character string is
 * compared by its DER encoding.
 */

/** A DER/RFC 4514 input that is not a well-formed distinguished name. */
export class DistinguishedNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DistinguishedNameError';
  }
}

/** A character string, or the DER of a value of any other type. */
export type AttributeValue = { text: string } | { der: Buffer };

export interface DnAttribute {
  /** Dotted OID of the attribute type. */
  oid: string;
  value: AttributeValue;
}

/**
 * A distinguished name in RDNSequence (DER) order: the most significant RDN
 * (e.g. `C`) first. RFC 4514 strings list them the other way round.
 */
export type DistinguishedName = DnAttribute[][];

// RFC 4514 §3 names, plus the ones OpenSSL and common CAs print.
const NAME_TO_OID: Record<string, string> = {
  CN: '2.5.4.3',
  COMMONNAME: '2.5.4.3',
  L: '2.5.4.7',
  LOCALITYNAME: '2.5.4.7',
  ST: '2.5.4.8',
  STATEORPROVINCENAME: '2.5.4.8',
  O: '2.5.4.10',
  ORGANIZATIONNAME: '2.5.4.10',
  OU: '2.5.4.11',
  ORGANIZATIONALUNITNAME: '2.5.4.11',
  C: '2.5.4.6',
  COUNTRYNAME: '2.5.4.6',
  STREET: '2.5.4.9',
  STREETADDRESS: '2.5.4.9',
  DC: '0.9.2342.19200300.100.1.25',
  DOMAINCOMPONENT: '0.9.2342.19200300.100.1.25',
  UID: '0.9.2342.19200300.100.1.1',
  USERID: '0.9.2342.19200300.100.1.1',
  SERIALNUMBER: '2.5.4.5',
  SN: '2.5.4.4',
  SURNAME: '2.5.4.4',
  GN: '2.5.4.42',
  GIVENNAME: '2.5.4.42',
  T: '2.5.4.12',
  TITLE: '2.5.4.12',
  INITIALS: '2.5.4.43',
  GENERATIONQUALIFIER: '2.5.4.44',
  DNQUALIFIER: '2.5.4.46',
  PSEUDONYM: '2.5.4.65',
  POSTALCODE: '2.5.4.17',
  BUSINESSCATEGORY: '2.5.4.15',
  ORGANIZATIONIDENTIFIER: '2.5.4.97',
  E: '1.2.840.113549.1.9.1',
  EMAILADDRESS: '1.2.840.113549.1.9.1',
};

/** The short name printed for an OID, when it has one. */
const OID_TO_NAME: Record<string, string> = {
  '2.5.4.3': 'CN',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
  '2.5.4.6': 'C',
  '2.5.4.9': 'STREET',
  '0.9.2342.19200300.100.1.25': 'DC',
  '0.9.2342.19200300.100.1.1': 'UID',
  '2.5.4.5': 'serialNumber',
  '2.5.4.4': 'SN',
  '2.5.4.42': 'GN',
  '2.5.4.12': 'title',
  '1.2.840.113549.1.9.1': 'emailAddress',
};

const MAX_DN_STRING_LENGTH = 4096;

// ─── DER ─────────────────────────────────────────────────────────────────────

/** One DER TLV: its tag, its contents, and where it ends. */
export interface Tlv {
  tag: number;
  /** Offset of the tag byte. */
  start: number;
  /** Offset of the first content byte. */
  contentStart: number;
  /** Offset just past the contents. */
  end: number;
}

/**
 * Reads the DER TLV at `offset`. Only definite lengths and single-byte tags,
 * which is all an X.509 name or certificate header needs.
 */
export function readTlv(der: Buffer, offset: number, limit = der.length): Tlv {
  if (offset + 2 > limit) throw new DistinguishedNameError('truncated DER');
  const tag = der[offset];
  if ((tag & 0x1f) === 0x1f) {
    throw new DistinguishedNameError('unsupported multi-byte DER tag');
  }
  let length = der[offset + 1];
  let contentStart = offset + 2;
  if (length & 0x80) {
    const bytes = length & 0x7f;
    if (bytes === 0 || bytes > 4) {
      throw new DistinguishedNameError('unsupported DER length');
    }
    if (contentStart + bytes > limit) {
      throw new DistinguishedNameError('truncated DER');
    }
    length = 0;
    for (let i = 0; i < bytes; i++)
      length = length * 256 + der[contentStart + i];
    contentStart += bytes;
  }
  const end = contentStart + length;
  if (end > limit) throw new DistinguishedNameError('truncated DER');
  return { tag, start: offset, contentStart, end };
}

/** The children of a constructed TLV. */
function children(der: Buffer, parent: Tlv): Tlv[] {
  const items: Tlv[] = [];
  let offset = parent.contentStart;
  while (offset < parent.end) {
    const item = readTlv(der, offset, parent.end);
    items.push(item);
    offset = item.end;
  }
  return items;
}

function decodeOid(bytes: Buffer): string {
  if (bytes.length === 0) throw new DistinguishedNameError('empty OID');
  const arcs: number[] = [];
  let value = 0;
  for (let i = 0; i < bytes.length; i++) {
    value = value * 128 + (bytes[i] & 0x7f);
    if (value > Number.MAX_SAFE_INTEGER / 128) {
      throw new DistinguishedNameError('OID arc too large');
    }
    if (!(bytes[i] & 0x80)) {
      arcs.push(value);
      value = 0;
    } else if (i === bytes.length - 1) {
      throw new DistinguishedNameError('truncated OID');
    }
  }
  const first = arcs[0];
  const head =
    first < 40 ? [0, first] : first < 80 ? [1, first - 40] : [2, first - 80];
  return [...head, ...arcs.slice(1)].join('.');
}

const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true });

/** The text of a character-string value, or `undefined` for any other type. */
function decodeString(tag: number, bytes: Buffer): string | undefined {
  switch (tag) {
    case 0x0c: // UTF8String
      try {
        return STRICT_UTF8.decode(bytes);
      } catch {
        throw new DistinguishedNameError('invalid UTF8String');
      }
    case 0x12: // NumericString
    case 0x13: // PrintableString
    case 0x16: // IA5String
    case 0x1a: // VisibleString
    case 0x14: // TeletexString (read as Latin-1, as OpenSSL does)
      return bytes.toString('latin1');
    case 0x1e: {
      // BMPString: UTF-16BE
      if (bytes.length % 2)
        throw new DistinguishedNameError('invalid BMPString');
      const swapped = Buffer.from(bytes);
      swapped.swap16();
      return swapped.toString('utf16le');
    }
    case 0x1c: {
      // UniversalString: UTF-32BE
      if (bytes.length % 4) {
        throw new DistinguishedNameError('invalid UniversalString');
      }
      let text = '';
      for (let i = 0; i < bytes.length; i += 4) {
        const codePoint = bytes.readUInt32BE(i);
        if (codePoint > 0x10ffff) {
          throw new DistinguishedNameError('invalid UniversalString');
        }
        text += String.fromCodePoint(codePoint);
      }
      return text;
    }
    default:
      return undefined;
  }
}

/** An attribute value from its full DER TLV. */
function valueFromDer(der: Buffer): AttributeValue {
  const tlv = readTlv(der, 0);
  if (tlv.end !== der.length) {
    throw new DistinguishedNameError('trailing bytes after attribute value');
  }
  const text = decodeString(tlv.tag, der.subarray(tlv.contentStart, tlv.end));
  return text === undefined ? { der: Buffer.from(der) } : { text };
}

/** Parses a DER `Name` (RFC 5280 §4.1.2.4). */
export function parseDerName(der: Buffer): DistinguishedName {
  const root = readTlv(der, 0);
  if (root.tag !== 0x30 || root.end !== der.length) {
    throw new DistinguishedNameError('Name is not a DER SEQUENCE');
  }
  return children(der, root).map((set) => {
    if (set.tag !== 0x31) throw new DistinguishedNameError('RDN is not a SET');
    const attributes = children(der, set).map((pair) => {
      const [type, value, ...rest] = children(der, pair);
      if (pair.tag !== 0x30 || !type || !value || rest.length > 0) {
        throw new DistinguishedNameError('malformed AttributeTypeAndValue');
      }
      if (type.tag !== 0x06) throw new DistinguishedNameError('missing OID');
      return {
        oid: decodeOid(der.subarray(type.contentStart, type.end)),
        value: valueFromDer(der.subarray(value.start, value.end)),
      };
    });
    if (attributes.length === 0) throw new DistinguishedNameError('empty RDN');
    return attributes;
  });
}

/** The DER of a certificate's issuer and subject names. */
export function certificateNames(certificateDer: Buffer): {
  issuer: Buffer;
  subject: Buffer;
} {
  try {
    const certificate = readTlv(certificateDer, 0);
    const [tbs] = children(certificateDer, certificate);
    if (certificate.tag !== 0x30 || tbs?.tag !== 0x30) {
      throw new DistinguishedNameError('not a certificate');
    }
    const fields = children(certificateDer, tbs);
    // [0] version is optional; then serial, signature, issuer, validity, subject.
    const at = fields[0]?.tag === 0xa0 ? 1 : 0;
    const issuer = fields[at + 2];
    const subject = fields[at + 4];
    if (issuer?.tag !== 0x30 || subject?.tag !== 0x30) {
      throw new DistinguishedNameError('not a certificate');
    }
    return {
      issuer: certificateDer.subarray(issuer.start, issuer.end),
      subject: certificateDer.subarray(subject.start, subject.end),
    };
  } catch (err) {
    if (err instanceof DistinguishedNameError) throw err;
    throw new DistinguishedNameError('not a certificate');
  }
}

// ─── RFC 4514 strings ────────────────────────────────────────────────────────

const HEX = /^[0-9a-fA-F]$/;
const DESCR = /^[A-Za-z][A-Za-z0-9-]*$/;
const NUMERIC_OID = /^(0|[1-9]\d*)(\.(0|[1-9]\d*))+$/;

function attributeOid(type: string): string {
  const trimmed = type.trim();
  if (NUMERIC_OID.test(trimmed)) return trimmed;
  if (/^oid\./i.test(trimmed) && NUMERIC_OID.test(trimmed.slice(4))) {
    return trimmed.slice(4);
  }
  if (!DESCR.test(trimmed)) {
    throw new DistinguishedNameError(`invalid attribute type "${trimmed}"`);
  }
  const oid = NAME_TO_OID[trimmed.toUpperCase()];
  if (!oid) {
    throw new DistinguishedNameError(
      `unknown attribute type "${trimmed}"; use its numeric OID`,
    );
  }
  return oid;
}

/**
 * Parses an RFC 4514 string (`CN=device-1,O=Example\, Inc.,C=US`). Spaces
 * around `,`, `+` and `=` are tolerated, as most tools print them.
 * Throws {@link DistinguishedNameError}.
 */
export function parseRfc4514(input: string): DistinguishedName {
  if (input.length > MAX_DN_STRING_LENGTH) {
    throw new DistinguishedNameError('distinguished name is too long');
  }
  const rdns: DnAttribute[][] = [];
  let current: DnAttribute[] = [];
  let i = 0;
  const n = input.length;
  if (input.trim() === '') return [];

  for (;;) {
    // attributeType '='
    const eq = input.indexOf('=', i);
    if (eq === -1) throw new DistinguishedNameError('expected "type=value"');
    const oid = attributeOid(input.slice(i, eq));
    i = eq + 1;
    while (i < n && input[i] === ' ') i++;

    let value: AttributeValue;
    if (input[i] === '#') {
      // hexstring: the BER encoding of the value.
      let j = i + 1;
      while (j < n && HEX.test(input[j])) j++;
      const hex = input.slice(i + 1, j);
      if (hex.length === 0 || hex.length % 2) {
        throw new DistinguishedNameError('invalid #hex value');
      }
      value = valueFromDer(Buffer.from(hex, 'hex'));
      i = j;
      while (i < n && input[i] === ' ') i++;
    } else {
      const bytes: number[] = [];
      let lastSignificant = 0; // bytes.length after the last non-space or escaped char
      while (i < n && input[i] !== ',' && input[i] !== '+') {
        const ch = input[i];
        if (ch === '\\') {
          const next = input[i + 1];
          if (next === undefined) {
            throw new DistinguishedNameError('dangling escape');
          }
          if (HEX.test(next) && HEX.test(input[i + 2] ?? '')) {
            bytes.push(parseInt(input.slice(i + 1, i + 3), 16));
            i += 3;
          } else if ('"+,;<>\\=# '.includes(next)) {
            bytes.push(next.charCodeAt(0));
            i += 2;
          } else {
            throw new DistinguishedNameError(`invalid escape "\\${next}"`);
          }
          lastSignificant = bytes.length;
          continue;
        }
        if ('";<>\0'.includes(ch)) {
          throw new DistinguishedNameError(`"${ch}" must be escaped`);
        }
        // One code point at a time, so a surrogate pair stays one character.
        const character = String.fromCodePoint(input.codePointAt(i)!);
        bytes.push(...Buffer.from(character, 'utf8'));
        i += character.length;
        if (ch !== ' ') lastSignificant = bytes.length;
      }
      let text: string;
      try {
        text = STRICT_UTF8.decode(Buffer.from(bytes.slice(0, lastSignificant)));
      } catch {
        throw new DistinguishedNameError('value is not valid UTF-8');
      }
      value = { text };
    }
    current.push({ oid, value });

    if (i >= n) break;
    const separator = input[i];
    i++;
    while (i < n && input[i] === ' ') i++;
    if (separator === ',') {
      rdns.push(current);
      current = [];
    } else if (separator !== '+') {
      throw new DistinguishedNameError(`unexpected "${separator}"`);
    }
    if (i >= n) throw new DistinguishedNameError('trailing separator');
  }
  rdns.push(current);
  // RFC 4514 lists the RDNs last-to-first.
  return rdns.reverse();
}

// ─── Canonical form ──────────────────────────────────────────────────────────

/** RFC 4518-style folding for case-insensitive string matching. */
function foldText(text: string): string {
  return text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Escapes a control character as `\XX`. */
function escapeControl(c: string): string {
  const code = c.charCodeAt(0);
  return code < 0x20 ? `\\${code.toString(16).padStart(2, '0')}` : c;
}

function escapeValue(text: string): string {
  return [
    ...text
      .replace(/[\\"+,;<>=]/g, (c) => `\\${c}`)
      .replace(/^([ #])/, '\\$1')
      .replace(/ $/, '\\ '),
  ]
    .map(escapeControl)
    .join('');
}

function canonicalAttribute(attribute: DnAttribute): string {
  const value =
    'text' in attribute.value
      ? escapeValue(foldText(attribute.value.text))
      : `#${attribute.value.der.toString('hex')}`;
  return `${attribute.oid}=${value}`;
}

/**
 * A string two names share exactly when they match under RFC 5280 §7.1:
 * RFC 4514 order, OIDs for types, folded values, each RDN's attributes
 * sorted. Stored as the deny-list issuer and used for every comparison.
 */
export function canonicalDn(name: DistinguishedName): string {
  return [...name]
    .reverse()
    .map((rdn) => rdn.map(canonicalAttribute).sort().join('+'))
    .join(',');
}

/** True when the two names match (RFC 5280 §7.1). */
export function dnEquals(a: DistinguishedName, b: DistinguishedName): boolean {
  return canonicalDn(a) === canonicalDn(b);
}

/** A readable RFC 4514 string, short names where known; for display. */
export function formatRfc4514(name: DistinguishedName): string {
  return [...name]
    .reverse()
    .map((rdn) =>
      rdn
        .map((attribute) => {
          const type = OID_TO_NAME[attribute.oid] ?? attribute.oid;
          const value =
            'text' in attribute.value
              ? escapeValue(attribute.value.text)
              : `#${attribute.value.der.toString('hex')}`;
          return `${type}=${value}`;
        })
        .join('+'),
    )
    .join(',');
}
