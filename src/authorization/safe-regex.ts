/**
 * Regular expressions for the `matches` policy operator.
 *
 * The pattern is written by an administrator and run against values from
 * the request (subject, resource and environment attributes), so a pattern
 * with catastrophic backtracking would let any caller of the evaluate
 * endpoint stall the event loop (ReDoS). JavaScript's engine backtracks, so
 * instead of trusting patterns this module only accepts ones whose cost is
 * bounded, and caps how much text they run on:
 *
 * - the pattern is at most {@link MAX_PATTERN_LENGTH} characters;
 * - no backreferences (`\1`, `\k<name>`), which cannot be matched in linear
 *   time;
 * - no group that contains a quantifier or an alternation and is itself
 *   quantified (`(a+)+`, `(a*)*`, `(a|aa)+`, `(?:x{2,})*`): star height one,
 *   the shape behind practically every catastrophic case;
 * - the value tested is at most {@link MAX_SUBJECT_LENGTH} characters.
 *   A longer value makes the condition indeterminate, so a DENY applies.
 *
 * Patterns that fail these rules are refused when the policy is saved or
 * imported, and a stored one fails closed at evaluation.
 */

export const MAX_PATTERN_LENGTH = 256;
export const MAX_SUBJECT_LENGTH = 2048;

/** Why `pattern` is not accepted for the `matches` operator, or null. */
export function regexPatternProblem(pattern: string): string | null {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return `regular expression is longer than ${MAX_PATTERN_LENGTH} characters`;
  }
  if (/\\(?:[1-9]|k<)/.test(pattern)) {
    return 'regular expression must not use backreferences';
  }

  // One pass over the pattern. For each open group remember whether its
  // body contains a quantifier or an alternation; when a group closes and
  // is followed by a quantifier, such a body is nested repetition.
  const groups: boolean[] = [];
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      i++; // the escaped character is a literal
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      continue;
    }
    if (ch === '(') {
      groups.push(false);
      continue;
    }
    if (ch === ')') {
      const repeats = groups.pop() ?? false;
      const next = pattern[i + 1];
      const quantified = next === '+' || next === '*' || next === '{';
      if (repeats && quantified) {
        return 'regular expression must not repeat a group that itself repeats or alternates (for example "(a+)+" or "(a|b)*")';
      }
      // A quantified group makes its enclosing group repeat as well.
      if ((repeats || quantified) && groups.length > 0) {
        groups[groups.length - 1] = true;
      }
      continue;
    }
    const isQuantifier =
      ch === '+' ||
      ch === '*' ||
      ch === '|' ||
      (ch === '{' && /^\{\d+(,\d*)?\}/.test(pattern.slice(i)));
    if (isQuantifier && groups.length > 0) {
      groups[groups.length - 1] = true;
    }
  }

  try {
    // Compiling is safe: the checks above bound what running it can cost.
    new RegExp(pattern);
  } catch {
    return `invalid regular expression "${pattern}"`;
  }
  return null;
}

/**
 * Test `subject` against an accepted pattern. Returns null when the
 * pattern or the subject is outside the limits above (the caller treats
 * that as indeterminate).
 */
export function safeRegexTest(
  pattern: string,
  subject: string,
): boolean | null {
  if (regexPatternProblem(pattern) !== null) return null;
  if (subject.length > MAX_SUBJECT_LENGTH) return null;
  return new RegExp(pattern).test(subject);
}
