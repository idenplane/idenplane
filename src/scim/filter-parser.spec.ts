import {
  scimFilterToPrismaWhereGroup,
  scimFilterToPrismaWhereUser,
} from './filter-parser.service';
import { ScimException } from './scim-errors';

const REALM = 'realm-1';

function scimTypeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof ScimException) return e.scimType;
    throw e;
  }
  throw new Error('expected a ScimException');
}

describe('scimFilterToPrismaWhereUser', () => {
  it('maps the lookup Entra ID and Okta make before every create', () => {
    expect(scimFilterToPrismaWhereUser('userName eq "jdoe"', REALM)).toEqual({
      username: { equals: 'jdoe', mode: 'insensitive' },
      realmId: REALM,
    });
  });

  it('matches attribute names case-insensitively', () => {
    expect(
      scimFilterToPrismaWhereUser('USERNAME eq "jdoe"', REALM),
    ).toMatchObject({ username: { equals: 'jdoe' } });
    expect(
      scimFilterToPrismaWhereUser(
        'urn:ietf:params:scim:schemas:core:2.0:User:userName eq "a"',
        REALM,
      ),
    ).toMatchObject({ username: { equals: 'a' } });
  });

  it('maps emails, names, active and id', () => {
    expect(
      scimFilterToPrismaWhereUser('emails.value co "@example.com"', REALM),
    ).toMatchObject({ email: { contains: '@example.com' } });
    expect(
      scimFilterToPrismaWhereUser('name.familyName sw "Do"', REALM),
    ).toMatchObject({ lastName: { startsWith: 'Do' } });
    expect(scimFilterToPrismaWhereUser('active eq false', REALM)).toEqual({
      enabled: false,
      realmId: REALM,
    });
    expect(scimFilterToPrismaWhereUser('id eq "u-1"', REALM)).toEqual({
      id: 'u-1',
      realmId: REALM,
    });
  });

  it('maps externalId exactly (caseExact)', () => {
    expect(scimFilterToPrismaWhereUser('externalId eq "Obj-1"', REALM)).toEqual(
      { scimExternalId: 'Obj-1', realmId: REALM },
    );
  });

  it('joins comparisons with and/or, "and" binding tighter', () => {
    expect(
      scimFilterToPrismaWhereUser(
        'userName eq "a" and active eq true or externalId eq "x"',
        REALM,
      ),
    ).toEqual({
      OR: [
        {
          AND: [
            { username: { equals: 'a', mode: 'insensitive' } },
            { enabled: true },
          ],
        },
        { scimExternalId: 'x' },
      ],
      realmId: REALM,
    });
  });

  it('does not split on "and" inside a quoted value', () => {
    expect(
      scimFilterToPrismaWhereUser('userName eq "salt and pepper"', REALM),
    ).toEqual({
      username: { equals: 'salt and pepper', mode: 'insensitive' },
      realmId: REALM,
    });
  });

  it('refuses more than 20 joined comparisons', () => {
    const filter = Array.from({ length: 21 }, () => 'userName eq "a"').join(
      ' or ',
    );
    expect(scimTypeOf(() => scimFilterToPrismaWhereUser(filter, REALM))).toBe(
      'invalidFilter',
    );
  });

  it('cannot widen the query to another realm', () => {
    expect(
      scimTypeOf(() =>
        scimFilterToPrismaWhereUser('realmId eq "other-realm"', REALM),
      ),
    ).toBe('invalidFilter');
  });

  it.each([
    'passwordHash sw "$argon2"',
    'phoneNumber pr',
    'displayName eq "x"',
    'title eq "x"',
    '__proto__ eq "x"',
  ])('refuses the unsupported attribute in %s', (filter) => {
    expect(scimTypeOf(() => scimFilterToPrismaWhereUser(filter, REALM))).toBe(
      'invalidFilter',
    );
  });

  it.each([
    'userName eq jdoe',
    '(userName eq "a")',
    'emails[type eq "work"].value eq "a@example.com"',
    'userName eq "a" and',
    'and userName eq "a"',
    'userName eq "a" and passwordHash pr',
    'userName eq "unterminated',
    'active eq "yes"',
    'userName',
  ])('refuses the malformed or unsupported filter %s', (filter) => {
    expect(scimTypeOf(() => scimFilterToPrismaWhereUser(filter, REALM))).toBe(
      'invalidFilter',
    );
  });
});

describe('scimFilterToPrismaWhereGroup', () => {
  it('maps displayName', () => {
    expect(
      scimFilterToPrismaWhereGroup('displayName eq "Admins"', REALM),
    ).toEqual({
      name: { equals: 'Admins', mode: 'insensitive' },
      realmId: REALM,
    });
  });

  it('maps externalId and members (Entra ID membership checks)', () => {
    expect(
      scimFilterToPrismaWhereGroup('externalId eq "grp-1"', REALM),
    ).toEqual({ scimExternalId: 'grp-1', realmId: REALM });
    expect(
      scimFilterToPrismaWhereGroup('id eq "g-1" and members eq "u-1"', REALM),
    ).toEqual({
      AND: [{ id: 'g-1' }, { userGroups: { some: { userId: 'u-1' } } }],
      realmId: REALM,
    });
    expect(
      scimFilterToPrismaWhereGroup('members.value eq "u-1"', REALM),
    ).toMatchObject({ userGroups: { some: { userId: 'u-1' } } });
    expect(
      scimTypeOf(() => scimFilterToPrismaWhereGroup('members co "u"', REALM)),
    ).toBe('invalidFilter');
  });

  it('refuses other attributes', () => {
    expect(
      scimTypeOf(() => scimFilterToPrismaWhereGroup('realmId eq "x"', REALM)),
    ).toBe('invalidFilter');
  });
});
