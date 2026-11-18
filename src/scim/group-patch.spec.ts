import { planGroupPatch } from './group-patch';
import { getPatchOperations } from './patch-request';
import { ScimException } from './scim-errors';

const plan = (operations: unknown[]) =>
  planGroupPatch(getPatchOperations({ Operations: operations }));

function scimTypeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof ScimException) return e.scimType;
    throw e;
  }
  throw new Error('expected a ScimException');
}

describe('planGroupPatch', () => {
  it('adds members (Entra ID and Okta)', () => {
    expect(
      plan([
        {
          op: 'Add',
          path: 'members',
          value: [{ value: 'u1' }, { value: 'u2', display: 'U 2' }],
        },
      ]),
    ).toEqual({ members: [{ kind: 'add', userIds: ['u1', 'u2'] }] });
  });

  it('removes a member by filter (Okta), with double or single quotes', () => {
    expect(plan([{ op: 'remove', path: 'members[value eq "u1"]' }])).toEqual({
      members: [{ kind: 'remove', userIds: ['u1'] }],
    });
    expect(plan([{ op: 'Remove', path: "members[value eq 'u2']" }])).toEqual({
      members: [{ kind: 'remove', userIds: ['u2'] }],
    });
  });

  it('removes members listed in the value (Entra ID)', () => {
    expect(
      plan([{ op: 'Remove', path: 'members', value: [{ value: 'u1' }] }]),
    ).toEqual({ members: [{ kind: 'remove', userIds: ['u1'] }] });
  });

  it('clears all members on remove of "members" with no value', () => {
    expect(plan([{ op: 'remove', path: 'members' }])).toEqual({
      members: [{ kind: 'clear' }],
    });
  });

  it('sets the members on replace', () => {
    expect(
      plan([{ op: 'replace', path: 'members', value: [{ value: 'u3' }] }]),
    ).toEqual({ members: [{ kind: 'set', userIds: ['u3'] }] });
  });

  it('renames with a path or a no-path value', () => {
    expect(
      plan([{ op: 'Replace', path: 'displayName', value: 'Admins' }]),
    ).toEqual({ displayName: 'Admins', members: [] });
    expect(
      plan([
        {
          op: 'replace',
          value: { id: 'g1', displayName: 'Ops', members: [{ value: 'u1' }] },
        },
      ]),
    ).toEqual({
      displayName: 'Ops',
      members: [{ kind: 'set', userIds: ['u1'] }],
    });
  });

  it('sets and removes externalId', () => {
    expect(plan([{ op: 'replace', path: 'externalId', value: 'x' }])).toEqual({
      members: [],
      externalId: 'x',
    });
    expect(plan([{ op: 'remove', path: 'externalId' }])).toEqual({
      members: [],
      externalId: null,
    });
  });

  it.each([
    'members[display eq "x"]',
    'members[value ne "x"]',
    'members[value eq ""]',
    'members.display',
    'owners',
    'urn:ietf:params:scim:schemas:core:2.0:User:members',
  ])('refuses the path %s', (path) => {
    expect(scimTypeOf(() => plan([{ op: 'remove', path }]))).toBe(
      'invalidPath',
    );
  });

  it('refuses members without a string value', () => {
    expect(
      scimTypeOf(() =>
        plan([{ op: 'add', path: 'members', value: [{ id: 'u1' }] }]),
      ),
    ).toBe('invalidValue');
  });

  it('refuses removing or emptying displayName', () => {
    expect(
      scimTypeOf(() => plan([{ op: 'remove', path: 'displayName' }])),
    ).toBe('invalidValue');
    expect(
      scimTypeOf(() =>
        plan([{ op: 'replace', path: 'displayName', value: ' ' }]),
      ),
    ).toBe('invalidValue');
  });

  it('parses a hostile member filter in linear time', () => {
    const hostile =
      'members[value eq "' + 'a'.repeat(900) + '"' + ' '.repeat(100);
    const start = Date.now();
    expect(scimTypeOf(() => plan([{ op: 'remove', path: hostile }]))).toBe(
      'invalidPath',
    );
    expect(Date.now() - start).toBeLessThan(200);
  });
});
