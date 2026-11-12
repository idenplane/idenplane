import { X509Certificate } from 'node:crypto';
import { TLSSocket } from 'node:tls';
import {
  ClientCertificateSource,
  InvalidClientCertificateHeaderError,
  computeX5tS256,
  type CertificateRequest,
} from './client-certificate.source.js';
import { loadMtlsConfig, type MtlsConfig } from './mtls-config.js';
import { makeTestCertificate } from '../nhi/__mocks__/certificate.fixture.js';

/** A TLS socket stub, as in nhi/mtls.guard.security.spec.ts. */
const peer = (
  certificate: X509Certificate | undefined,
  options: {
    authorized?: boolean;
    remoteAddress?: string;
    issuers?: X509Certificate[];
  } = {},
) => {
  // getPeerCertificate(true): each issuer links to the next; the last is
  // self-issued and points to itself, as Node reports a root.
  const detailed = (
    list: X509Certificate[],
  ): Record<string, unknown> | undefined => {
    if (list.length === 0) return undefined;
    const [first, ...rest] = list;
    const node: Record<string, unknown> = {
      raw: first.raw,
      fingerprint256: first.fingerprint256,
    };
    node['issuerCertificate'] = rest.length > 0 ? detailed(rest) : node;
    return node;
  };
  return Object.defineProperties(Object.create(TLSSocket.prototype), {
    encrypted: { value: true },
    authorized: { value: options.authorized ?? false },
    remoteAddress: { value: options.remoteAddress ?? '203.0.113.9' },
    getPeerX509Certificate: {
      value: () => certificate,
      writable: true,
      configurable: true,
    },
    getPeerCertificate: {
      value: () =>
        certificate
          ? {
              raw: certificate.raw,
              fingerprint256: certificate.fingerprint256,
              issuerCertificate: detailed(options.issuers ?? []),
            }
          : {},
      writable: true,
      configurable: true,
    },
  }) as TLSSocket;
};

const plainSocket = (remoteAddress: string) =>
  ({ remoteAddress }) as CertificateRequest['socket'];

function request(
  headers: Record<string, string | string[]>,
  socket: CertificateRequest['socket'],
  rawHeaders?: string[],
): CertificateRequest {
  const lower: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers))
    lower[name.toLowerCase()] = value;
  return {
    headers: lower,
    socket,
    rawHeaders:
      rawHeaders ??
      Object.entries(headers).flatMap(([name, value]) =>
        Array.isArray(value) ? value.flatMap((v) => [name, v]) : [name, value],
      ),
  };
}

const TRUSTED = '10.0.0.5';
const UNTRUSTED = '198.51.100.7';

function source(env: Record<string, string> = {}): ClientCertificateSource {
  const config: MtlsConfig = loadMtlsConfig({
    MTLS_ENABLED: 'true',
    MTLS_PROXY_CERT_HEADER: 'X-Client-Cert',
    MTLS_PROXY_CERT_CHAIN_HEADER: 'X-Client-Cert-Chain',
    MTLS_TRUSTED_PROXY_CIDRS: '10.0.0.0/8',
    MTLS_MAX_CERT_HEADER_BYTES: '4096',
    ...env,
  });
  return new ClientCertificateSource(config);
}

/** The x5t#S256 from Node's own hex fingerprint, without createHash. */
const x5tFromFingerprint = (certificate: X509Certificate) =>
  Buffer.from(certificate.fingerprint256.replace(/:/g, ''), 'hex').toString(
    'base64url',
  );

describe('computeX5tS256', () => {
  it('is base64url SHA-256 without padding', () => {
    // SHA-256("") = e3b0c442...b855, a published test vector.
    expect(computeX5tS256(Buffer.alloc(0))).toBe(
      '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU',
    );
  });

  it('matches the certificate fingerprint Node computes', async () => {
    const certificate = new X509Certificate((await makeTestCertificate()).pem);
    const x5t = computeX5tS256(certificate.raw);
    expect(x5t).toBe(x5tFromFingerprint(certificate));
    expect(x5t).not.toMatch(/[=+/]/);
    expect(x5t).toHaveLength(43);
  });
});

describe('ClientCertificateSource', () => {
  let leaf: X509Certificate;
  let leafPem: string;
  let other: X509Certificate;
  let otherPem: string;

  beforeAll(async () => {
    leafPem = (await makeTestCertificate({ name: 'device-1' })).pem;
    otherPem = (await makeTestCertificate({ name: 'device-2' })).pem;
    leaf = new X509Certificate(leafPem);
    other = new X509Certificate(otherPem);
  });

  describe('from the TLS handshake', () => {
    it('returns the peer certificate with its x5t#S256', () => {
      const result = source().fromRequest(
        request({}, peer(leaf, { authorized: true })),
      );
      expect(result?.source).toBe('tls');
      expect(result?.certificate.fingerprint256).toBe(leaf.fingerprint256);
      expect(result?.x5tS256).toBe(x5tFromFingerprint(leaf));
      expect(result?.tlsAuthorized).toBe(true);
      expect(result?.chain).toEqual([]);
    });

    it('collects the intermediates and stops at a self-issued root', () => {
      const result = source().fromRequest(
        request({}, peer(leaf, { issuers: [other] })),
      );
      expect(result?.chain.map((c) => c.fingerprint256)).toEqual([
        other.fingerprint256,
      ]);
    });

    it('caps the collected chain at MTLS_MAX_CHAIN_DEPTH', async () => {
      const issuers = await Promise.all(
        [1, 2, 3].map(
          async (i) =>
            new X509Certificate(
              (await makeTestCertificate({ name: `ca-${i}` })).pem,
            ),
        ),
      );
      const result = source({ MTLS_MAX_CHAIN_DEPTH: '2' }).fromRequest(
        request({}, peer(leaf, { issuers })),
      );
      expect(result?.chain).toHaveLength(2);
    });

    it('is null on a TLS connection without a client certificate', () => {
      expect(source().fromRequest(request({}, peer(undefined)))).toBeNull();
    });

    it('beats a certificate header, even from a trusted proxy', () => {
      const req = request(
        { 'X-Client-Cert': encodeURIComponent(otherPem) },
        peer(leaf, { remoteAddress: TRUSTED }),
      );
      const result = source().fromRequest(req);
      expect(result?.source).toBe('tls');
      expect(result?.certificate.fingerprint256).toBe(leaf.fingerprint256);
    });
  });

  describe('from a proxy header', () => {
    it('accepts a URL-encoded PEM from a trusted proxy', () => {
      const req = request(
        { 'X-Client-Cert': encodeURIComponent(leafPem) },
        plainSocket(TRUSTED),
      );
      const result = source().fromRequest(req);
      expect(result?.source).toBe('proxy-header');
      expect(result?.x5tS256).toBe(x5tFromFingerprint(leaf));
      expect(result?.tlsAuthorized).toBeUndefined();
    });

    it('accepts a peer reported as an IPv4-mapped IPv6 address', () => {
      const req = request(
        { 'X-Client-Cert': encodeURIComponent(leafPem) },
        plainSocket(`::ffff:${TRUSTED}`),
      );
      expect(source().fromRequest(req)?.source).toBe('proxy-header');
    });

    it('accepts the RFC 9440 :base64: form', () => {
      const req = request(
        {
          'X-Client-Cert': `:${leaf.raw.toString('base64')}:`,
          'X-Client-Cert-Chain': `:${other.raw.toString('base64')}:`,
        },
        plainSocket(TRUSTED),
      );
      const result = source({ MTLS_PROXY_CERT_FORMAT: 'rfc9440' }).fromRequest(
        req,
      );
      expect(result?.x5tS256).toBe(x5tFromFingerprint(leaf));
      expect(result?.chain.map((c) => c.fingerprint256)).toEqual([
        other.fingerprint256,
      ]);
    });

    it('reads a chain header of several PEM blocks', () => {
      const req = request(
        {
          'X-Client-Cert': encodeURIComponent(leafPem),
          'X-Client-Cert-Chain': encodeURIComponent(`${otherPem}\n${leafPem}`),
        },
        plainSocket(TRUSTED),
      );
      expect(source().fromRequest(req)?.chain).toHaveLength(2);
    });

    it('is null for a header from an untrusted peer', () => {
      const req = request(
        { 'X-Client-Cert': encodeURIComponent(leafPem) },
        plainSocket(UNTRUSTED),
      );
      expect(source().fromRequest(req)).toBeNull();
    });

    it('is null without a configured header, whatever the request sends', () => {
      const req = request(
        { 'X-Client-Cert': encodeURIComponent(leafPem) },
        plainSocket(TRUSTED),
      );
      expect(
        new ClientCertificateSource(loadMtlsConfig({})).fromRequest(req),
      ).toBeNull();
    });

    it('is null when the trusted proxy sends no header', () => {
      expect(
        source().fromRequest(request({}, plainSocket(TRUSTED))),
      ).toBeNull();
    });

    it('rejects a header sent twice', () => {
      const value = encodeURIComponent(leafPem);
      const req = request(
        { 'X-Client-Cert': `${value}, ${value}` },
        plainSocket(TRUSTED),
        ['X-Client-Cert', value, 'x-client-cert', value],
      );
      expect(() => source().fromRequest(req)).toThrow(
        InvalidClientCertificateHeaderError,
      );
    });

    it('rejects an array value', () => {
      const value = encodeURIComponent(leafPem);
      const req: CertificateRequest = {
        headers: { 'x-client-cert': [value, value] },
        socket: plainSocket(TRUSTED),
      };
      expect(() => source().fromRequest(req)).toThrow(
        InvalidClientCertificateHeaderError,
      );
    });

    it('rejects an oversize header', () => {
      const req = request(
        { 'X-Client-Cert': encodeURIComponent(leafPem) + ' '.repeat(5000) },
        plainSocket(TRUSTED),
      );
      expect(() => source().fromRequest(req)).toThrow(/too large/);
    });

    it('rejects two PEM blocks', () => {
      const req = request(
        { 'X-Client-Cert': encodeURIComponent(`${leafPem}\n${otherPem}`) },
        plainSocket(TRUSTED),
      );
      expect(() => source().fromRequest(req)).toThrow(/exactly one/);
    });

    it.each([
      [
        'text around the block',
        (pem: string) => encodeURIComponent(`junk\n${pem}`),
      ],
      [
        'a private key',
        () =>
          encodeURIComponent(
            '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----',
          ),
      ],
      [
        'an unterminated block',
        (pem: string) => encodeURIComponent(pem.split('-----END')[0]),
      ],
      ['bad URL encoding', () => '%E0%A4%A'],
      [
        'bytes that are not a certificate',
        () =>
          encodeURIComponent(
            '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----',
          ),
      ],
    ])('rejects %s', (_label, value) => {
      const req = request(
        { 'X-Client-Cert': value(leafPem) },
        plainSocket(TRUSTED),
      );
      expect(() => source().fromRequest(req)).toThrow(
        InvalidClientCertificateHeaderError,
      );
    });

    it.each([
      [
        'two items',
        (der: Buffer) =>
          `:${der.toString('base64')}:, :${der.toString('base64')}:`,
      ],
      ['no colons', (der: Buffer) => der.toString('base64')],
      ['a PEM', () => 'LS0tLS1CRUdJTg=='],
    ])('rejects an RFC 9440 value with %s', (_label, value) => {
      const req = request(
        { 'X-Client-Cert': value(leaf.raw) },
        plainSocket(TRUSTED),
      );
      expect(() =>
        source({ MTLS_PROXY_CERT_FORMAT: 'rfc9440' }).fromRequest(req),
      ).toThrow(InvalidClientCertificateHeaderError);
    });

    it('answers 400 invalid_request for a malformed header', () => {
      const req = request({ 'X-Client-Cert': 'garbage' }, plainSocket(TRUSTED));
      try {
        source().fromRequest(req);
        throw new Error('expected a rejection');
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidClientCertificateHeaderError);
        expect((err as InvalidClientCertificateHeaderError).httpStatus).toBe(
          400,
        );
        expect((err as InvalidClientCertificateHeaderError).code).toBe(
          'invalid_request',
        );
      }
    });

    it('ignores a header the untrusted-header middleware stripped', () => {
      const req = request(
        { 'X-Client-Cert': encodeURIComponent(leafPem) },
        plainSocket(TRUSTED),
      );
      delete req.headers['x-client-cert'];
      expect(source().fromRequest(req)).toBeNull();
    });
  });

  it('memoises the result per request', () => {
    const src = source();
    const socket = peer(leaf);
    const spy = jest.spyOn(socket, 'getPeerX509Certificate');
    const req = request({}, socket);
    const first = src.fromRequest(req);
    expect(src.fromRequest(req)).toBe(first);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('reads the detailed chain before the X509Certificate', () => {
    // On Node 24, getPeerCertificate(true) stops linking the client's
    // intermediates once getPeerX509Certificate() has run (real sockets;
    // covered end to end by test/mtls-client-auth.e2e-spec.ts).
    const calls: string[] = [];
    const socket = peer(leaf);
    const detailed = socket.getPeerCertificate.bind(socket);
    const x509 = socket.getPeerX509Certificate.bind(socket);
    Object.defineProperties(socket, {
      getPeerCertificate: {
        value: (full: boolean) => (calls.push('detailed'), detailed(full)),
      },
      getPeerX509Certificate: {
        value: () => (calls.push('x509'), x509()),
      },
    });
    source().fromRequest(request({}, socket));
    expect(calls).toEqual(['detailed', 'x509']);
  });
});
