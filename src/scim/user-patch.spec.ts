import { getPatchOperations } from './patch-request';
import { ScimException } from './scim-errors';
import {
  applyUserPatch,
  userStateFromResource,
  type ScimUserState,
} from './user-patch';

const ENTERPRISE = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

const base: ScimUserState = {
  username: 'jdoe',
  email: 'jdoe@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  enabled: true,
  externalId: null,
  profile: {},
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

    it('reads a core schema URN key and an enterprise extension object', () => {
      expect(
        patch([
          {
            op: 'replace',
            value: {
              'urn:ietf:params:scim:schemas:core:2.0:User': {
                name: { familyName: 'Core' },
              },
              [ENTERPRISE]: { department: 'Sales' },
            },
          },
        ]),
      ).toEqual({
        ...base,
        lastName: 'Core',
        profile: { enterprise: { department: 'Sales' } },
      });
    });

    it("reads Entra ID's dotted and URN-prefixed keys in one value", () => {
      expect(
        patch([
          {
            op: 'Replace',
            value: {
              'name.givenName': 'Ada',
              displayName: 'Ada L.',
              [`${ENTERPRISE}:employeeNumber`]: '1815',
              [`${ENTERPRISE}:manager`]: 'mgr-1',
            },
          },
        ]),
      ).toEqual({
        ...base,
        firstName: 'Ada',
        profile: {
          displayName: 'Ada L.',
          enterprise: { employeeNumber: '1815', manager: 'mgr-1' },
        },
      });
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

  describe('profile attributes', () => {
    it.each([
      ['displayName', 'displayName'],
      ['title', 'title'],
      ['preferredLanguage', 'preferredLanguage'],
      ['locale', 'locale'],
      ['timezone', 'timezone'],
      ['nickName', 'nickName'],
      ['userType', 'userType'],
      ['profileUrl', 'profileUrl'],
    ])('stores and removes %s', (path, key) => {
      const set = patch([{ op: 'Replace', path, value: 'x' }]);
      expect(set.profile).toEqual({ [key]: 'x' });
      expect(patch([{ op: 'Remove', path }], set).profile).toEqual({});
    });

    it('stores externalId and clears it with remove or an empty string', () => {
      const set = patch([
        { op: 'Replace', path: 'externalId', value: 'obj-1' },
      ]);
      expect(set.externalId).toBe('obj-1');
      expect(
        patch([{ op: 'remove', path: 'externalId' }], set).externalId,
      ).toBeNull();
      expect(
        patch([{ op: 'replace', path: 'externalId', value: '' }], set)
          .externalId,
      ).toBeNull();
    });

    it('stores the name parts with no column', () => {
      const set = patch([
        { op: 'add', path: 'name.formatted', value: 'Dr Jane Doe' },
        { op: 'add', path: 'name.honorificPrefix', value: 'Dr' },
      ]);
      expect(set.profile).toEqual({
        name: { formatted: 'Dr Jane Doe', honorificPrefix: 'Dr' },
      });
      expect(patch([{ op: 'remove', path: 'name' }], set)).toEqual({
        ...base,
        firstName: null,
        lastName: null,
      });
    });

    it('refuses a non-string or over-long value', () => {
      expect(
        scimError(() => patch([{ op: 'replace', path: 'title', value: 7 }])),
      ).toEqual({ status: 400, scimType: 'invalidValue' });
      expect(
        scimError(() =>
          patch([{ op: 'replace', path: 'title', value: 'x'.repeat(2049) }]),
        ).scimType,
      ).toBe('invalidValue');
    });
  });

  describe('enterprise extension', () => {
    it('stores department and employeeNumber by URN path', () => {
      expect(
        patch([
          { op: 'Add', path: `${ENTERPRISE}:department`, value: 'Research' },
          { op: 'Add', path: `${ENTERPRISE}:employeeNumber`, value: '42' },
        ]).profile,
      ).toEqual({
        enterprise: { department: 'Research', employeeNumber: '42' },
      });
    });

    it("reads manager as Entra ID's bare id, as {value}, or as manager.value", () => {
      for (const operation of [
        { op: 'Add', path: `${ENTERPRISE}:manager`, value: 'm-1' },
        {
          op: 'replace',
          path: `${ENTERPRISE}:manager`,
          value: { value: 'm-1' },
        },
        { op: 'replace', path: `${ENTERPRISE}:manager.value`, value: 'm-1' },
      ]) {
        expect(patch([operation]).profile).toEqual({
          enterprise: { manager: 'm-1' },
        });
      }
    });

    it('clears manager with remove or an empty value', () => {
      const set = patch([
        { op: 'add', path: `${ENTERPRISE}:manager`, value: 'm-1' },
      ]);
      expect(
        patch([{ op: 'remove', path: `${ENTERPRISE}:manager` }], set).profile,
      ).toEqual({ enterprise: {} });
      expect(
        patch(
          [
            {
              op: 'replace',
              path: `${ENTERPRISE}:manager`,
              value: { value: '' },
            },
          ],
          set,
        ).profile,
      ).toEqual({ enterprise: {} });
    });

    it('takes the extension URN as the path with an object value', () => {
      expect(
        patch([{ op: 'add', path: ENTERPRISE, value: { costCenter: 'CC-1' } }])
          .profile,
      ).toEqual({ enterprise: { costCenter: 'CC-1' } });
    });

    it('refuses an unknown enterprise attribute in a PATCH', () => {
      expect(
        scimError(() =>
          patch([{ op: 'add', path: `${ENTERPRISE}:shoeSize`, value: '9' }]),
        ).scimType,
      ).toBe('invalidPath');
    });
  });

  describe('phoneNumbers and addresses', () => {
    it('creates the typed value Entra ID writes with a filter path', () => {
      const set = patch([
        {
          op: 'Add',
          path: 'phoneNumbers[type eq "work"].value',
          value: '+1 555 0100',
        },
        {
          op: 'Add',
          path: 'addresses[type eq "work"].locality',
          value: 'Seattle',
        },
        {
          op: 'Add',
          path: 'addresses[type eq "work"].postalCode',
          value: '98101',
        },
      ]);
      expect(set.profile).toEqual({
        phoneNumbers: [{ type: 'work', value: '+1 555 0100' }],
        addresses: [{ type: 'work', locality: 'Seattle', postalCode: '98101' }],
      });

      const updated = patch(
        [
          {
            op: 'Replace',
            path: 'phoneNumbers[type eq "work"].value',
            value: '+1 555 0199',
          },
          {
            op: 'Add',
            path: 'phoneNumbers[type eq "mobile"].value',
            value: '+1 555 0111',
          },
        ],
        set,
      );
      expect(updated.profile?.phoneNumbers).toEqual([
        { type: 'work', value: '+1 555 0199' },
        { type: 'mobile', value: '+1 555 0111' },
      ]);

      const removed = patch(
        [{ op: 'Remove', path: 'phoneNumbers[type eq "work"]' }],
        updated,
      );
      expect(removed.profile?.phoneNumbers).toEqual([
        { type: 'mobile', value: '+1 555 0111' },
      ]);
    });

    it('replaces the whole list, and add merges by type', () => {
      const set = patch([
        {
          op: 'replace',
          path: 'phoneNumbers',
          value: [
            { value: '1', type: 'work', primary: 'True' },
            { value: '2', type: 'home' },
          ],
        },
      ]);
      expect(set.profile?.phoneNumbers).toEqual([
        { value: '1', type: 'work', primary: true },
        { value: '2', type: 'home' },
      ]);
      expect(
        patch(
          [
            {
              op: 'add',
              path: 'phoneNumbers',
              value: [{ value: '3', type: 'home' }],
            },
          ],
          set,
        ).profile?.phoneNumbers,
      ).toEqual([
        { value: '1', type: 'work', primary: true },
        { value: '3', type: 'home' },
      ]);
      expect(
        patch([{ op: 'remove', path: 'phoneNumbers' }], set).profile,
      ).toEqual({});
    });

    it('drops a value left with nothing but its type', () => {
      const set = patch([
        { op: 'add', path: 'phoneNumbers[type eq "fax"].value', value: '9' },
      ]);
      expect(
        patch(
          [{ op: 'remove', path: 'phoneNumbers[type eq "fax"].value' }],
          set,
        ).profile,
      ).toEqual({});
    });

    it('refuses a replace whose filter matches nothing and is not an eq', () => {
      expect(
        scimError(() =>
          patch([
            {
              op: 'replace',
              path: 'phoneNumbers[value sw "+44"].type',
              value: 'work',
            },
          ]),
        ).scimType,
      ).toBe('noTarget');
    });
  });

  describe('password', () => {
    it.each([
      [{ op: 'replace', path: 'password', value: 'N3w-Passw0rd!' }],
      [
        {
          op: 'replace',
          path: 'urn:ietf:params:scim:schemas:core:2.0:User:password',
          value: 'N3w-Passw0rd!',
        },
      ],
      [{ op: 'replace', value: { password: 'N3w-Passw0rd!' } }],
      [{ op: 'Add', path: 'password', value: 'N3w-Passw0rd!' }],
    ])('sets the new password from %j', (operation) => {
      expect(patch([operation]).password).toBe('N3w-Passw0rd!');
    });

    it('cannot be removed, emptied or set to a non-string', () => {
      for (const operation of [
        { op: 'remove', path: 'password' },
        { op: 'replace', path: 'password', value: '' },
        { op: 'replace', path: 'password', value: 12345678 },
        { op: 'replace', path: 'password', value: 'x'.repeat(1025) },
      ]) {
        expect(scimError(() => patch([operation])).scimType).toBe(
          'invalidValue',
        );
      }
    });

    it('is not set when the request does not send one', () => {
      expect(
        patch([{ op: 'replace', path: 'title', value: 'x' }]).password,
      ).toBeUndefined();
    });
  });

  describe('ignored attributes', () => {
    it.each(['ims', 'photos', 'entitlements', 'roles', 'x509Certificates'])(
      'accepts %s and changes nothing',
      (path) => {
        expect(
          patch([{ op: 'Replace', path, value: [{ value: 'x' }] }]),
        ).toEqual(base);
        expect(patch([{ op: 'Remove', path }])).toEqual(base);
      },
    );
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

describe('userStateFromResource (POST / PUT bodies)', () => {
  const resource = (body: Record<string, unknown>, enabled = true) =>
    userStateFromResource(body, {
      username: String(body['userName']),
      enabled,
    });

  it('reads a full Entra ID user', () => {
    expect(
      resource({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', ENTERPRISE],
        externalId: 'obj-1',
        userName: 'ada@example.com',
        active: 'True',
        displayName: 'Ada Lovelace',
        title: 'Engineer',
        emails: [{ primary: true, type: 'work', value: 'ada@example.com' }],
        name: {
          formatted: 'Ada Lovelace',
          givenName: 'Ada',
          familyName: 'Lovelace',
        },
        phoneNumbers: [{ type: 'mobile', value: '+44 20 7946 0000' }],
        password: 'S3cret-passw0rd',
        [ENTERPRISE]: { department: 'Research', manager: { value: 'm-1' } },
      }),
    ).toEqual({
      username: 'ada@example.com',
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      enabled: true,
      externalId: 'obj-1',
      password: 'S3cret-passw0rd',
      profile: {
        displayName: 'Ada Lovelace',
        title: 'Engineer',
        name: { formatted: 'Ada Lovelace' },
        phoneNumbers: [{ type: 'mobile', value: '+44 20 7946 0000' }],
        enterprise: { department: 'Research', manager: 'm-1' },
      },
    });
  });

  it('leaves out what the body leaves out, but keeps active', () => {
    expect(resource({ userName: 'bare' }, false)).toEqual({
      username: 'bare',
      email: null,
      firstName: null,
      lastName: null,
      enabled: false,
      externalId: null,
      profile: {},
    });
  });

  it('ignores read-only and unknown attributes instead of refusing them', () => {
    expect(
      resource({
        userName: 'u',
        id: 'x',
        meta: {},
        groups: [{ value: 'g' }],
        favouriteColour: 'blue',
        'urn:example:custom:1.0:User': { a: 1 },
        'not a name!': 1,
      }),
    ).toMatchObject({ username: 'u', profile: {} });
  });

  it('still refuses a known attribute with a wrong type', () => {
    expect(
      scimError(() => resource({ userName: 'u', emails: 'a@example.com' }))
        .scimType,
    ).toBe('invalidValue');
  });
});
