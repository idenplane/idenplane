import {
  coerceScimBoolean,
  getPatchOperations,
  parseCompareValue,
  parsePatchPath,
} from './patch-request';
import { ScimException } from './scim-errors';

function scimTypeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof ScimException) return e.scimType;
    throw e;
  }
  throw new Error('expected a ScimException');
}

describe('getPatchOperations', () => {
  it('reads the RFC 7644 "Operations" list', () => {
    expect(
      getPatchOperations({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'active', value: false }],
      }),
    ).toEqual([{ op: 'replace', path: 'active', value: false }]);
  });

  it('still reads lowercase "operations"', () => {
    expect(
      getPatchOperations({ operations: [{ op: 'add', value: { a: 1 } }] }),
    ).toEqual([{ op: 'add', path: undefined, value: { a: 1 } }]);
  });

  it('prefers "Operations" when both are present', () => {
    const ops = getPatchOperations({
      Operations: [{ op: 'remove', path: 'emails' }],
      operations: [{ op: 'add', value: {} }],
    });
    expect(ops.map((o) => o.op)).toEqual(['remove']);
  });

  it('matches op names case-insensitively (Entra ID sends "Replace")', () => {
    const ops = getPatchOperations({
      Operations: [
        { op: 'Replace', path: 'active', value: 'False' },
        { op: 'ADD', path: 'title', value: 'x' },
        { op: 'Remove', path: 'emails' },
      ],
    });
    expect(ops.map((o) => o.op)).toEqual(['replace', 'add', 'remove']);
  });

  it('refuses a body without an operations list', () => {
    expect(scimTypeOf(() => getPatchOperations({}))).toBe('invalidSyntax');
    expect(scimTypeOf(() => getPatchOperations(undefined))).toBe(
      'invalidSyntax',
    );
    expect(scimTypeOf(() => getPatchOperations({ Operations: {} }))).toBe(
      'invalidSyntax',
    );
  });

  it('refuses an unknown op', () => {
    expect(
      scimTypeOf(() =>
        getPatchOperations({ Operations: [{ op: 'move', path: 'a' }] }),
      ),
    ).toBe('invalidSyntax');
  });

  it('refuses a remove with no path (noTarget)', () => {
    expect(
      scimTypeOf(() => getPatchOperations({ Operations: [{ op: 'remove' }] })),
    ).toBe('noTarget');
  });
});

describe('parsePatchPath', () => {
  it('parses a simple attribute, lowercased', () => {
    expect(parsePatchPath('userName')).toEqual({
      schema: undefined,
      attribute: 'username',
      filter: undefined,
      subAttribute: undefined,
    });
  });

  it('parses a sub-attribute', () => {
    expect(parsePatchPath('name.givenName')).toMatchObject({
      attribute: 'name',
      subAttribute: 'givenname',
    });
  });

  it('parses a value filter with a sub-attribute', () => {
    expect(parsePatchPath('emails[type eq "work"].value')).toEqual({
      schema: undefined,
      attribute: 'emails',
      filter: { attribute: 'type', operator: 'eq', value: 'work' },
      subAttribute: 'value',
    });
  });

  it('parses a member filter with double or single quotes', () => {
    expect(parsePatchPath('members[value eq "a-b-c"]').filter).toEqual({
      attribute: 'value',
      operator: 'eq',
      value: 'a-b-c',
    });
    expect(parsePatchPath("members[value eq 'a-b-c']").filter?.value).toBe(
      'a-b-c',
    );
  });

  it('keeps "]" and ":" inside a quoted filter value', () => {
    expect(parsePatchPath('emails[value eq "a]b:c"]').filter?.value).toBe(
      'a]b:c',
    );
  });

  it('splits off a schema URN prefix', () => {
    expect(
      parsePatchPath(
        'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department',
      ),
    ).toMatchObject({
      schema: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:user',
      attribute: 'department',
    });
    expect(
      parsePatchPath(
        'urn:ietf:params:scim:schemas:core:2.0:User:name.givenName',
      ),
    ).toMatchObject({
      schema: 'urn:ietf:params:scim:schemas:core:2.0:user',
      attribute: 'name',
      subAttribute: 'givenname',
    });
  });

  it.each([
    '',
    '.name',
    'name.',
    'emails[type eq "work"',
    'emails[type]',
    'emails[type foo "work"]',
    'emails[type eq work]',
    'emails[type eq "a" and value eq "b"]',
    'name givenName',
    'a.b.c',
  ])('refuses the malformed path %j', (path) => {
    expect(scimTypeOf(() => parsePatchPath(path))).toBe('invalidPath');
  });

  it('parses a long hostile path in linear time', () => {
    const hostile = 'emails[type eq "' + '\\"'.repeat(400) + ']';
    const start = Date.now();
    expect(scimTypeOf(() => parsePatchPath(hostile))).toBe('invalidPath');
    expect(Date.now() - start).toBeLessThan(200);
  });
});

describe('parseCompareValue', () => {
  it('reads JSON strings, numbers, booleans and null', () => {
    expect(parseCompareValue('"a b"')).toBe('a b');
    expect(parseCompareValue('"say \\"hi\\""')).toBe('say "hi"');
    expect(parseCompareValue('42')).toBe(42);
    expect(parseCompareValue('true')).toBe(true);
    expect(parseCompareValue('null')).toBeNull();
  });

  it('refuses anything that is not exactly one value', () => {
    expect(parseCompareValue('"a" and b eq "c"')).toBeUndefined();
    expect(parseCompareValue('bare')).toBeUndefined();
  });
});

describe('coerceScimBoolean', () => {
  it.each([
    [true, true],
    [false, false],
    ['True', true],
    ['False', false],
    ['false', false],
    [' TRUE ', true],
  ])('reads %j as %j', (input, expected) => {
    expect(coerceScimBoolean(input, 'active')).toBe(expected);
  });

  it.each(['yes', 0, 1, null, {}])('refuses %j', (input) => {
    expect(scimTypeOf(() => coerceScimBoolean(input, 'active'))).toBe(
      'invalidValue',
    );
  });
});
