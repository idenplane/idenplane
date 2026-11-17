import { readFileSync } from 'fs';
import { join } from 'path';
import { KeycloakImporterService } from './keycloak-importer.service.js';
import type { KeycloakRealmExport } from './keycloak-types.js';

/**
 * Identity providers from a Keycloak realm export
 * (__fixtures__/keycloak-identity-providers.json): only ones the broker can
 * use are stored, each with every field it needs; the rest are skipped and
 * named in the report.
 */
describe('KeycloakImporterService identity providers', () => {
  const fixture = JSON.parse(
    readFileSync(
      join(__dirname, '__fixtures__', 'keycloak-identity-providers.json'),
      'utf8',
    ),
  ) as KeycloakRealmExport;

  let prisma: any;
  let service: KeycloakImporterService;

  beforeEach(() => {
    prisma = {
      realm: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'realm-1' }),
      },
      identityProvider: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn((cb: (tx: any) => Promise<any>) => cb(prisma)),
    };
    const crypto = {
      encryptSecret: jest.fn((v: string) => (v ? `sealed:${v}` : v)),
    };
    service = new KeycloakImporterService(prisma, crypto as any);
  });

  const created = () =>
    new Map<string, any>(
      prisma.identityProvider.create.mock.calls.map((c: any[]) => [
        c[0].data.alias,
        c[0].data,
      ]),
    );
  const warningFor = (report: any, alias: string) =>
    report.warnings.find((w: { message: string }) =>
      w.message.startsWith(`Identity provider '${alias}'`),
    )?.message as string | undefined;

  it('stores a generic OIDC provider with every broker field', async () => {
    await service.importRealm(fixture, { dryRun: false });

    expect(created().get('corp-oidc')).toEqual({
      realmId: 'realm-1',
      alias: 'corp-oidc',
      displayName: 'Corporate SSO',
      trustEmail: true,
      providerType: 'oidc',
      enabled: true,
      clientId: 'corp-client',
      clientSecret: 'sealed:corp-secret',
      authorizationUrl: 'https://sso.corp.example/auth',
      tokenUrl: 'https://sso.corp.example/token',
      userinfoUrl: 'https://sso.corp.example/userinfo',
      jwksUrl: 'https://sso.corp.example/certs',
      issuer: 'https://sso.corp.example',
      defaultScopes: 'openid email',
    });
  });

  it('fills the fixed endpoints of a Google provider, whose export has none', async () => {
    await service.importRealm(fixture, { dryRun: false });

    expect(created().get('google')).toMatchObject({
      providerType: 'oidc',
      enabled: true,
      clientId: 'goog-123',
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      userinfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    });
  });

  it('imports a provider whose secret Keycloak masked, disabled, with a warning', async () => {
    const report = await service.importRealm(fixture, { dryRun: false });

    expect(created().get('github')).toMatchObject({
      providerType: 'oauth2',
      enabled: false,
      clientSecret: '',
      authorizationUrl: 'https://github.com/login/oauth/authorize',
    });
    expect(warningFor(report, 'github')).toMatch(/no client secret/);
  });

  it('never stores a SAML provider, and says why', async () => {
    const report = await service.importRealm(fixture, { dryRun: false });

    expect(created().has('corp-saml')).toBe(false);
    expect(warningFor(report, 'corp-saml')).toMatch(
      /was not imported: provider type 'saml' is SAML, and Idenplane cannot sign users in through a SAML identity provider/,
    );
  });

  it('skips a provider type it cannot broker instead of storing it as OIDC', async () => {
    const report = await service.importRealm(fixture, { dryRun: false });

    expect(created().has('gitlab')).toBe(false);
    expect(warningFor(report, 'gitlab')).toMatch(
      /provider type 'gitlab' is not supported \(supported: oidc, oauth2\)/,
    );
  });

  it('skips an OIDC provider missing an endpoint the broker needs', async () => {
    const report = await service.importRealm(fixture, { dryRun: false });

    expect(created().has('half-oidc')).toBe(false);
    expect(warningFor(report, 'half-oidc')).toMatch(/no usable tokenUrl/);
  });

  it('counts the same way in a dry run and a real import', async () => {
    const real = await service.importRealm(fixture, { dryRun: false });
    prisma.identityProvider.create.mockClear();
    const dry = await service.importRealm(fixture, { dryRun: true });

    const expected = { created: 3, skipped: 3, failed: 0 };
    expect(real.summary.identityProviders).toEqual(expected);
    expect(dry.summary.identityProviders).toEqual(expected);
    expect(prisma.identityProvider.create).not.toHaveBeenCalled();
    expect(dry.warnings.map((w) => w.message).sort()).toEqual(
      real.warnings.map((w) => w.message).sort(),
    );
  });
});
