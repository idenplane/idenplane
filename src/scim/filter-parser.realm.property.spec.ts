import fc from 'fast-check';
import { scimFilterToPrismaWhereUser } from './filter-parser.service';

// Users counterpart of "keeps every Group query inside the caller realm".
// Regression test for GHSA-gcvm-65hf-985v (fixed in 0.10.0): a filter must
// never move the query out of the caller realm or onto internal columns.
describe('SCIM Users filter realm scope (property-based)', () => {
  it('keeps every Users query inside the caller realm', () => {
    const attribute = fc.oneof(
      fc.constantFrom('realmId', 'realm_id', 'passwordHash', '__proto__', 'constructor', 'userName', 'emails.value', 'active', 'id'),
      fc.stringMatching(/^[\w.]{1,20}$/),
    );
    fc.assert(
      fc.property(
        attribute,
        fc.constantFrom('eq', 'ne', 'co', 'sw', 'ew', 'gt', 'ge', 'lt', 'le'),
        fc.oneof(fc.uuid().map((u) => `"${u}"`), fc.constantFrom('true', 'false', '1')),
        fc.uuid(),
        (attr, op, value, realmId) => {
          let where: Record<string, unknown>;
          try {
            where = scimFilterToPrismaWhereUser(`${attr} ${op} ${value}`, realmId);
          } catch {
            return;
          }
          expect(where.realmId).toBe(realmId);
          // Only allow-listed columns may be filtered.
          expect(Object.keys(where)).not.toContain('passwordHash');
        },
      ),
      { numRuns: 500 },
    );
  });
});
