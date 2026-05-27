import { parseScimFilter } from './filter-parser.service';

/**
 * Regression test for the polynomial-ReDoS fix in parseScimFilter
 * (CodeQL js/polynomial-redos, alert #15). The value group is now `\S.*`
 * instead of `.+`, removing the overlap with the preceding `\s+`. Adversarial
 * input must parse/throw in linear time, and valid filters must still parse.
 */
describe('parseScimFilter ReDoS hardening', () => {
  it('handles a long whitespace-heavy adversarial filter quickly', () => {
    const adversarial = '. eq ' + '  '.repeat(100_000);
    const start = Date.now();
    // Either parses or throws — must not hang.
    try {
      parseScimFilter(adversarial);
    } catch {
      /* invalid filter is an acceptable outcome */
    }
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('still parses a well-formed equality filter', () => {
    const res = parseScimFilter('userName eq "john"');
    expect(res.attribute).toBe('userName');
    expect(res.operator).toBe('eq');
    // value retains its (quoted) content
    expect(res.value).toContain('john');
  });

  it('parses other operators', () => {
    expect(parseScimFilter('displayName co "Doe"').operator).toBe('co');
    expect(parseScimFilter('userName sw "jo"').operator).toBe('sw');
  });

  it('rejects a value that is only whitespace', () => {
    // `\S.*` requires a non-space first char; a whitespace-only value is invalid.
    expect(() => parseScimFilter('userName eq    ')).toThrow();
  });
});
