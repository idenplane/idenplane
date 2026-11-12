import {
  CertificatePemError,
  normalizeSerial,
  parseSingleCertificatePem,
  summarizeCertificate,
} from './certificate-pem.js';
import { computeX5tS256 } from '../mtls/client-certificate.source.js';
import { issue, type TestIdentity } from './__mocks__/test-pki.js';

describe('parseSingleCertificatePem', () => {
  let a: TestIdentity;
  let b: TestIdentity;

  beforeAll(async () => {
    a = await issue({ name: [{ O: ['Acme'] }, { CN: ['a'] }] });
    b = await issue({ cn: 'b' });
  });

  it('reads one certificate and summarises it', () => {
    const summary = summarizeCertificate(parseSingleCertificatePem(a.pem));
    expect(summary.x5tS256).toBe(computeX5tS256(a.certificate.raw));
    expect(summary.x5tS256).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(summary.subject).toBe('CN=a,O=Acme');
    expect(summary.notAfter).toEqual(a.certificate.validToDate);
  });

  it('accepts surrounding whitespace', () => {
    expect(() => parseSingleCertificatePem(`\n\n${a.pem}\n`)).not.toThrow();
  });

  it.each([
    [
      'a private key alongside',
      () => `${a.pem}\n${a.privateKeyPem}`,
      /private key/,
    ],
    ['a private key alone', () => a.privateKeyPem, /private key/],
    ['two certificates', () => `${a.pem}\n${b.pem}`, /exactly one/],
    ['text outside the block', () => `hello\n${a.pem}`, /outside/],
    [
      'another block type',
      () => '-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----',
      /CERTIFICATE block/,
    ],
    [
      'garbage base64',
      () => '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----',
      /not an X.509/,
    ],
    ['empty input', () => '', /required/],
    ['a non-string', () => 42, /required/],
  ])('refuses %s', (_label, input, message) => {
    expect(() => parseSingleCertificatePem(input())).toThrow(
      CertificatePemError,
    );
    expect(() => parseSingleCertificatePem(input())).toThrow(message);
  });
});

describe('normalizeSerial', () => {
  it('lower-cases, strips separators and leading zeros', () => {
    expect(normalizeSerial('00:A1:FF')).toBe('a1ff');
    expect(normalizeSerial('0000')).toBe('0');
    expect(normalizeSerial('xyz')).toBeUndefined();
  });
});
