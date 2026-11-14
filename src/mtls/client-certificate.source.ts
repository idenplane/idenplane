import { Inject, Injectable, HttpStatus } from '@nestjs/common';
import { createHash, X509Certificate } from 'node:crypto';
import { TLSSocket, type DetailedPeerCertificate } from 'node:tls';
import type { IncomingMessage } from 'node:http';
import { OAuthTokenError } from '../auth/oauth-token-error.js';
import {
  MTLS_CONFIG,
  type MtlsConfig,
  type MtlsProxyConfig,
} from './mtls-config.js';

/** A certificate the client presented, before anything decides to trust it. */
export interface PresentedClientCertificate {
  /** Where it came from: the TLS handshake, or a trusted proxy's header. */
  source: 'tls' | 'proxy-header';
  certificate: X509Certificate;
  der: Buffer;
  /** RFC 8705 §3.1 `x5t#S256`: base64url SHA-256 of the DER, no padding. */
  x5tS256: string;
  /** Intermediates the client sent, leaf excluded, nearest issuer first. */
  chain: X509Certificate[];
  /**
   * Whether Node's own handshake verification passed (`socket.authorized`).
   * Recorded for logs only: trust is decided per realm, never by this flag.
   */
  tlsAuthorized?: boolean;
}

/** base64url(SHA-256(DER)) without padding, the RFC 8705 `x5t#S256`. */
export function computeX5tS256(der: Buffer | Uint8Array): string {
  return createHash('sha256').update(der).digest('base64url');
}

/** Minimal request shape, so the source works for Express and raw Node requests. */
export type CertificateRequest = Pick<IncomingMessage, 'headers' | 'socket'> & {
  headersDistinct?: Record<string, string[] | undefined>;
  rawHeaders?: string[];
};

/** The header a trusted proxy sent was not one certificate in the agreed format. */
export class InvalidClientCertificateHeaderError extends OAuthTokenError {
  constructor(detail: string) {
    super(
      'invalid_request',
      `Invalid client certificate header: ${detail}`,
      HttpStatus.BAD_REQUEST,
    );
  }
}

const PEM_BEGIN = '-----BEGIN CERTIFICATE-----';
const PEM_END = '-----END CERTIFICATE-----';
const PEM_BODY = /^[A-Za-z0-9+/]+={0,2}$/;
const RFC9440_ITEM = /^:([A-Za-z0-9+/]+={0,2}):$/;

/** Every value of `name`, however the request represents repeated headers. */
function headerValues(req: CertificateRequest, name: string): string[] {
  const distinct = req.headersDistinct?.[name];
  if (distinct) return distinct;
  if (Array.isArray(req.rawHeaders)) {
    const values: string[] = [];
    for (let i = 0; i + 1 < req.rawHeaders.length; i += 2) {
      if (req.rawHeaders[i].toLowerCase() === name) {
        values.push(req.rawHeaders[i + 1]);
      }
    }
    if (values.length > 0) return values;
  }
  const value = req.headers[name];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Exactly one value, or `undefined` when absent; anything else is refused. */
function singleHeader(
  req: CertificateRequest,
  name: string,
  maxBytes: number,
): string | undefined {
  const raw = req.headers[name];
  // A header the proxy-header middleware stripped is gone from `headers`
  // even though `rawHeaders` still lists it.
  if (raw === undefined) return undefined;
  const values = headerValues(req, name);
  if (values.length === 0) return undefined;
  if (values.length > 1 || Array.isArray(raw)) {
    throw new InvalidClientCertificateHeaderError('sent more than once');
  }
  const value = values[0];
  if (Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new InvalidClientCertificateHeaderError('too large');
  }
  if (value.trim() === '') {
    throw new InvalidClientCertificateHeaderError('empty');
  }
  return value;
}

function parseDer(der: Buffer): X509Certificate {
  try {
    return new X509Certificate(der);
  } catch {
    throw new InvalidClientCertificateHeaderError('not an X.509 certificate');
  }
}

function pemBlocks(value: string, format: 'leaf' | 'chain'): Buffer[] {
  let text: string;
  try {
    text = decodeURIComponent(value);
  } catch {
    throw new InvalidClientCertificateHeaderError('bad URL encoding');
  }
  // A linear scan rather than one regex over the whole value: the input is
  // attacker-sized up to MTLS_MAX_CERT_HEADER_BYTES.
  const blocks: Buffer[] = [];
  let position = 0;
  for (;;) {
    const begin = text.indexOf(PEM_BEGIN, position);
    if (begin === -1) break;
    if (text.slice(position, begin).trim() !== '') {
      throw new InvalidClientCertificateHeaderError(
        'unexpected content outside the CERTIFICATE block',
      );
    }
    const end = text.indexOf(PEM_END, begin + PEM_BEGIN.length);
    if (end === -1) {
      throw new InvalidClientCertificateHeaderError('unterminated PEM block');
    }
    const body = text.slice(begin + PEM_BEGIN.length, end).replace(/\s/g, '');
    if (!PEM_BODY.test(body)) {
      throw new InvalidClientCertificateHeaderError('PEM body is not base64');
    }
    blocks.push(Buffer.from(body, 'base64'));
    position = end + PEM_END.length;
  }
  if (text.slice(position).trim() !== '') {
    throw new InvalidClientCertificateHeaderError(
      'unexpected content outside the CERTIFICATE block',
    );
  }
  if (format === 'leaf' && blocks.length !== 1) {
    throw new InvalidClientCertificateHeaderError(
      'expected exactly one CERTIFICATE block',
    );
  }
  return blocks;
}

/** RFC 9440 §2: one or more `:base64:` byte sequences, comma separated. */
function rfc9440Items(value: string, format: 'leaf' | 'chain'): Buffer[] {
  const items = value.split(',').map((item) => item.trim());
  if (format === 'leaf' && items.length !== 1) {
    throw new InvalidClientCertificateHeaderError(
      'expected exactly one certificate',
    );
  }
  return items.map((item) => {
    const match = RFC9440_ITEM.exec(item);
    if (!match) {
      throw new InvalidClientCertificateHeaderError(
        'expected an RFC 9440 byte sequence (:base64:)',
      );
    }
    return Buffer.from(match[1], 'base64');
  });
}

/**
 * The certificate the client presented on this request, from the TLS
 * handshake or from a trusted TLS-terminating proxy. It proves possession of
 * the key only; whether the certificate is trusted is decided later, per
 * realm, by whoever consumes it.
 *
 * Without mTLS configured this always returns `null`.
 */
@Injectable()
export class ClientCertificateSource {
  private readonly cache = new WeakMap<
    object,
    PresentedClientCertificate | null
  >();

  constructor(@Inject(MTLS_CONFIG) private readonly config: MtlsConfig) {}

  /**
   * The presented certificate, or `null` when there is none. A proxy header
   * counts only when the socket peer is a trusted proxy and the handshake
   * itself carried no certificate. Throws {@link InvalidClientCertificateHeaderError}
   * (400 `invalid_request`) when a trusted proxy sent a malformed header.
   */
  fromRequest(req: CertificateRequest): PresentedClientCertificate | null {
    const cached = this.cache.get(req);
    if (cached !== undefined) return cached;
    const result = this.fromSocket(req) ?? this.fromProxyHeader(req);
    this.cache.set(req, result);
    return result;
  }

  private fromSocket(
    req: CertificateRequest,
  ): PresentedClientCertificate | null {
    const socket = req.socket;
    if (!(socket instanceof TLSSocket)) return null;
    // The detailed chain first: on Node 24, once getPeerX509Certificate()
    // has run, getPeerCertificate(true) no longer links the intermediates
    // the client sent.
    let detailed: DetailedPeerCertificate | undefined;
    try {
      detailed = socket.getPeerCertificate(true);
    } catch {
      detailed = undefined;
    }
    let certificate: X509Certificate | undefined;
    try {
      certificate = socket.getPeerX509Certificate();
    } catch {
      return null;
    }
    if (!certificate) return null;
    return {
      source: 'tls',
      certificate,
      der: certificate.raw,
      x5tS256: computeX5tS256(certificate.raw),
      chain: this.peerChain(detailed, certificate),
      tlsAuthorized: socket.authorized === true,
    };
  }

  /** Intermediates from the handshake, stopping at a self-issued root. */
  private peerChain(
    detailed: DetailedPeerCertificate | undefined,
    leaf: X509Certificate,
  ): X509Certificate[] {
    const chain: X509Certificate[] = [];
    const seen = new Set<string>([leaf.fingerprint256]);
    let current = detailed?.issuerCertificate;
    while (
      current?.raw &&
      chain.length < this.config.maxChainDepth &&
      !seen.has(current.fingerprint256)
    ) {
      seen.add(current.fingerprint256);
      try {
        chain.push(new X509Certificate(current.raw));
      } catch {
        break;
      }
      current = current.issuerCertificate;
    }
    return chain;
  }

  private fromProxyHeader(
    req: CertificateRequest,
  ): PresentedClientCertificate | null {
    const proxy = this.config.proxy;
    if (!proxy) return null;
    if (!proxy.trustedProxies.contains(req.socket?.remoteAddress)) {
      return null;
    }
    const value = singleHeader(
      req,
      proxy.certHeader,
      this.config.maxCertHeaderBytes,
    );
    if (value === undefined) return null;
    const [der] = this.decode(value, proxy, 'leaf');
    const certificate = parseDer(der);
    return {
      source: 'proxy-header',
      certificate,
      der: certificate.raw,
      x5tS256: computeX5tS256(certificate.raw),
      chain: this.headerChain(req, proxy),
    };
  }

  private headerChain(
    req: CertificateRequest,
    proxy: MtlsProxyConfig,
  ): X509Certificate[] {
    if (!proxy.chainHeader) return [];
    const value = singleHeader(
      req,
      proxy.chainHeader,
      this.config.maxCertHeaderBytes * this.config.maxChainDepth,
    );
    if (value === undefined) return [];
    const ders = this.decode(value, proxy, 'chain');
    if (ders.length > this.config.maxChainDepth) {
      throw new InvalidClientCertificateHeaderError('chain too long');
    }
    return ders.map(parseDer);
  }

  private decode(
    value: string,
    proxy: MtlsProxyConfig,
    kind: 'leaf' | 'chain',
  ): Buffer[] {
    return proxy.format === 'rfc9440'
      ? rfc9440Items(value, kind)
      : pemBlocks(value, kind);
  }
}
