import { getPatchOperations } from './patch-request';
import { ScimException } from './scim-errors';
import { applyUserPatch, type ScimUserState } from './user-patch';

const base: ScimUserState = {
  username: 'jdoe',
  email: 'jdoe@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  enabled: true,
};

/** Apply a PATCH body as a client would send it. */
const patch = (operations: unknown[], state: ScimUserState = base) =>
  applyUserPatch(state, getPatchOperations({ Operations: operations }));

function scimError(fn: () => unknown): { status: number; scimType?: string } {
  try {
    fn();
  } catch (e) {
    if (e instanceof ScimException) {
      return { status: e.getStatus(), scimType: e.scimType };
    }
    throw e;
  }
  throw new Error('expected a ScimException');
}

describe('applyUserPatch', () => {
  describe('active', () => {
    it('deactivates with Entra ID\'s {"op":"Replace","path":"active","value":"False"}', () => {
      expect(
        patch([{ op: 'Replace', path: 'active', value: 'False' }]).enabled,
      ).toBe(false);
    });

    it('accepts a JSON boolean and "True"', () => {
      expect(
        patch([{ op: 'replace', path: 'active', value: false }]).enabled,
      ).toBe(false);
      expect(
        patch([{ op: 'replace', path: 'active', value: 'True' }], {
          ...base,
          enabled: false,
        }).enabled,
      ).toBe(true);
    });

    it('deactivates with a no-path replace (Okta)', () => {
      expect(
        patch([{ op: 'replace', value: { id: 'x', active: false } }]).enabled,
      ).toBe(false);
    });

    it('refuses a non-boolean', () => {
      expect(
        scimError(() =>
          patch([{ op: 'replace', path: 'active', value: 'no' }]),
        ),
      ).toEqual({ status: 400, scimType: 'invalidValue' });
    });

    it('refuses removing it', () => {
      expect(
        scimError(() => patch([{ op: 'remove', path: 'active' }])).scimType,
      ).toBe('invalidValue');
    });
  });

  describe('simple and sub-attribute paths', () => {
    it('sets userName and name parts', () => {
      expect(
        patch([
          { op: 'replace', path: 'userName', value: 'jane.doe' },
          { op: 'replace', path: 'name.givenName', value: 'Janet' },
          { op: 'add', path: 'name.familyName', value: 'Smith' },
        ]),
      ).toEqual({
        ...base,
        username: 'jane.doe',
        firstName: 'Janet',
        lastName: 'Smith',
      });
    });

    it('matches attribute names case-insensitively', () => {
      expect(
        patch([{ op: 'replace', path: 'NAME.GIVENNAME', value: 'J' }])
          .firstName,
      ).toBe('J');
    });

    it('takes a core schema URN prefix', () => {
      expect(
        patch([
          {
            op: 'replace',
            path: 'urn:ietf:params:scim:schemas:core:2.0:User:name.familyName',
            value: 'Roe',
          },
        ]).lastName,
      ).toBe('Roe');
    });

    it('replaces only the given parts of "name"', () => {
      expect(
        patch([{ op: 'replace', path: 'name', value: { givenName: 'Ann' } }]),
      ).toEqual({ ...base, firstName: 'Ann' });
    });

    it('refuses an empty userName and removing it', () => {
      expect(
        scimError(() => patch([{ op: 'replace', path: 'userName', value: '' }]))
          .scimType,
      ).toBe('invalidValue');
      expect(
        scimError(() => patch([{ op: 'remove', path: 'userName' }])).scimType,
      ).toBe('invalidValue');
    });
  });

  describe('no-path add/replace', () => {
    it('reads dotted keys', () => {
      expect(
        patch([
          {
            op: 'Replace',
            value: { 'name.givenName': 'A', 'name.familyName': 'B' },
          },
        ]),
      ).toEqual({ ...base, firstName: 'A', lastName: 'B' });
    });

    it('reads nested objects', () => {
      expect(
        patch([
          {
            op: 'add',
            value: {
              userName: 'nested',
              name: { givenName: 'N' },
              emails: [{ value: 'n@example.com', type: 'work', primary: true }],
            },
          },
        ]),
      ).toEqual({
        ...base,
        username: 'nested',
        firstName: 'N',
        email: 'n@example.com',
      });
    });

    it('reads a core schema URN key and ignores the enterprise extension', () => {
      expect(
        patch([
          {
            op: 'replace',
            value: {
              'urn:ietf:params:scim:schemas:core:2.0:User': {
                name: { familyName: 'Core' },
              },
              'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': {
                department: 'Sales',
              },
            },
          },
        ]),
      ).toEqual({ ...base, lastName: 'Core' });
    });

    it('needs an object value', () => {
      expect(
        scimError(() => patch([{ op: 'replace', value: 'x' }])).scimType,
      ).toBe('invalidValue');
    });
  });

  describe('emails', () => {
    it('sets the email through emails[type eq "work"].value', () => {
      expect(
        patch([
          {
            op: 'replace',
            path: 'emails[type eq "work"].value',
            value: 'new@example.com',
          },
        ]).email,
      ).toBe('new@example.com');
    });

    it('adds the work email when the user has none', () => {
      expect(
        patch(
          [
            {
              op: 'Add',
              path: 'emails[type eq "work"].value',
              value: 'first@example.com',
            },
          ],
          { ...base, email: null },
        ).email,
      ).toBe('first@example.com');
    });

    it('selects the stored email by primary or value', () => {
      expect(
        patch([
          {
            op: 'replace',
            path: 'emails[primary eq true].value',
            value: 'p@example.com',
          },
        ]).email,
      ).toBe('p@example.com');
      expect(
        patch([{ op: 'remove', path: 'emails[value eq "JDOE@example.com"]' }])
          .email,
      ).toBeNull();
    });

    it('ignores a filter for an email kind that is not stored', () => {
      expect(
        patch([
          {
            op: 'replace',
            path: 'emails[type eq "home"].value',
            value: 'home@example.com',
          },
        ]).email,
      ).toBe('jdoe@example.com');
      expect(
        patch([{ op: 'remove', path: 'emails[value eq "other@example.com"]' }])
          .email,
      ).toBe('jdoe@example.com');
    });

    it('sets the primary email from a list, or the first one', () => {
      expect(
        patch([
          {
            op: 'replace',
            path: 'emails',
            value: [
              { value: 'a@example.com' },
              { value: 'b@example.com', primary: 'True' },
            ],
          },
        ]).email,
      ).toBe('b@example.com');
      expect(
        patch([
          { op: 'add', path: 'emails', value: [{ value: 'c@example.com' }] },
        ]).email,
      ).toBe('c@example.com');
    });

    it('clears the email on remove', () => {
      expect(patch([{ op: 'remove', path: 'emails' }]).email).toBeNull();
      expect(
        patch([{ op: 'remove', path: 'emails[type eq "work"]' }]).email,
      ).toBeNull();
    });
  });

  describe('remove', () => {
    it('clears name parts and the whole name', () => {
      expect(patch([{ op: 'remove', path: 'name.givenName' }]).firstName).toBe(
        null,
      );
      expect(patch([{ op: 'remove', path: 'name' }])).toEqual({
        ...base,
        firstName: null,
        lastName: null,
      });
    });
  });

  describe('attributes with no column', () => {
    it.each([
      'displayName',
      'title',
      'preferredLanguage',
      'locale',
      'timezone',
      'externalId',
      'phoneNumbers[type eq "mobile"].value',
      'addresses[type eq "work"].locality',
      'name.formatted',
      'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department',
      'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager',
    ])('accepts %s and changes nothing', (path) => {
      expect(patch([{ op: 'Replace', path, value: 'x' }])).toEqual(base);
      expect(patch([{ op: 'Remove', path }])).toEqual(base);
    });
  });

  describe('invalid paths', () => {
    it.each([
      'notAnAttribute',
      'name.nickname',
      'emails.foo',
      'userName[value eq "x"]',
      'active.value',
      'urn:example:custom:1.0:User:thing',
      'passwordHash',
      'realmId',
    ])('refuses %s with invalidPath', (path) => {
      expect(
        scimError(() => patch([{ op: 'replace', path, value: 'x' }])),
      ).toEqual({ status: 400, scimType: 'invalidPath' });
    });

    it('refuses read-only attributes with mutability', () => {
      expect(
        scimError(() => patch([{ op: 'replace', path: 'id', value: 'x' }]))
          .scimType,
      ).toBe('mutability');
      expect(
        scimError(() => patch([{ op: 'add', path: 'groups', value: [] }]))
          .scimType,
      ).toBe('mutability');
    });

    it('applies nothing when a later operation fails', () => {
      const state = { ...base };
      expect(() =>
        applyUserPatch(
          state,
          getPatchOperations({
            Operations: [
              { op: 'replace', path: 'active', value: false },
              { op: 'replace', path: 'bogus', value: 1 },
            ],
          }),
        ),
      ).toThrow(ScimException);
      expect(state).toEqual(base);
    });
  });
});
