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
    'externalId eq "x"',
    '__proto__ eq "x"',
  ])('refuses the unsupported attribute in %s', (filter) => {
    expect(scimTypeOf(() => scimFilterToPrismaWhereUser(filter, REALM))).toBe(
      'invalidFilter',
    );
  });

  it.each([
    'userName eq "a" and active eq true',
    'userName eq jdoe',
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

  it('refuses other attributes', () => {
    expect(
      scimTypeOf(() => scimFilterToPrismaWhereGroup('realmId eq "x"', REALM)),
    ).toBe('invalidFilter');
  });
});
