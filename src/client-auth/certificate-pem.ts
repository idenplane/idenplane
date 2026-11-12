import { X509Certificate } from 'node:crypto';
import { computeX5tS256 } from '../mtls/client-certificate.source.js';
import {
  certificateNames,
  formatRfc4514,
  parseDerName,
} from './distinguished-name.js';

/** An uploaded PEM that is not exactly one X.509 certificate. */
export class CertificatePemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CertificatePemError';
  }
}

const MAX_PEM_BYTES = 64 * 1024;
const BEGIN = '-----BEGIN ';
const END = '-----END ';
const DASHES = '-----';
const LABEL = /^[A-Z0-9 ]{1,64}$/;

interface PemBlock {
  label: string;
  body: string;
}

/**
 * Splits PEM text into its blocks with forward `indexOf` scans only, so the
 * cost stays linear in the input (a regular expression spanning the block
 * can backtrack badly on hostile input). Text outside a block, a BEGIN inside
 * a block, or an END that does not match its BEGIN is refused.
 */
function readPemBlocks(pem: string): PemBlock[] {
  const outside = () =>
    new CertificatePemError(
      'certificatePem has content outside the CERTIFICATE block',
    );
  const notClosed = () =>
    new CertificatePemError(
      'certificatePem has a PEM block that is not closed',
    );
  /** The label of a marker starting at `from`, and where the marker ends. */
  const readLabel = (from: number): { label: string; next: number } => {
    const close = pem.indexOf(DASHES, from);
    const label = close < 0 ? '' : pem.slice(from, close);
    if (!LABEL.test(label)) throw notClosed();
    return { label, next: close + DASHES.length };
  };

  const blocks: PemBlock[] = [];
  let pos = 0;
  for (;;) {
    const begin = pem.indexOf(BEGIN, pos);
    if (pem.slice(pos, begin < 0 ? pem.length : begin).trim() !== '') {
      throw outside();
    }
    if (begin < 0) return blocks;

    const opened = readLabel(begin + BEGIN.length);
    const end = pem.indexOf(END, opened.next);
    if (end < 0) throw notClosed();
    const body = pem.slice(opened.next, end);
    if (body.includes(BEGIN)) throw notClosed();

    const closed = readLabel(end + END.length);
    if (closed.label !== opened.label) {
      throw new CertificatePemError(
        'certificatePem has a PEM block whose END does not match its BEGIN',
      );
    }
    blocks.push({ label: opened.label, body });
    pos = closed.next;
  }
}

/**
 * Reads exactly one certificate from PEM text. Refuses a private key in any
 * form, more than one certificate, any other PEM block, and text outside the
 * block, so an upload can never store more than the one certificate it names.
 */
export function parseSingleCertificatePem(pem: unknown): X509Certificate {
  if (typeof pem !== 'string' || pem.trim() === '') {
    throw new CertificatePemError('certificatePem is required');
  }
  if (Buffer.byteLength(pem, 'utf8') > MAX_PEM_BYTES) {
    throw new CertificatePemError('certificatePem exceeds 64 KiB');
  }
  if (/PRIVATE KEY/i.test(pem)) {
    throw new CertificatePemError(
      'certificatePem contains a private key; upload the certificate only',
    );
  }
  const blocks = readPemBlocks(pem);
  if (blocks.length === 0) {
    throw new CertificatePemError(
      'certificatePem has no PEM CERTIFICATE block',
    );
  }
  if (blocks.length > 1) {
    throw new CertificatePemError(
      'certificatePem must contain exactly one certificate',
    );
  }
  const [block] = blocks;
  if (block.label !== 'CERTIFICATE') {
    throw new CertificatePemError(
      `certificatePem must be a CERTIFICATE block, got ${block.label}`,
    );
  }
  const body = block.body.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) {
    throw new CertificatePemError('certificatePem is not valid base64');
  }
  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(Buffer.from(body, 'base64'));
  } catch {
    throw new CertificatePemError('certificatePem is not an X.509 certificate');
  }
  return certificate;
}

/** The PEM of a certificate, normalised. */
export function toPem(certificate: X509Certificate): string {
  const lines = certificate.raw.toString('base64').match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

/**
 * A certificate serial number as stored and compared: lower-case hex, no
 * separators, no leading zeros. `undefined` when it is not hex.
 */
export function normalizeSerial(serial: string): string | undefined {
  const hex = serial.replace(/[\s:]/g, '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(hex) || hex.length > 128) return undefined;
  return hex.replace(/^0+(?=.)/, '');
}

/** What the admin API stores and shows about a certificate. */
export interface CertificateSummary {
  x5tS256: string;
  subject: string;
  issuer: string;
  serialNumber: string;
  notBefore: Date;
  notAfter: Date;
  pem: string;
}

export function summarizeCertificate(
  certificate: X509Certificate,
): CertificateSummary {
  const names = certificateNames(certificate.raw);
  return {
    x5tS256: computeX5tS256(certificate.raw),
    subject: formatRfc4514(parseDerName(names.subject)),
    issuer: formatRfc4514(parseDerName(names.issuer)),
    serialNumber: normalizeSerial(certificate.serialNumber) ?? '',
    notBefore: certificate.validFromDate,
    notAfter: certificate.validToDate,
    pem: toPem(certificate),
  };
}
