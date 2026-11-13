import { parseCertificateInfo } from './certificate.js';

/** The parser's verdict, without throwing. */
function parse(pem: string): { valid: boolean; info?: unknown } {
  try {
    return { valid: true, info: parseCertificateInfo(pem) };
  } catch {
    return { valid: false };
  }
}

/**
 * Regression tests for the polynomial-ReDoS fixes in parseCertificateInfo
 * (CodeQL js/polynomial-redos, alerts #8–#12 / #13–#14). Each input below is
 * crafted to drive the *previous* backtracking regexes super-linearly. With the
 * indexOf/bounded-regex parser they all return well under the time bound; if a
 * backtracking pattern is reintroduced these will blow past it.
 */
describe('parseCertificateInfo ReDoS hardening', () => {
  const BUDGET_MS = 1000; // fixed parser is sub-millisecond; old regexes hung for seconds

  function timed(fn: () => void): number {
    const start = Date.now();
    fn();
    return Date.now() - start;
  }

  it('handles a BEGIN marker with a huge body and no END marker quickly', () => {
    const input = '-----BEGIN CERTIFICATE-----\n' + 'A'.repeat(200_000);
    const ms = timed(() => {
      const res = parse(input);
      expect(res.valid).toBe(false); // no END marker -> rejected, not hung
    });
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('handles a pathological basicConstraints run quickly', () => {
    const input =
      '-----BEGIN CERTIFICATE-----\nQQ==\n-----END CERTIFICATE-----\n' +
      'basicConstraints' +
      ' '.repeat(200_000); // marker present, "CA:true" never appears
    const ms = timed(() => parse(input));
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('handles a pathological issuer line quickly', () => {
    const input =
      '-----BEGIN CERTIFICATE-----\nQQ==\n-----END CERTIFICATE-----\n' +
      'issuer=' +
      'a '.repeat(100_000); // long issuer line that never yields CN/OU/O
    const ms = timed(() => parse(input));
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('handles many repeated marker prefixes quickly', () => {
    const input =
      '-----BEGIN CERTIFICATE-----\nQQ==\n-----END CERTIFICATE-----\n' +
      'issuer=basicConstraints'.repeat(20_000);
    const ms = timed(() => parse(input));
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('rejects a PEM wrapper containing a single byte and forged metadata', () => {
    // "QQ==" is not an X.509 certificate; appended text must not supply trusted metadata.
    const input =
      '-----BEGIN CERTIFICATE-----\nQQ==\n-----END CERTIFICATE-----\n' +
      'CN=example.com\nissuer=CN=Example CA\nbasicConstraints CA:true';
    const res = parse(input);
    expect(res.valid).toBe(false);
    expect(res.info).toBeUndefined();
  });
});
