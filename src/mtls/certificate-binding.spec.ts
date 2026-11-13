import {
  assertCertificateBinding,
  boundCertificateThumbprint,
  CertificateBindingError,
} from './certificate-binding.js';
import { createHash, X509Certificate } from 'node:crypto';
import {
  ClientCertificateSource,
  type CertificateRequest,
} from './client-certificate.source.js';
import { loadMtlsConfig } from './mtls-config.js';
import { makeTestCertificate } from '../nhi/__mocks__/certificate.fixture.js';

const X5T = 'n4bQgYhMfWWaL-qgxVrQFaO_TxsrC4Is0V1sFbDwCgg';
const OTHER = 'AAAAgYhMfWWaL-qgxVrQFaO_TxsrC4Is0V1sFbDwCgg';
const bound = { sub: 'u', cnf: { 'x5t#S256': X5T } };

function refusal(fn: () => void): CertificateBindingError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(CertificateBindingError);
    return err as CertificateBindingError;
  }
  throw new Error('expected a CertificateBindingError');
}

describe('assertCertificateBinding', () => {
  it('passes an unbound token without reading the certificate', () => {
    const read = jest.fn(() => {
      throw new Error('must not be read');
    });
    expect(() => assertCertificateBinding({ sub: 'u' }, read)).not.toThrow();
    expect(read).not.toHaveBeenCalled();
  });

  it('passes a bound token presented with its certificate', () => {
    expect(() =>
      assertCertificateBinding(bound, { x5tS256: X5T }),
    ).not.toThrow();
    expect(() =>
      assertCertificateBinding(bound, () => ({ x5tS256: X5T })),
    ).not.toThrow();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a reader returning null', () => null],
  ])('refuses a bound token with no certificate (%s)', (_label, presented) => {
    const err = refusal(() => assertCertificateBinding(bound, presented));
    expect(err.reason).toBe('missing');
    expect(err.getStatus()).toBe(401);
    expect(err.getResponse()).toEqual({
      error: 'invalid_token',
      error_description: expect.stringMatching(/bound to a client certificate/),
    });
  });

  it('refuses a bound token presented with another certificate', () => {
    const err = refusal(() =>
      assertCertificateBinding(bound, { x5tS256: OTHER }),
    );
    expect(err.reason).toBe('mismatch');
  });

  it('refuses a thumbprint that differs only in length', () => {
    const err = refusal(() =>
      assertCertificateBinding(bound, { x5tS256: `${X5T}A` }),
    );
    expect(err.reason).toBe('mismatch');
  });

  it('treats a certificate that cannot be read as none (fail closed)', () => {
    const err = refusal(() =>
      assertCertificateBinding(bound, () => {
        throw new Error('malformed proxy header');
      }),
    );
    expect(err.reason).toBe('missing');
  });

  it.each([
    ['a string', 'x'],
    ['null', null],
    ['an array', [X5T]],
    ['an object without x5t#S256', { jkt: 'abc' }],
    ['an empty thumbprint', { 'x5t#S256': '' }],
    ['a numeric thumbprint', { 'x5t#S256': 42 }],
  ])('refuses a cnf it cannot check: %s', (_label, cnf) => {
    const err = refusal(() =>
      assertCertificateBinding({ sub: 'u', cnf }, { x5tS256: X5T }),
    );
    expect(err.reason).toBe('malformed');
  });

  it('carries an RFC 6750 challenge built from constants', () => {
    const err = refusal(() => assertCertificateBinding(bound, null));
    expect(err.wwwAuthenticate).toBe(
      'Bearer error="invalid_token", error_description="The access token is bound to a client certificate; present that certificate over mutual TLS"',
    );
  });
});

describe('assertCertificateBinding with ClientCertificateSource', () => {
  const source = new ClientCertificateSource(
    loadMtlsConfig({
      MTLS_ENABLED: 'true',
      MTLS_PROXY_CERT_HEADER: 'X-Client-Cert',
      MTLS_TRUSTED_PROXY_CIDRS: '10.0.0.0/8',
    }),
  );

  async function forwarded(remoteAddress: string) {
    const pem = (await makeTestCertificate({ name: 'device-1' })).pem;
    const x5t = createHash('sha256')
      .update(new X509Certificate(pem).raw)
      .digest('base64url');
    const req = {
      headers: { 'x-client-cert': encodeURIComponent(pem) },
      socket: { remoteAddress },
    } as unknown as CertificateRequest;
    return { req, payload: { sub: 'u', cnf: { 'x5t#S256': x5t } } };
  }

  it('accepts the right certificate from a trusted proxy', async () => {
    const { req, payload } = await forwarded('10.0.0.5');
    expect(() =>
      assertCertificateBinding(payload, () => source.fromRequest(req)),
    ).not.toThrow();
  });

  it('refuses even the right certificate from an untrusted peer (fail closed)', async () => {
    const { req, payload } = await forwarded('198.51.100.7');
    const err = refusal(() =>
      assertCertificateBinding(payload, () => source.fromRequest(req)),
    );
    expect(err.reason).toBe('missing');
  });
});

describe('boundCertificateThumbprint', () => {
  it('returns the thumbprint of a bound token and null otherwise', () => {
    expect(boundCertificateThumbprint(bound)).toBe(X5T);
    expect(boundCertificateThumbprint({ sub: 'u' })).toBeNull();
    expect(boundCertificateThumbprint({ cnf: undefined })).toBeNull();
  });
});
