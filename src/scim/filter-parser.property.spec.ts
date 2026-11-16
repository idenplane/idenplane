import { HttpException } from '@nestjs/common';
import fc from 'fast-check';
import {
  parseScimFilter,
  scimFilterToPrismaWhereGroup,
  scimFilterToPrismaWhereUser,
} from './filter-parser.service';

/**
 * Property-based tests for the SCIM filter parser. The filter comes straight
 * from a SCIM client's query string, so the parser must hold up against any
 * string, not only the examples in filter-parser.redos.spec.ts.
 */

const OPERATORS = ['eq', 'ne', 'co', 'sw', 'ew', 'gt', 'ge', 'lt', 'le'];

/** Mixed upper/lower case, as SCIM operators are case-insensitive. */
const anyCase = (word: string) =>
  fc
    .array(fc.boolean(), { minLength: word.length, maxLength: word.length })
    .map((upper) =>
      [...word].map((c, i) => (upper[i] ? c.toUpperCase() : c)).join(''),
    );

/**
 * Filters assembled from the pieces a filter is made of, including the
 * pieces a hostile client would try: other realms' columns, prototype keys,
 * unbalanced quotes, logical operators, line breaks.
 */
const filterToken = fc.oneof(
  fc.constantFrom(
    'userName',
    'displayName',
    'externalId',
    'emails.value',
    'name.givenName',
    'active',
    'id',
    'realmId',
    'passwordHash',
    '__proto__',
    'constructor',
    'urn:ietf:params:scim:schemas:core:2.0:User:userName',
    'and',
    'or',
    'not',
    'pr',
    'true',
    'false',
    'null',
    '"',
    "'",
    '(',
    ')',
    '[',
    ']',
    '.',
    '\\',
    ' ',
    '  ',
    '\t',
    '\n',
    ' ',
    '\u0000',
    '-1.5',
    '42',
  ),
  fc.constantFrom(...OPERATORS).chain(anyCase),
  fc.string({ maxLength: 12 }),
);
const tokenFilter = fc
  .tuple(fc.array(filterToken, { maxLength: 12 }), fc.constantFrom(' ', ''))
  .map(([parts, separator]) => parts.join(separator));
const anyFilter = fc.oneof(
  tokenFilter,
  fc.string({ unit: 'binary', maxLength: 200 }),
);

/** The only failure a client may cause is a 400 (an HttpException). */
function expectOnly400(fn: () => unknown): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(400);
  }
}

describe('SCIM filter parser (property-based)', () => {
  it('fails only with a 400, whatever the filter', () => {
    fc.assert(
      fc.property(anyFilter, fc.uuid(), (filter, realmId) => {
        expectOnly400(() => parseScimFilter(filter));
        expectOnly400(() => scimFilterToPrismaWhereUser(filter, realmId));
        expectOnly400(() => scimFilterToPrismaWhereGroup(filter, realmId));
      }),
      { numRuns: 500 },
    );
  });

  it('also refuses non-string filters with a 400', () => {
    fc.assert(
      fc.property(fc.anything(), (filter) => {
        if (typeof filter === 'string') return;
        expectOnly400(() => parseScimFilter(filter as unknown as string));
      }),
      { numRuns: 100 },
    );
  });

  it('reads back the attribute, operator and quoted value of a comparison', () => {
    const attribute = fc
      .array(fc.stringMatching(/^\w{1,10}$/), { minLength: 1, maxLength: 3 })
      .map((parts) => parts.join('.'));
    // Characters every SCIM string value can hold without escaping.
    const value = fc.stringMatching(/^[\w @.+-]{0,40}$/);
    const operator = fc
      .constantFrom(...OPERATORS)
      .chain((op) => anyCase(op).map((written) => ({ op, written })));
    const gap = fc.stringMatching(/^[ \t]{1,3}$/);

    fc.assert(
      fc.property(
        attribute,
        operator,
        value,
        gap,
        gap,
        (attr, { op, written }, val, gap1, gap2) => {
          const parsed = parseScimFilter(
            ` ${attr}${gap1}${written}${gap2}"${val}" `,
          );
          expect(parsed).toEqual({ attribute: attr, operator: op, value: val });
        },
      ),
      { numRuns: 300 },
    );
  });

  it('keeps every Group query inside the caller realm', () => {
    fc.assert(
      fc.property(anyFilter, fc.uuid(), (filter, realmId) => {
        let where: Record<string, unknown>;
        try {
          where = scimFilterToPrismaWhereGroup(filter, realmId);
        } catch {
          return; // refused (the 400 is checked above)
        }
        expect(where.realmId).toBe(realmId);
      }),
      { numRuns: 500 },
    );
  });

  it('keeps every Group query inside the caller realm when the filter names realmId', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('realmId', 'realm_id', 'realmid', 'REALMID'),
        fc.constantFrom(...OPERATORS),
        fc.uuid(),
        fc.uuid(),
        (attr, op, realmId, otherRealm) => {
          let where: Record<string, unknown>;
          try {
            where = scimFilterToPrismaWhereGroup(
              `${attr} ${op} "${otherRealm}"`,
              realmId,
            );
          } catch {
            return;
          }
          expect(where.realmId).toBe(realmId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('answers long adversarial filters in bounded time', () => {
    // Repetitions of the fragments that made the old pattern backtrack
    // (whitespace runs between an attribute and an operator), up to ~60 KB.
    const fragment = fc.constantFrom(' ', '\t', '.', 'a', ' eq ', '"', 'eq');
    const longFilter = fc
      .tuple(
        fc.array(fragment, { minLength: 1, maxLength: 6 }),
        fc.integer({ min: 1_000, max: 10_000 }),
      )
      .map(([parts, times]) => parts.join('').repeat(times));

    fc.assert(
      fc.property(longFilter, (filter) => {
        const start = performance.now();
        expectOnly400(() => parseScimFilter(filter));
        // Linear matching takes well under a millisecond per KB; quadratic
        // backtracking on 60 KB takes seconds. The bound leaves room for a
        // slow CI runner.
        expect(performance.now() - start).toBeLessThan(200);
      }),
      { numRuns: 40 },
    );
  });
});
