import {
  MAX_PATTERN_LENGTH,
  MAX_SUBJECT_LENGTH,
  regexPatternProblem,
  safeRegexTest,
} from './safe-regex.js';

describe('regexPatternProblem', () => {
  it.each([
    '^admin$',
    String.raw`^[a-z0-9._-]+@example\.com$`,
    '^(read|write):[a-z]+$',
    '^/api/v[0-9]+/',
    '(ab)+',
    '(?:[a-z]{2,8})?x',
    '[(+*)]+',
    String.raw`\(a+\)+`,
  ])('accepts %p', (pattern) => {
    expect(regexPatternProblem(pattern)).toBeNull();
  });

  it.each([
    ['(a+)+', 'repeat a group'],
    ['(a*)*', 'repeat a group'],
    ['(a|aa)+', 'repeat a group'],
    ['(?:x{2,})*', 'repeat a group'],
    ['((ab)+c)+', 'repeat a group'],
    [String.raw`^(\w+\s?)*$`, 'repeat a group'],
    [String.raw`(a)\1`, 'backreferences'],
    [String.raw`(?<n>a)\k<n>`, 'backreferences'],
    ['(', 'invalid regular expression'],
    ['a'.repeat(MAX_PATTERN_LENGTH + 1), 'longer than'],
  ])('refuses %p', (pattern, reason) => {
    expect(regexPatternProblem(pattern)).toContain(reason);
  });
});

describe('safeRegexTest', () => {
  it('tests an accepted pattern', () => {
    expect(safeRegexTest('^ad', 'admin')).toBe(true);
    expect(safeRegexTest('^ad', 'user')).toBe(false);
  });

  it('refuses a dangerous pattern and an oversized subject', () => {
    expect(safeRegexTest('(a+)+$', 'a'.repeat(40) + 'b')).toBeNull();
    expect(safeRegexTest('^a', 'a'.repeat(MAX_SUBJECT_LENGTH + 1))).toBeNull();
  });

  it('finishes quickly on the worst input it accepts', () => {
    const start = Date.now();
    expect(
      safeRegexTest('^[a-z]+[0-9]*x$', 'a'.repeat(MAX_SUBJECT_LENGTH)),
    ).toBe(false);
    expect(Date.now() - start).toBeLessThan(500);
  });
});
