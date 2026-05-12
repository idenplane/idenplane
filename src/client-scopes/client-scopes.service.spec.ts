import { ConflictException, NotFoundException } from '@nestjs/common';
import { ClientScopesService } from './client-scopes.service.js';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../prisma/prisma.mock.js';
import type { Realm } from '@prisma/client';

describe('ClientScopesService', () => {
  let service: ClientScopesService;
  let prisma: MockPrismaService;

  const mockRealm: Realm = {
    id: 'realm-1',
    name: 'test-realm',
    displayName: 'Test Realm',
    enabled: true,
    accessTokenLifespan: 300,
    refreshTokenLifespan: 1800,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Realm;

  const mockScope = {
    id: 'scope-1',
    realmId: 'realm-1',
    name: 'profile',
    description: 'User profile scope',
    protocol: 'openid-connect',
    builtIn: false,
    protocolMappers: [],
    createdAt: new Date(),
  };

  const mockMapper = {
    id: 'mapper-1',
    clientScopeId: 'scope-1',
    name: 'email-mapper',
    mapperType: 'oidc-usermodel-attribute-mapper',
    protocol: 'openid-connect',
    config: {},
  };

  const mockClient = {
    id: 'client-uuid-1',
    realmId: 'realm-1',
    clientId: 'my-app',
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new ClientScopesService(prisma as any);
  });

  // ─── findAll ────────────────────────────────────────────

  describe('findAll', () => {
    it('should return all scopes with protocol mappers', async () => {
      const scopes = [mockScope];
      prisma.clientScope.findMany.mockResolvedValue(scopes);

      const result = await service.findAll(mockRealm);

      expect(result).toEqual(scopes);
      expect(prisma.clientScope.findMany).toHaveBeenCalledWith({
        where: { realmId: 'realm-1' },
        include: { protocolMappers: true },
        orderBy: { name: 'asc' },
      });
    });

    it('should return an empty array when no scopes exist', async () => {
      prisma.clientScope.findMany.mockResolvedValue([]);

      const result = await service.findAll(mockRealm);

      expect(result).toEqual([]);
    });
  });

  // ─── findById ───────────────────────────────────────────

  describe('findById', () => {
    it('should return the scope when found', async () => {
      prisma.clientScope.findFirst.mockResolvedValue(mockScope);

      const result = await service.findById(mockRealm, 'scope-1');

      expect(result).toEqual(mockScope);
      expect(prisma.clientScope.findFirst).toHaveBeenCalledWith({
        where: { id: 'scope-1', realmId: 'realm-1' },
        include: { protocolMappers: true },
      });
    });

    it('should throw NotFoundException when scope does not exist', async () => {
      prisma.clientScope.findFirst.mockResolvedValue(null);

      await expect(service.findById(mockRealm, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── create ─────────────────────────────────────────────

  describe('create', () => {
    it('should create a scope successfully', async () => {
      prisma.clientScope.findUnique.mockResolvedValue(null);
      prisma.clientScope.create.mockResolvedValue(mockScope);

      const result = await service.create(mockRealm, {
        name: 'profile',
        description: 'User profile scope',
      });

      expect(result).toEqual(mockScope);
      expect(prisma.clientScope.create).toHaveBeenCalledWith({
        data: {
          realmId: 'realm-1',
          name: 'profile',
          description: 'User profile scope',
          protocol: 'openid-connect',
        },
        include: { protocolMappers: true },
      });
    });

    it('should create a scope with a custom protocol', async () => {
      prisma.clientScope.findUnique.mockResolvedValue(null);
      prisma.clientScope.create.mockResolvedValue({
        ...mockScope,
        protocol: 'saml',
      });

      await service.create(mockRealm, {
        name: 'profile',
        protocol: 'saml',
      });

      expect(prisma.clientScope.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ protocol: 'saml' }),
        }),
      );
    });

    it('should throw ConflictException when scope name already exists', async () => {
      prisma.clientScope.findUnique.mockResolvedValue(mockScope);

      await expect(
        service.create(mockRealm, { name: 'profile' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── update ─────────────────────────────────────────────

  describe('update', () => {
    it('should update the scope successfully', async () => {
      prisma.clientScope.findFirst.mockResolvedValue(mockScope);
      const updated = { ...mockScope, description: 'Updated desc' };
      prisma.clientScope.update.mockResolvedValue(updated);

      const result = await service.update(mockRealm, 'scope-1', {
        description: 'Updated desc',
      });

      expect(result).toEqual(updated);
      expect(prisma.clientScope.update).toHaveBeenCalledWith({
        where: { id: 'scope-1' },
        data: { description: 'Updated desc', protocol: undefined },
        include: { protocolMappers: true },
      });
    });

    it('should throw NotFoundException when scope does not exist', async () => {
      prisma.clientScope.findFirst.mockResolvedValue(null);

      await expect(
        service.update(mockRealm, 'nonexistent', { description: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── remove ─────────────────────────────────────────────

  describe('remove', () => {
    it('should delete the scope successfully', async () => {
      prisma.clientScope.findFirst.mockResolvedValue(mockScope);
      prisma.clientScope.delete.mockResolvedValue(mockScope);

      await service.remove(mockRealm, 'scope-1');

      expect(prisma.clientScope.delete).toHaveBeenCalledWith({
        where: { id: 'scope-1' },
      });
    });

    it('should throw ConflictException for built-in scopes', async () => {
      const builtInScope = { ...mockScope, builtIn: true };
      prisma.clientScope.findFirst.mockResolvedValue(builtInScope);

      await expect(service.remove(mockRealm, 'scope-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw NotFoundException when scope does not exist', async () => {
      prisma.clientScope.findFirst.mockResolvedValue(null);

      await expect(service.remove(mockRealm, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── addMapper ──────────────────────────────────────────

  describe('addMapper', () => {
    it('should add a protocol mapper to a scope', async () => {
      prisma.clientScope.findFirst.mockResolvedValue(mockScope);
      prisma.protocolMapper.create.mockResolvedValue(mockMapper);

      const result = await service.addMapper(mockRealm, 'scope-1', {
        name: 'email-mapper',
        mapperType: 'oidc-usermodel-attribute-mapper',
      });

      expect(result).toEqual(mockMapper);
      expect(prisma.protocolMapper.create).toHaveBeenCalledWith({
        data: {
          clientScopeId: 'scope-1',
          name: 'email-mapper',
          mapperType: 'oidc-usermodel-attribute-mapper',
          protocol: 'openid-connect',
          config: {},
        },
      });
    });

    it('should throw NotFoundException when scope does not exist', async () => {
      prisma.clientScope.findFirst.mockResolvedValue(null);

      await expect(
        service.addMapper(mockRealm, 'bad-scope', {
          name: 'mapper',
          mapperType: 'type',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── updateMapper ───────────────────────────────────────

  describe('updateMapper', () => {
    it('should update a protocol mapper', async () => {
      prisma.clientScope.findFirst.mockResolvedValue(mockScope);
      const updatedMapper = { ...mockMapper, name: 'renamed-mapper' };
      prisma.protocolMapper.update.mockResolvedValue(updatedMapper);

      const result = await service.updateMapper(
        mockRealm,
        'scope-1',
        'mapper-1',
        { name: 'renamed-mapper' },
      );

      expect(result).toEqual(updatedMapper);
      expect(prisma.protocolMapper.update).toHaveBeenCalledWith({
        where: { id: 'mapper-1' },
        data: { name: 'renamed-mapper', config: undefined },
      });
    });

    it('should throw NotFoundException when scope does not exist', async () => {
      prisma.clientScope.findFirst.mockResolvedValue(null);

      await expect(
        service.updateMapper(mockRealm, 'bad-scope', 'mapper-1', {
          name: 'x',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── removeMapper ──────────────────────────────────────

  describe('removeMapper', () => {
    it('should delete a protocol mapper', async () => {
      prisma.clientScope.findFirst.mockResolvedValue(mockScope);
      prisma.protocolMapper.delete.mockResolvedValue(mockMapper);

      await service.removeMapper(mockRealm, 'scope-1', 'mapper-1');

      expect(prisma.protocolMapper.delete).toHaveBeenCalledWith({
        where: { id: 'mapper-1' },
      });
    });

    it('should throw NotFoundException when scope does not exist', async () => {
      prisma.clientScope.findFirst.mockResolvedValue(null);

      await expect(
        service.removeMapper(mockRealm, 'bad-scope', 'mapper-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getDefaultScopes ──────────────────────────────────

  describe('getDefaultScopes', () => {
    it('should return default scopes for a client', async () => {
      prisma.client.findUnique.mockResolvedValue(mockClient);
      const defaults = [
        {
          clientId: 'client-uuid-1',
          clientScopeId: 'scope-1',
          clientScope: mockScope,
        },
      ];
      prisma.clientDefaultScope.findMany.mockResolvedValue(defaults);

      const result = await service.getDefaultScopes(mockRealm, 'my-app');

      expect(result).toEqual(defaults);
      expect(prisma.clientDefaultScope.findMany).toHaveBeenCalledWith({
        where: { clientId: 'client-uuid-1' },
        include: { clientScope: true },
      });
    });

    it('should throw NotFoundException when client does not exist', async () => {
      prisma.client.findUnique.mockResolvedValue(null);

      await expect(
        service.getDefaultScopes(mockRealm, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── assignDefaultScope ─────────────────────────────────

  describe('assignDefaultScope', () => {
    it('should assign a default scope to a client', async () => {
      prisma.client.findUnique.mockResolvedValue(mockClient);
      prisma.clientScope.findFirst.mockResolvedValue(mockScope);
      const assignment = {
        clientId: 'client-uuid-1',
        clientScopeId: 'scope-1',
      };
      prisma.clientDefaultScope.create.mockResolvedValue(assignment);

      const result = await service.assignDefaultScope(
        mockRealm,
        'my-app',
        'scope-1',
      );

      expect(result).toEqual(assignment);
      expect(prisma.clientDefaultScope.create).toHaveBeenCalledWith({
        data: { clientId: 'client-uuid-1', clientScopeId: 'scope-1' },
      });
    });

    it('should throw NotFoundException when client does not exist', async () => {
      prisma.client.findUnique.mockResolvedValue(null);

      await expect(
        service.assignDefaultScope(mockRealm, 'bad-client', 'scope-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when scope does not exist', async () => {
      prisma.client.findUnique.mockResolvedValue(mockClient);
      prisma.clientScope.findFirst.mockResolvedValue(null);

      await expect(
        service.assignDefaultScope(mockRealm, 'my-app', 'bad-scope'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── removeDefaultScope ─────────────────────────────────

  describe('removeDefaultScope', () => {
    it('should remove a default scope from a client', async () => {
      prisma.client.findUnique.mockResolvedValue(mockClient);
      prisma.clientDefaultScope.deleteMany.mockResolvedValue({ count: 1 });

      await service.removeDefaultScope(mockRealm, 'my-app', 'scope-1');

      expect(prisma.clientDefaultScope.deleteMany).toHaveBeenCalledWith({
        where: { clientId: 'client-uuid-1', clientScopeId: 'scope-1' },
      });
    });

    it('should throw NotFoundException when client does not exist', async () => {
      prisma.client.findUnique.mockResolvedValue(null);

      await expect(
        service.removeDefaultScope(mockRealm, 'bad-client', 'scope-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getOptionalScopes ─────────────────────────────────

  describe('getOptionalScopes', () => {
    it('should return optional scopes for a client', async () => {
      prisma.client.findUnique.mockResolvedValue(mockClient);
      const optionals = [
        {
          clientId: 'client-uuid-1',
          clientScopeId: 'scope-1',
          clientScope: mockScope,
        },
      ];
      prisma.clientOptionalScope.findMany.mockResolvedValue(optionals);

      const result = await service.getOptionalScopes(mockRealm, 'my-app');

      expect(result).toEqual(optionals);
      expect(prisma.clientOptionalScope.findMany).toHaveBeenCalledWith({
        where: { clientId: 'client-uuid-1' },
        include: { clientScope: true },
      });
    });

    it('should throw NotFoundException when client does not exist', async () => {
      prisma.client.findUnique.mockResolvedValue(null);

      await expect(
        service.getOptionalScopes(mockRealm, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── assignOptionalScope ────────────────────────────────

  describe('assignOptionalScope', () => {
    it('should assign an optional scope to a client', async () => {
      prisma.client.findUnique.mockResolvedValue(mockClient);
      prisma.clientScope.findFirst.mockResolvedValue(mockScope);
      const assignment = {
        clientId: 'client-uuid-1',
        clientScopeId: 'scope-1',
      };
      prisma.clientOptionalScope.create.mockResolvedValue(assignment);

      const result = await service.assignOptionalScope(
        mockRealm,
        'my-app',
        'scope-1',
      );

      expect(result).toEqual(assignment);
      expect(prisma.clientOptionalScope.create).toHaveBeenCalledWith({
        data: { clientId: 'client-uuid-1', clientScopeId: 'scope-1' },
      });
    });

    it('should throw NotFoundException when client does not exist', async () => {
      prisma.client.findUnique.mockResolvedValue(null);

      await expect(
        service.assignOptionalScope(mockRealm, 'bad-client', 'scope-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when scope does not exist', async () => {
      prisma.client.findUnique.mockResolvedValue(mockClient);
      prisma.clientScope.findFirst.mockResolvedValue(null);

      await expect(
        service.assignOptionalScope(mockRealm, 'my-app', 'bad-scope'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── removeOptionalScope ────────────────────────────────

  describe('removeOptionalScope', () => {
    it('should remove an optional scope from a client', async () => {
      prisma.client.findUnique.mockResolvedValue(mockClient);
      prisma.clientOptionalScope.deleteMany.mockResolvedValue({ count: 1 });

      await service.removeOptionalScope(mockRealm, 'my-app', 'scope-1');

      expect(prisma.clientOptionalScope.deleteMany).toHaveBeenCalledWith({
        where: { clientId: 'client-uuid-1', clientScopeId: 'scope-1' },
      });
    });

    it('should throw NotFoundException when client does not exist', async () => {
      prisma.client.findUnique.mockResolvedValue(null);

      await expect(
        service.removeOptionalScope(mockRealm, 'bad-client', 'scope-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
