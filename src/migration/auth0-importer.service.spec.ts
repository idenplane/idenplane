import { Test } from '@nestjs/testing';
import { makeFakeIdp } from '../broker/saml/__mocks__/fake-saml-idp.js';
import { Auth0ImporterService } from './auth0-importer.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import type { Auth0Export } from './auth0-types.js';

describe('Auth0ImporterService', () => {
  let service: Auth0ImporterService;
  let prisma: any;

  const mockAuth0Export: Auth0Export = {
    users: [
      {
        user_id: 'auth0|123',
        email: 'alice@example.com',
        email_verified: true,
        given_name: 'Alice',
        family_name: 'Smith',
        password_hash:
          '$2b$04$XmzY2qBKv0SBOsetdHF1sOwH1wnNPx2DbYFMo1ix6d49ueEoxKCLS',
      },
      {
        user_id: 'auth0|456',
        email: 'bob@example.com',
        blocked: true,
      },
    ],
    clients: [
      {
        client_id: 'spa-app',
        name: 'SPA App',
        callbacks: ['http://localhost:3000/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_method: 'none',
      },
      {
        client_id: 'api-service',
        name: 'API Service',
        client_secret: 'super-secret',
        grant_types: ['client_credentials'],
      },
      {
        client_id: 'device-app',
        name: 'Device App',
        grant_types: ['urn:ietf:params:oauth:grant-type:device_code'],
        token_endpoint_auth_method: 'none',
      },
    ],
    roles: [
      { name: 'admin', description: 'Admin role' },
      { name: 'viewer', description: 'Viewer role' },
    ],
    connections: [
      { name: 'Username-Password-Authentication', strategy: 'auth0' },
      {
        name: 'google-social',
        strategy: 'google-oauth2',
        options: { client_id: 'goog-id', client_secret: 'goog-secret' },
      },
    ],
    organizations: [{ name: 'acme-corp', display_name: 'ACME Corp' }],
  };

  beforeEach(async () => {
    prisma = {
      realm: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'realm-1', name: 'test' }),
      },
      role: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'r-1' }),
      },
      client: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'c-1' }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'u-1' }),
      },
      identityProvider: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'idp-1' }),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        Auth0ImporterService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: CryptoService,
          useValue: {
            hashPassword: jest.fn().mockResolvedValue('hashed'),
            hashSecret: jest.fn().mockResolvedValue('hashed'),
            encryptSecret: jest.fn((v: string) => (v ? `sealed:${v}` : v)),
          },
        },
      ],
    }).compile();

    service = module.get(Auth0ImporterService);
  });

  it('should fail if realm does not exist', async () => {
    prisma.realm.findUnique.mockResolvedValue(null);
    const report = await service.importData(mockAuth0Export, {
      dryRun: false,
      targetRealm: 'nonexistent',
    });
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].error).toContain('does not exist');
  });

  it('should import users with bcrypt password hash', async () => {
    const report = await service.importData(mockAuth0Export, {
      dryRun: false,
      targetRealm: 'test',
    });
    expect(report.summary.users.created).toBe(2);
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          username: 'alice@example.com',
          passwordAlgorithm: 'bcrypt',
          enabled: true,
        }),
      }),
    );
    // Bob is blocked
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          username: 'bob@example.com',
          enabled: false,
        }),
      }),
    );
  });

  it('should import clients with correct types', async () => {
    const report = await service.importData(mockAuth0Export, {
      dryRun: false,
      targetRealm: 'test',
    });
    expect(report.summary.clients.created).toBe(3);
    // SPA is public
    expect(prisma.client.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'spa-app',
          clientType: 'PUBLIC',
        }),
      }),
    );
    // API service is confidential
    expect(prisma.client.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'api-service',
          clientType: 'CONFIDENTIAL',
        }),
      }),
    );
    // Device app has the full URN grant type so auth service validation passes
    expect(prisma.client.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'device-app',
          grantTypes: ['urn:ietf:params:oauth:grant-type:device_code'],
        }),
      }),
    );
  });

  it('should map device_code grant type to the full URN used internally', async () => {
    await service.importData(mockAuth0Export, {
      dryRun: false,
      targetRealm: 'test',
    });
    const deviceAppCall = prisma.client.create.mock.calls.find(
      (call: any[]) => call[0].data.clientId === 'device-app',
    );
    expect(deviceAppCall).toBeDefined();
    expect(deviceAppCall[0].data.grantTypes).toContain(
      'urn:ietf:params:oauth:grant-type:device_code',
    );
    expect(deviceAppCall[0].data.grantTypes).not.toContain('device_code');
  });

  it('should import roles', async () => {
    const report = await service.importData(mockAuth0Export, {
      dryRun: false,
      targetRealm: 'test',
    });
    expect(report.summary.roles.created).toBe(2);
  });

  it('should skip auth0 database connections and import social', async () => {
    const report = await service.importData(mockAuth0Export, {
      dryRun: false,
      targetRealm: 'test',
    });
    expect(report.summary.identityProviders.created).toBe(1);
    expect(
      report.warnings.some((w) => w.message.includes('Database connection')),
    ).toBe(true);
  });

  it('stores only connections the broker can use, each complete', async () => {
    const report = await service.importData(
      {
        ...mockAuth0Export,
        connections: [
          {
            name: 'google-social',
            strategy: 'google-oauth2',
            options: { client_id: 'goog-id', client_secret: 'goog-secret' },
          },
          {
            name: 'corp-oidc',
            strategy: 'oidc',
            options: {
              client_id: 'corp',
              client_secret: 'corp-secret',
              authorization_endpoint: 'https://corp.example/authorize',
              token_endpoint: 'https://corp.example/token',
              issuer: 'https://corp.example/',
            },
          },
          {
            name: 'corp-saml',
            strategy: 'samlp',
            options: { signInEndpoint: 'https://corp.example/saml' },
          },
          { name: 'email-otp', strategy: 'email', options: {} },
        ],
      },
      { dryRun: false, targetRealm: 'test' },
    );

    const stored = prisma.identityProvider.create.mock.calls.map(
      (c: any[]) => c[0].data,
    );
    expect(stored.map((d: any) => [d.alias, d.providerType])).toEqual([
      ['google-social', 'oidc'],
      ['corp-oidc', 'oidc'],
    ]);
    expect(stored[0]).toMatchObject({
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
    });
    expect(stored[1]).toMatchObject({
      authorizationUrl: 'https://corp.example/authorize',
      tokenUrl: 'https://corp.example/token',
      issuer: 'https://corp.example/',
    });
    expect(report.summary.identityProviders).toEqual({
      created: 2,
      skipped: 2,
      failed: 0,
    });
    const messages = report.warnings.map((w) => w.message);
    expect(messages).toContainEqual(
      expect.stringMatching(
        /^Identity provider 'corp-saml' was not imported: the export's SAML settings are incomplete or unusable \(samlConfig.entityId \(the IdP entity ID\) is required; .*signingCertificates/,
      ),
    );
    expect(messages).toContainEqual(
      expect.stringMatching(
        /^Identity provider 'email-otp' was not imported: provider type 'email' is not supported/,
      ),
    );
  });

  it('should warn about organizations', async () => {
    const report = await service.importData(mockAuth0Export, {
      dryRun: false,
      targetRealm: 'test',
    });
    expect(report.warnings.some((w) => w.entity === 'organizations')).toBe(
      true,
    );
  });

  it('should work in dry-run mode', async () => {
    const report = await service.importData(mockAuth0Export, {
      dryRun: true,
      targetRealm: 'test',
    });
    expect(report.dryRun).toBe(true);
    expect(report.summary.users.created).toBe(2);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('should skip duplicate users', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'existing' });
    const report = await service.importData(mockAuth0Export, {
      dryRun: false,
      targetRealm: 'test',
    });
    expect(report.summary.users.skipped).toBe(2);
  });

  it('imports a SAML (samlp) connection whose export carries the IdP metadata', async () => {
    const report = await service.importData(
      {
        ...mockAuth0Export,
        connections: [
          {
            name: 'okta-saml',
            strategy: 'samlp',
            options: {
              metadataXml: await idpMetadata('https://okta.example/saml'),
              signSAMLRequest: true,
              protocolBinding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST',
            },
          },
        ],
      },
      { dryRun: false, targetRealm: 'test' },
    );
    const stored = prisma.identityProvider.create.mock.calls.map(
      (c: any[]) => c[0].data,
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      alias: 'okta-saml',
      providerType: 'saml',
      samlConfig: expect.objectContaining({
        entityId: 'https://okta.example/saml',
        ssoUrl: 'https://okta.example/saml/sso',
        ssoBinding: 'post',
        signAuthnRequests: true,
      }),
    });
    expect(report.summary.identityProviders.created).toBe(1);
  });
});

/** IdP metadata for a SAML import, with a real certificate. */
async function idpMetadata(entityId: string): Promise<string> {
  const idp = await makeFakeIdp(entityId);
  const body = idp.certificatePem.replace(/-----[A-Z ]+-----|\s/g, '');
  return (
    `<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${entityId}">` +
    `<IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">` +
    `<KeyDescriptor use="signing"><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>${body}</X509Certificate></X509Data></KeyInfo></KeyDescriptor>` +
    `<SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${entityId}/sso"/>` +
    `</IDPSSODescriptor></EntityDescriptor>`
  );
}
