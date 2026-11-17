import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  authentikExportProblems,
  authentikNonPersonReason,
  authentikRedirectUris,
  authentikSourceAlias,
  issuerFromWellKnownUrl,
  normalizeEmail,
  slugify,
  unwrapAuthentikExport,
} from './authentik-export.js';
import { AuthentikImportDto } from './migration.controller.js';

describe('authentikExportProblems', () => {
  it('accepts plain lists, paginated responses and missing sections', () => {
    expect(
      authentikExportProblems({
        users: [{ username: 'a' }],
        groups: { pagination: { next: 0 }, results: [{ name: 'g' }] },
      }),
    ).toEqual([]);
    expect(authentikExportProblems({})).toEqual([]);
  });

  it('names each section that is not a list', () => {
    expect(
      authentikExportProblems({
        users: { username: 'a' },
        providers: 'x',
        sources: [1],
      }),
    ).toEqual([
      'data.users must be an array, or an Authentik paginated response with a "results" array',
      'data.providers must be an array, or an Authentik paginated response with a "results" array',
      'data.sources[0] must be an object',
    ]);
  });
});

describe('AuthentikImportDto', () => {
  const errors = async (body: unknown) =>
    (await validate(plainToInstance(AuthentikImportDto, body))).flatMap((e) =>
      Object.values(e.constraints ?? {}),
    );

  it('refuses a section that is not a list, with a message naming it', async () => {
    await expect(
      errors({ data: { users: { results: 'nope' } }, targetRealm: 'r' }),
    ).resolves.toEqual([
      'data.users must be an array, or an Authentik paginated response with a "results" array',
    ]);
  });

  it('accepts raw paginated API responses', async () => {
    await expect(
      errors({
        data: { users: { pagination: {}, results: [{ username: 'a' }] } },
        targetRealm: 'r',
      }),
    ).resolves.toEqual([]);
  });
});

describe('unwrapAuthentikExport', () => {
  it('turns every section into a plain list', () => {
    expect(
      unwrapAuthentikExport({
        users: { pagination: {}, results: [{ username: 'a' }] },
        groups: [{ name: 'g' }],
      }),
    ).toEqual({
      users: [{ username: 'a' }],
      groups: [{ name: 'g' }],
      providers: [],
      sources: [],
    });
  });
});

describe('normalizeEmail', () => {
  it.each([
    ['', null],
    ['   ', null],
    [null, null],
    [undefined, null],
    [' a@example.com ', 'a@example.com'],
  ])('%p -> %p', (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });
});

describe('authentikNonPersonReason', () => {
  it.each([
    [{ username: 'x', type: 'service_account' }, true],
    [{ username: 'x', type: 'internal_service_account' }, true],
    [
      {
        username: 'x',
        attributes: { 'goauthentik.io/user/service-account': true },
      },
      true,
    ],
    [{ username: 'ak-outpost-1' }, true],
    [{ username: 'AnonymousUser' }, true],
    [{ username: 'alice', type: 'internal' }, false],
    [{ username: 'guest', type: 'external' }, false],
  ])('%j -> skipped=%p', (user, skipped) => {
    expect(authentikNonPersonReason({ pk: 1, ...user }) !== null).toBe(skipped);
  });
});

describe('authentikRedirectUris', () => {
  it('reads a newline-separated string and leaves out regex-looking lines', () => {
    expect(
      authentikRedirectUris(
        'https://a.example/cb\r\n\nhttps://.*\\.example/cb\nhttps://a.example/cb',
      ),
    ).toEqual({
      uris: ['https://a.example/cb'],
      skipped: [
        {
          url: 'https://.*\\.example/cb',
          reason:
            'it looks like a regular expression, and Idenplane matches redirect URIs exactly',
        },
      ],
    });
  });

  it('reads strict entries and leaves out regex and unknown modes', () => {
    const plan = authentikRedirectUris([
      { matching_mode: 'strict', url: 'https://a.example/cb' },
      { matching_mode: 'regex', url: 'https://b.example/.*' },
      { matching_mode: 'glob', url: 'https://c.example/*' },
      { url: 'myapp://callback' },
    ]);
    expect(plan.uris).toEqual(['https://a.example/cb', 'myapp://callback']);
    expect(plan.skipped.map((s) => s.url)).toEqual([
      'https://b.example/.*',
      'https://c.example/*',
    ]);
  });

  it('reads a list of strings and leaves out entries that are not URLs', () => {
    expect(authentikRedirectUris(['https://a.example/cb', 'cb'])).toEqual({
      uris: ['https://a.example/cb'],
      skipped: [{ url: 'cb', reason: 'it is not an absolute URL' }],
    });
  });

  it('treats a missing value as no redirect URIs', () => {
    expect(authentikRedirectUris(undefined)).toEqual({
      uris: [],
      skipped: [],
    });
  });
});

describe('authentikSourceAlias', () => {
  it.each([
    [{ slug: 'corp-sso', name: 'Corporate SSO' }, 'corp-sso'],
    [{ slug: 'Corp_SSO', name: 'x' }, 'corp-sso'],
    [{ name: 'Partner Login' }, 'partner-login'],
    [{ name: 'Café Login' }, 'cafe-login'],
    [{ name: '!!!' }, null],
  ])('%j -> %p', (source, alias) => {
    expect(authentikSourceAlias({ pk: 1, ...source })).toBe(alias);
  });

  it('slugify trims a long run of hyphens in linear time', () => {
    const started = Date.now();
    expect(slugify('-'.repeat(200_000) + 'a' + '-'.repeat(200_000))).toBe('a');
    expect(slugify('-'.repeat(200_000))).toBe('');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('slugify keeps only lowercase letters, digits and single hyphens', () => {
    expect(slugify('  My  IdP (EU) ')).toBe('my-idp-eu');
  });
});

describe('issuerFromWellKnownUrl', () => {
  it('strips the discovery suffix', () => {
    expect(
      issuerFromWellKnownUrl(
        'https://login.example/tenant/.well-known/openid-configuration',
      ),
    ).toBe('https://login.example/tenant');
  });

  it.each([null, undefined, '', 'https://login.example/jwks'])(
    '%p -> null',
    (url) => {
      expect(issuerFromWellKnownUrl(url)).toBeNull();
    },
  );
});
