import { BadRequestException, ConflictException } from '@nestjs/common';

jest.mock('../crypto/jwk.service.js', () => ({
  JwkService: jest.fn(),
}));

import { RealmImportService } from './realm-import.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';

describe('RealmImportService', () => {
  let service: RealmImportService;
  let prisma: MockPrismaService;
  let jwkService: { generateRsaKeyPair: jest.Mock };
  let cache: {
    invalidateRealmCache: jest.Mock;
    invalidateCorsOrigins: jest.Mock;
  };
  let cors: { invalidateLocalCache: jest.Mock };

  /** The built-in scopes seeded through the transaction. */
  const seededScopeNames = () =>
    prisma.clientScope.create.mock.calls
      .map((c) => c[0].data)
      .filter((d) => d.builtIn === true && d.protocolMappers)
      .map((d) => d.name);

  const keyPair = {
    kid: 'kid-1',
    publicKeyPem: '-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----',
    privateKeyPem:
      '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----',
  };

  const validPayload = {
    version: 1,
    realm: {
      name: 'imported-realm',
      displayName: 'Imported',
      enabled: true,
    },
    clients: [
      {
        clientId: 'app-1',
        clientType: 'CONFIDENTIAL',
        name: 'App 1',
        enabled: true,
        redirectUris: ['http://localhost/callback'],
        grantTypes: ['authorization_code'],
      },
    ],
    roles: [
      { name: 'admin', description: 'Admin role', clientId: null },
      { name: 'client-admin', description: 'Client admin', clientId: 'app-1' },
    ],
    groups: [
      { name: 'devs', description: 'Developers', parentName: null },
      { name: 'backend', description: 'Backend devs', parentName: 'devs' },
    ],
    clientScopes: [
      {
        name: 'openid',
        description: 'OpenID scope',
        protocol: 'openid-connect',
        builtIn: true,
        protocolMappers: [
          {
            name: 'sub',
            mapperType: 'oidc-usermodel-attribute-mapper',
            config: {},
          },
        ],
      },
    ],
    identityProviders: [
      {
        alias: 'google',
        displayName: 'Google',
        enabled: true,
        providerType: 'oidc',
        clientId: 'google-client',
        authorizationUrl: 'https://accounts.google.com/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
      },
    ],
    clientScopeAssignments: [
      { clientId: 'app-1', defaultScopes: ['openid'], optionalScopes: [] },
    ],
    users: [
      {
        username: 'testuser',
        email: 'test@example.com',
        enabled: true,
        roles: [{ name: 'admin', clientId: null }],
        groups: ['devs'],
      },
    ],
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    jwkService = { generateRsaKeyPair: jest.fn().mockResolvedValue(keyPair) };
    cache = {
      invalidateRealmCache: jest.fn().mockResolvedValue(undefined),
      invalidateCorsOrigins: jest.fn().mockResolvedValue(undefined),
    };
    cors = { invalidateLocalCache: jest.fn() };
    // The import runs in one interactive transaction; the mock runs it
    // against the same mock client.
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(prisma),
    );

    service = new RealmImportService(
      prisma as any,
      jwkService as any,
      new CryptoService(),
      cache as any,
      cors as any,
    );

    // Default mock return values
    prisma.realm.findUnique.mockResolvedValue(null);
    prisma.realm.create.mockResolvedValue({
      id: 'new-realm-id',
      name: 'imported-realm',
    });
    prisma.clientScope.create.mockResolvedValue({ id: 'scope-db-1' });
    prisma.protocolMapper.create.mockResolvedValue({});
    prisma.client.create.mockResolvedValue({ id: 'client-db-1' });
    prisma.role.create
      .mockResolvedValueOnce({ id: 'role-db-1' })
      .mockResolvedValueOnce({ id: 'role-db-2' });
    prisma.group.create
      .mockResolvedValueOnce({ id: 'group-db-1' })
      .mockResolvedValueOnce({ id: 'group-db-2' });
    prisma.identityProvider.create.mockResolvedValue({});
    prisma.clientDefaultScope.create.mockResolvedValue({});
    prisma.clientOptionalScope.create.mockResolvedValue({});
    prisma.user.create.mockResolvedValue({ id: 'user-db-1' });
    prisma.userRole.create.mockResolvedValue({});
    prisma.userGroup.create.mockResolvedValue({});
  });

  describe('importRealm', () => {
    it('should throw if payload is missing version', async () => {
      await expect(
        service.importRealm({ realm: { name: 'test' } }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if payload is missing realm', async () => {
      await expect(service.importRealm({ version: 1 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw if realm name is missing', async () => {
      await expect(
        service.importRealm({ version: 1, realm: {} }),
      ).rejects.toThrow('realm name is required');
    });

    it('should throw ConflictException if realm exists without overwrite', async () => {
      prisma.realm.findUnique.mockResolvedValue({
        id: 'existing',
        name: 'imported-realm',
      });

      await expect(service.importRealm(validPayload)).rejects.toThrow(
        ConflictException,
      );
    });

    it('refuses to replace the master realm, even with overwrite', async () => {
      prisma.realm.findUnique.mockResolvedValue({ id: 'm', name: 'master' });
      const payload = {
        ...validPayload,
        realm: { ...(validPayload['realm'] as object), name: 'master' },
      };

      await expect(
        service.importRealm(payload, { overwrite: true }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.realm.delete).not.toHaveBeenCalled();
    });

    it('should delete existing realm when overwrite is true', async () => {
      prisma.realm.findUnique.mockResolvedValue({
        id: 'existing',
        name: 'imported-realm',
      });
      prisma.realm.delete.mockResolvedValue({});

      await service.importRealm(validPayload, { overwrite: true });

      expect(prisma.realm.delete).toHaveBeenCalledWith({
        where: { id: 'existing' },
      });
      expect(prisma.realm.create).toHaveBeenCalled();
      // Inside the transaction, so a failed import keeps the old realm.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(cache.invalidateRealmCache).toHaveBeenCalledWith(
        'existing',
        'imported-realm',
      );
    });

    it('creates nothing outside the transaction', async () => {
      await service.importRealm(validPayload);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const [, txOptions] = prisma.$transaction.mock.calls[0];
      expect(txOptions.timeout).toBeGreaterThan(5000);
    });

    it('rejects a version it does not know', async () => {
      await expect(
        service.importRealm({ ...validPayload, version: 3 }),
      ).rejects.toThrow('Unsupported export version');
    });

    it("accepts version 1 written as '1.0'", async () => {
      const result = await service.importRealm({
        ...validPayload,
        version: '1.0',
      });
      expect(result.realmName).toBe('imported-realm');
    });

    it('rejects a section that is not an array', async () => {
      await expect(
        service.importRealm({ ...validPayload, clients: { a: 1 } }),
      ).rejects.toThrow('clients: must be an array');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should create realm with signing key', async () => {
      await service.importRealm(validPayload);

      expect(jwkService.generateRsaKeyPair).toHaveBeenCalled();
      expect(prisma.realm.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'imported-realm',
            signingKeys: expect.objectContaining({
              create: expect.objectContaining({ kid: 'kid-1' }),
            }),
          }),
        }),
      );
    });

    it('should import client scopes with protocol mappers', async () => {
      await service.importRealm(validPayload);

      expect(prisma.clientScope.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            realmId: 'new-realm-id',
            name: 'openid',
          }),
        }),
      );
      expect(prisma.protocolMapper.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'sub',
            mapperType: 'oidc-usermodel-attribute-mapper',
          }),
        }),
      );
    });

    it('should seed default scopes if no scopes provided', async () => {
      const payloadNoScopes = { ...validPayload, clientScopes: [] };

      await service.importRealm(payloadNoScopes);

      expect(seededScopeNames()).toEqual(
        expect.arrayContaining(['openid', 'profile', 'email']),
      );
    });

    it('should not seed default scopes if scopes are provided', async () => {
      await service.importRealm(validPayload);

      expect(seededScopeNames()).toEqual([]);
    });

    it('should import clients', async () => {
      await service.importRealm(validPayload);

      expect(prisma.client.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            realmId: 'new-realm-id',
            clientId: 'app-1',
          }),
        }),
      );
    });

    it('keeps an exported client secret hash, so the secret keeps working', async () => {
      const crypto = new CryptoService();
      const hash = await crypto.hashSecret(crypto.generateSecret());
      await service.importRealm({
        ...validPayload,
        clients: [{ ...validPayload.clients[0], clientSecret: hash }],
      });

      expect(prisma.client.create.mock.calls[0][0].data.clientSecret).toBe(
        hash,
      );
    });

    it('hashes a plaintext client secret written into the payload by hand', async () => {
      await service.importRealm({
        ...validPayload,
        clients: [{ ...validPayload.clients[0], clientSecret: 'hand-written' }],
      });

      const stored = prisma.client.create.mock.calls[0][0].data.clientSecret;
      expect(stored).not.toBe('hand-written');
      expect(
        await new CryptoService().verifySecret(stored, 'hand-written'),
      ).toEqual({ valid: true });
    });

    it('should import roles including client roles', async () => {
      await service.importRealm(validPayload);

      expect(prisma.role.create).toHaveBeenCalledTimes(2);
    });

    it('should import groups with parent-child relationships', async () => {
      await service.importRealm(validPayload);

      // First pass: groups without parents (no parentId field)
      expect(prisma.group.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'devs' }),
        }),
      );
      // Second pass: groups with parents
      expect(prisma.group.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'backend',
            parentId: 'group-db-1',
          }),
        }),
      );
    });

    it('should import identity providers', async () => {
      await service.importRealm(validPayload);

      expect(prisma.identityProvider.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            realmId: 'new-realm-id',
            alias: 'google',
          }),
        }),
      );
    });

    it('should create client scope assignments', async () => {
      await service.importRealm(validPayload);

      expect(prisma.clientDefaultScope.create).toHaveBeenCalled();
    });

    it('should import users with roles and groups', async () => {
      await service.importRealm(validPayload);

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            realmId: 'new-realm-id',
            username: 'testuser',
          }),
        }),
      );
      expect(prisma.userRole.create).toHaveBeenCalled();
      expect(prisma.userGroup.create).toHaveBeenCalled();
    });

    it('should return import summary', async () => {
      const result = await service.importRealm(validPayload);

      expect(result).toEqual({
        realmName: 'imported-realm',
        clientsImported: 1,
        rolesImported: 2,
        groupsImported: 2,
        scopesImported: 1,
        idpsImported: 1,
        usersImported: 1,
      });
    });

    it('should handle payload with no optional entities', async () => {
      const minimalPayload = {
        version: 1,
        realm: { name: 'minimal' },
      };
      prisma.realm.create.mockResolvedValue({ id: 'min-id', name: 'minimal' });

      const result = await service.importRealm(minimalPayload);

      expect(result.clientsImported).toBe(0);
      expect(result.rolesImported).toBe(0);
      expect(result.groupsImported).toBe(0);
      expect(result.usersImported).toBe(0);
      expect(seededScopeNames()).toContain('openid');
    });
  });
});
