import { readFileSync } from 'fs';
import { join } from 'path';
import { KeycloakImporterService } from './keycloak-importer.service.js';
import type { KeycloakRealmExport } from './keycloak-types.js';
import { makeFakeIdp } from '../broker/saml/__mocks__/fake-saml-idp.js';

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

  it('skips an incomplete SAML provider, and says why', async () => {
    const report = await service.importRealm(fixture, { dryRun: false });

    // The fixture's provider has Keycloak's own (SP) entityId but no
    // idpEntityId, and a truncated certificate.
    expect(created().has('corp-saml')).toBe(false);
    const warning = warningFor(report, 'corp-saml');
    expect(warning).toMatch(
      /was not imported: the export's SAML settings are incomplete or unusable/,
    );
    expect(warning).toMatch(
      /samlConfig.entityId \(the IdP entity ID\) is required/,
    );
    expect(warning).toMatch(/signingCertificates\[0\]/);
  });

  it('imports a complete SAML provider with its settings and attribute mappers', async () => {
    const idp = await makeFakeIdp('https://sso.corp.example/idp');
    const certs = [idp, await makeFakeIdp()].map((i) =>
      i.certificatePem.replace(/-----[A-Z ]+-----|\s/g, ''),
    );
    const realm = {
      ...fixture,
      identityProviders: [
        {
          alias: 'okta-saml',
          providerId: 'saml',
          enabled: true,
          trustEmail: true,
          displayName: 'Okta',
          config: {
            entityId: 'https://keycloak.corp.example/realms/corp',
            idpEntityId: 'https://sso.corp.example/idp',
            singleSignOnServiceUrl: 'https://sso.corp.example/sso',
            singleLogoutServiceUrl: 'https://sso.corp.example/slo',
            signingCertificate: certs.join(','),
            nameIDPolicyFormat:
              'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
            postBindingAuthnRequest: 'true',
            wantAuthnRequestsSigned: 'true',
            wantAssertionsSigned: 'true',
            validateSignature: 'true',
            wantAssertionsEncrypted: 'true',
            allowedClockSkew: '30',
            principalType: 'ATTRIBUTE',
            principalAttribute: 'uid',
          },
        },
      ],
      identityProviderMappers: [
        {
          name: 'mail',
          identityProviderAlias: 'okta-saml',
          identityProviderMapper: 'saml-user-attribute-idp-mapper',
          config: { 'attribute.name': 'mail', 'user.attribute': 'email' },
        },
        {
          name: 'given',
          identityProviderAlias: 'okta-saml',
          identityProviderMapper: 'saml-user-attribute-idp-mapper',
          config: {
            'attribute.name': 'givenName',
            'user.attribute': 'firstName',
          },
        },
        {
          name: 'other-provider',
          identityProviderAlias: 'someone-else',
          identityProviderMapper: 'saml-user-attribute-idp-mapper',
          config: { 'attribute.name': 'sn', 'user.attribute': 'lastName' },
        },
      ],
    } as KeycloakRealmExport;
    const report = await service.importRealm(realm, { dryRun: false });

    const stored = created().get('okta-saml');
    expect(stored).toMatchObject({
      providerType: 'saml',
      enabled: true,
      trustEmail: true,
      clientId: '',
      authorizationUrl: '',
      tokenUrl: '',
    });
    expect(stored.samlConfig).toMatchObject({
      entityId: 'https://sso.corp.example/idp',
      ssoUrl: 'https://sso.corp.example/sso',
      ssoBinding: 'post',
      sloUrl: 'https://sso.corp.example/slo',
      nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
      signAuthnRequests: true,
      wantAssertionsSigned: true,
      clockSkewSeconds: 30,
      subjectAttribute: 'uid',
      attributes: { email: 'mail', firstName: 'givenName' },
    });
    expect(stored.samlConfig.signingCertificates).toHaveLength(2);
    expect(warningFor(report, 'okta-saml')).toMatch(
      /imported as a SAML identity provider.*register Idenplane's SP metadata/,
    );
    expect(
      report.warnings.some((w: { message: string }) =>
        /expected encrypted assertions/.test(w.message),
      ),
    ).toBe(true);
  });

  it('skips a provider type it cannot broker instead of storing it as OIDC', async () => {
    const report = await service.importRealm(fixture, { dryRun: false });

    expect(created().has('gitlab')).toBe(false);
    expect(warningFor(report, 'gitlab')).toMatch(
      /provider type 'gitlab' is not supported \(supported: oidc, oauth2, saml\)/,
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
