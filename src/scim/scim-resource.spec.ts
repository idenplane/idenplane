import { projectResource, projectionIncludes } from './scim-resource';

const CORE = 'urn:ietf:params:scim:schemas:core:2.0:User';
const ENTERPRISE = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
const URNS = [CORE, ENTERPRISE];
const ALWAYS = ['schemas', 'id', 'meta', 'userName'];

const user = () => ({
  schemas: [CORE, ENTERPRISE],
  id: 'u-1',
  userName: 'ada',
  name: { givenName: 'Ada', familyName: 'Lovelace' },
  emails: [
    { value: 'a@example.com', type: 'work', primary: true },
    { value: 'b@example.com', type: 'home' },
  ],
  active: true,
  [ENTERPRISE]: { department: 'Research', manager: { value: 'm-1' } },
  meta: { resourceType: 'User' },
});

describe('projectResource', () => {
  it('returns the resource unchanged with no projection', () => {
    const resource = user();
    expect(projectResource(resource, {}, URNS, ALWAYS)).toBe(resource);
  });

  it('keeps only the asked attributes and the always-returned ones', () => {
    expect(
      projectResource(user(), { attributes: ['active'] }, URNS, ALWAYS),
    ).toEqual({
      schemas: [CORE, ENTERPRISE],
      id: 'u-1',
      userName: 'ada',
      active: true,
      meta: { resourceType: 'User' },
    });
  });

  it('reads sub-attributes of multi-valued attributes, in any case', () => {
    const out = projectResource(
      user(),
      { attributes: ['EMAILS.value', 'emails.type'] },
      URNS,
      ALWAYS,
    ) as ReturnType<typeof user>;
    expect(out.emails).toEqual([
      { value: 'a@example.com', type: 'work' },
      { value: 'b@example.com', type: 'home' },
    ]);
  });

  it('reads core and extension URN-prefixed names', () => {
    const out = projectResource(
      user(),
      {
        attributes: [`${CORE}:name.familyName`, `${ENTERPRISE}:manager.value`],
      },
      URNS,
      ALWAYS,
    ) as ReturnType<typeof user>;
    expect(out.name).toEqual({ familyName: 'Lovelace' });
    expect(out[ENTERPRISE]).toEqual({ manager: { value: 'm-1' } });
  });

  it('removes excluded attributes but never the always-returned ones', () => {
    const resource = user();
    const out = projectResource(
      resource,
      { excludedAttributes: ['emails', 'id', 'name.givenName', ENTERPRISE] },
      URNS,
      ALWAYS,
    ) as Partial<ReturnType<typeof user>>;
    expect(out).not.toHaveProperty('emails');
    expect(out).not.toHaveProperty(ENTERPRISE);
    expect(out.name).toEqual({ familyName: 'Lovelace' });
    expect(out.id).toBe('u-1');
    // The original is not modified.
    expect(resource.emails).toHaveLength(2);
  });

  it('ignores prototype-like names', () => {
    const out = projectResource(
      user(),
      { attributes: ['__proto__.polluted', 'constructor'] },
      URNS,
      ALWAYS,
    );
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(Object.keys(out).sort()).toEqual(
      ['id', 'meta', 'schemas', 'userName'].sort(),
    );
  });
});

describe('projectionIncludes', () => {
  it('tells whether members are needed', () => {
    expect(projectionIncludes({}, 'members')).toBe(true);
    expect(
      projectionIncludes({ excludedAttributes: ['Members'] }, 'members'),
    ).toBe(false);
    expect(projectionIncludes({ attributes: ['displayName'] }, 'members')).toBe(
      false,
    );
    expect(
      projectionIncludes({ attributes: ['members.value'] }, 'members'),
    ).toBe(true);
    expect(
      projectionIncludes(
        { attributes: ['urn:ietf:params:scim:schemas:core:2.0:Group:members'] },
        'members',
      ),
    ).toBe(true);
  });
});
