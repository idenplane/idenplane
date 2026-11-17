import { Test } from '@nestjs/testing';
import { makeFakeIdp } from '../broker/saml/__mocks__/fake-saml-idp.js';
import { ZitadelImporterService } from './zitadel-importer.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import type { ZitadelExport } from './zitadel-types.js';

describe('ZitadelImporterService', () => {
  let service: ZitadelImporterService;
  let prisma: any;

  const mockZitadelExport: ZitadelExport = {
    users: [
      {
        userId: 'user-1',
        username: 'alice',
        state: 'USER_STATE_ACTIVE',
        human: {
          profile: { givenName: 'Alice', familyName: 'Smith' },
          email: { email: 'alice@example.com', isVerified: true },
          hashedPassword: { hash: '$2b$10$abcdefg', algorithm: 'bcrypt' },
        },
      },
      {
        userId: 'user-2',
        username: 'bob',
        state: 'USER_STATE_INACTIVE',
        human: {
          email: { email: 'bob@example.com' },
        },
      },
      {
        userId: 'user-3',
        machine: { name: 'ci-bot' },
      },
    ],
    projects: [
      {
        projectId: 'proj-1',
        name: 'My Project',
        roles: [
          { key: 'admin', displayName: 'Admin' },
          { key: 'viewer', displayName: 'Viewer' },
        ],
        apps: [
          {
            appId: 'app-1',
            name: 'SPA App',
            oidcConfig: {
              clientId: 'spa-app',
              redirectUris: ['http://localhost:3000/callback'],
              authMethodType: 'OIDC_AUTH_METHOD_TYPE_NONE',
              grantTypes: [
                'OIDC_GRANT_TYPE_AUTHORIZATION_CODE',
                'OIDC_GRANT_TYPE_REFRESH_TOKEN',
              ],
            },
          },
          {
            appId: 'app-2',
            name: 'SAML App',
            samlConfig: {},
          },
        ],
      },
    ],
    idps: [
      {
        idpId: 'idp-1',
        name: 'corp-oidc',
        type: 'IDP_TYPE_OIDC',
        oidcConfig: {
          issuer: 'https://idp.example.com',
          clientId: 'idp-client',
          clientSecret: 'idp-secret',
          authorizationEndpoint: 'https://idp.example.com/authorize',
          tokenEndpoint: 'https://idp.example.com/token',
        },
      },
      {
        idpId: 'idp-2',
        name: 'corp-google',
        type: 'IDP_TYPE_GOOGLE',
      },
    ],
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
        ZitadelImporterService,
        { provide: PrismaService, useValue: prisma },
        CryptoService,
      ],
    }).compile();

    service = module.get(ZitadelImporterService);
  });

  it('should fail if realm does not exist', async () => {
    prisma.realm.findUnique.mockResolvedValue(null);
    const report = await service.importData(mockZitadelExport, {
      dryRun: false,
      targetRealm: 'nonexistent',
    });
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].error).toContain('does not exist');
  });

  it('should import human users and skip machine users with a warning', async () => {
    const report = await service.importData(mockZitadelExport, {
      dryRun: false,
      targetRealm: 'test',
    });
    expect(report.summary.users.created).toBe(2);
    expect(
      report.warnings.some((w) => w.message.includes("Machine user 'ci-bot'")),
    ).toBe(true);
  });

  it('should import bcrypt password hashes and default others to argon2 with no hash', async () => {
    await service.importData(mockZitadelExport, {
      dryRun: false,
      targetRealm: 'test',
    });
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          username: 'alice',
          passwordHash: '$2b$10$abcdefg',
          passwordAlgorithm: 'bcrypt',
        }),
      }),
    );
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          username: 'bob',
          passwordHash: null,
          passwordAlgorithm: 'argon2',
          enabled: false,
        }),
      }),
    );
  });

  it('should import project roles', async () => {
    const report = await service.importData(mockZitadelExport, {
      dryRun: false,
      targetRealm: 'test',
    });
    expect(report.summary.roles.created).toBe(2);
    expect(prisma.role.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'admin', description: 'Admin' }),
      }),
    );
  });

  it('should import OIDC apps and skip SAML apps with a warning', async () => {
    const report = await service.importData(mockZitadelExport, {
      dryRun: false,
      targetRealm: 'test',
    });
    expect(report.summary.clients.created).toBe(1);
    expect(prisma.client.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'spa-app',
          clientType: 'PUBLIC',
          grantTypes: ['authorization_code', 'refresh_token'],
        }),
      }),
    );
    expect(
      report.warnings.some((w) => w.message.includes("App 'SAML App'")),
    ).toBe(true);
  });

  it('stores a confidential app secret hashed, never as plaintext', async () => {
    await service.importData(
      {
        ...mockZitadelExport,
        projects: [
          {
            ...mockZitadelExport.projects![0],
            apps: [
              {
                appId: 'app-3',
                name: 'Backend',
                oidcConfig: {
                  clientId: 'backend',
                  clientSecret: 'zitadel-secret',
                  redirectUris: [],
                  authMethodType: 'OIDC_AUTH_METHOD_TYPE_BASIC',
                  grantTypes: ['OIDC_GRANT_TYPE_AUTHORIZATION_CODE'],
                },
              },
            ],
          },
        ],
      } as ZitadelExport,
      { dryRun: false, targetRealm: 'test' },
    );

    const stored = (prisma.client.create as jest.Mock).mock.calls[0][0].data
      .clientSecret as string;
    expect(stored).not.toBe('zitadel-secret');
    const crypto = new CryptoService();
    expect(await crypto.verifySecret(stored, 'zitadel-secret')).toEqual({
      valid: true,
    });
  });

  it('should import generic OIDC IdPs and skip non-OIDC IdPs with a warning', async () => {
    const report = await service.importData(mockZitadelExport, {
      dryRun: false,
      targetRealm: 'test',
    });
    expect(report.summary.identityProviders.created).toBe(1);
    expect(prisma.identityProvider.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          alias: 'corp-oidc',
          providerType: 'oidc',
          clientId: 'idp-client',
        }),
      }),
    );
    expect(
      report.warnings.some((w) =>
        w.message.includes("Identity provider 'corp-google' was not imported"),
      ),
    ).toBe(true);
  });

  it('should work in dry-run mode without writing anything', async () => {
    const report = await service.importData(mockZitadelExport, {
      dryRun: true,
      targetRealm: 'test',
    });
    expect(report.dryRun).toBe(true);
    expect(report.summary.users.created).toBe(2);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.client.create).not.toHaveBeenCalled();
    expect(prisma.role.create).not.toHaveBeenCalled();
    expect(prisma.identityProvider.create).not.toHaveBeenCalled();
  });

  it('should skip duplicate users, clients, roles, and IdPs', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'existing' });
    prisma.client.findFirst.mockResolvedValue({ id: 'existing' });
    prisma.role.findFirst.mockResolvedValue({ id: 'existing' });
    prisma.identityProvider.findFirst.mockResolvedValue({ id: 'existing' });

    const report = await service.importData(mockZitadelExport, {
      dryRun: false,
      targetRealm: 'test',
    });

    expect(report.summary.users.skipped).toBe(2);
    expect(report.summary.clients.skipped).toBe(1);
    expect(report.summary.roles.skipped).toBe(2);
    // The existing OIDC IdP, plus the Google one it cannot import.
    expect(report.summary.identityProviders.skipped).toBe(2);
  });

  it('imports a SAML IdP from the metadata in its export, and skips one without', async () => {
    const metadata = Buffer.from(
      await idpMetadata('https://adfs.example/adfs/services/trust'),
    ).toString('base64');
    const report = await service.importData(
      {
        idps: [
          {
            idpId: 'idp-s1',
            name: 'adfs',
            type: 'IDP_TYPE_SAML',
            samlConfig: { metadataXml: metadata, withSignedRequest: true },
          },
          { idpId: 'idp-s2', name: 'bare-saml', type: 'IDP_TYPE_SAML' },
        ],
      },
      { dryRun: false, targetRealm: 'test' },
    );
    const stored = prisma.identityProvider.create.mock.calls.map(
      (c: any[]) => c[0].data,
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      alias: 'adfs',
      providerType: 'saml',
      samlConfig: expect.objectContaining({
        entityId: 'https://adfs.example/adfs/services/trust',
        signAuthnRequests: true,
      }),
    });
    expect(
      report.warnings.some((w) =>
        /'bare-saml' was not imported: it is a SAML identity provider and the export carries no IdP metadata/.test(
          w.message,
        ),
      ),
    ).toBe(true);
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
