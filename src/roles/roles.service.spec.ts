import { ConflictException, NotFoundException } from '@nestjs/common';
import { RolesService } from './roles.service.js';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../prisma/prisma.mock.js';
import type { Realm } from '@prisma/client';

describe('RolesService', () => {
  let service: RolesService;
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

  const mockRole = {
    id: 'role-1',
    realmId: 'realm-1',
    clientId: null,
    name: 'admin',
    description: 'Administrator role',
    createdAt: new Date(),
  };

  const mockClient = {
    id: 'client-uuid-1',
    realmId: 'realm-1',
    clientId: 'my-app',
  };

  const mockClientsService = {
    findByClientId: jest.fn().mockResolvedValue(mockClient),
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    mockClientsService.findByClientId.mockReset();
    mockClientsService.findByClientId.mockResolvedValue(mockClient);
    service = new RolesService(prisma as any, mockClientsService as any);
  });

  // ─── Realm Roles ────────────────────────────────────────

  describe('createRealmRole', () => {
    it('should create a realm role', async () => {
      prisma.role.findFirst.mockResolvedValue(null);
      prisma.role.create.mockResolvedValue(mockRole);

      const result = await service.createRealmRole(
        mockRealm,
        'admin',
        'Administrator role',
      );

      expect(result).toEqual(mockRole);
      expect(prisma.role.create).toHaveBeenCalledWith({
        data: {
          realmId: 'realm-1',
          name: 'admin',
          description: 'Administrator role',
        },
      });
    });

    it('should create a realm role without a description', async () => {
      prisma.role.findFirst.mockResolvedValue(null);
      prisma.role.create.mockResolvedValue({
        ...mockRole,
        description: undefined,
      });

      await service.createRealmRole(mockRealm, 'viewer');

      expect(prisma.role.create).toHaveBeenCalledWith({
        data: {
          realmId: 'realm-1',
          name: 'viewer',
          description: undefined,
        },
      });
    });

    it('should throw ConflictException when role already exists', async () => {
      prisma.role.findFirst.mockResolvedValue(mockRole);

      await expect(service.createRealmRole(mockRealm, 'admin')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('findRealmRoles', () => {
    it('should return all realm roles ordered by name', async () => {
      const roles = [mockRole, { ...mockRole, id: 'role-2', name: 'viewer' }];
      prisma.role.findMany.mockResolvedValue(roles);

      const result = await service.findRealmRoles(mockRealm);

      expect(result).toEqual(roles);
      expect(prisma.role.findMany).toHaveBeenCalledWith({
        where: { realmId: 'realm-1', clientId: null },
        orderBy: { name: 'asc' },
      });
    });

    it('should return an empty array when no roles exist', async () => {
      prisma.role.findMany.mockResolvedValue([]);

      const result = await service.findRealmRoles(mockRealm);

      expect(result).toEqual([]);
    });
  });

  describe('deleteRealmRole', () => {
    it('should delete the realm role', async () => {
      prisma.role.findFirst.mockResolvedValue(mockRole);
      prisma.role.delete.mockResolvedValue(mockRole);

      await service.deleteRealmRole(mockRealm, 'admin');

      expect(prisma.role.findFirst).toHaveBeenCalledWith({
        where: { realmId: 'realm-1', clientId: null, name: 'admin' },
      });
      expect(prisma.role.delete).toHaveBeenCalledWith({
        where: { id: 'role-1' },
      });
    });

    it('should throw NotFoundException when role does not exist', async () => {
      prisma.role.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteRealmRole(mockRealm, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Client Roles ──────────────────────────────────────

  describe('createClientRole', () => {
    it('should create a client role', async () => {
      prisma.client.findUnique.mockResolvedValue(mockClient);
      const clientRole = {
        ...mockRole,
        clientId: 'client-uuid-1',
        name: 'editor',
      };
      prisma.role.create.mockResolvedValue(clientRole);

      const result = await service.createClientRole(
        mockRealm,
        'my-app',
        'editor',
        'Editor role',
      );

      expect(result).toEqual(clientRole);
      expect(prisma.role.create).toHaveBeenCalledWith({
        data: {
          realmId: 'realm-1',
          clientId: 'client-uuid-1',
          name: 'editor',
          description: 'Editor role',
        },
      });
    });

    it('should throw NotFoundException when client does not exist', async () => {
      mockClientsService.findByClientId.mockRejectedValueOnce(new NotFoundException("Client not found"));

      await expect(
        service.createClientRole(mockRealm, 'nonexistent', 'role'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findClientRoles', () => {
    it('should return all roles for a client', async () => {
      prisma.client.findUnique.mockResolvedValue(mockClient);
      const roles = [{ ...mockRole, clientId: 'client-uuid-1' }];
      prisma.role.findMany.mockResolvedValue(roles);

      const result = await service.findClientRoles(mockRealm, 'my-app');

      expect(result).toEqual(roles);
      expect(prisma.role.findMany).toHaveBeenCalledWith({
        where: { realmId: 'realm-1', clientId: 'client-uuid-1' },
        orderBy: { name: 'asc' },
      });
    });

    it('should throw NotFoundException when client does not exist', async () => {
      mockClientsService.findByClientId.mockRejectedValueOnce(new NotFoundException("Client not found"));

      await expect(
        service.findClientRoles(mockRealm, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Realm Role Assignment ───────────────────────────────

  describe('assignRealmRoles', () => {
    it('should assign roles to a user', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1' });
      prisma.role.findMany.mockResolvedValue([
        { id: 'role-1', name: 'admin' },
        { id: 'role-2', name: 'viewer' },
      ]);
      prisma.userRole.createMany.mockResolvedValue({ count: 2 });

      const result = await service.assignRealmRoles(mockRealm, 'user-1', [
        'admin',
        'viewer',
      ]);

      expect(result).toEqual({ assigned: ['admin', 'viewer'] });
      expect(prisma.userRole.createMany).toHaveBeenCalledWith({
        data: [
          { userId: 'user-1', roleId: 'role-1' },
          { userId: 'user-1', roleId: 'role-2' },
        ],
        skipDuplicates: true,
      });
    });

    it('should throw NotFoundException when user does not exist', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.assignRealmRoles(mockRealm, 'nonexistent', ['admin']),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when some roles do not exist', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1' });
      prisma.role.findMany.mockResolvedValue([{ id: 'role-1', name: 'admin' }]);

      await expect(
        service.assignRealmRoles(mockRealm, 'user-1', ['admin', 'missing']),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getUserRealmRoles', () => {
    it('should return the user realm roles', async () => {
      const roles = [
        { id: 'role-1', name: 'admin' },
        { id: 'role-2', name: 'viewer' },
      ];
      prisma.role.findMany.mockResolvedValue(roles);

      const result = await service.getUserRealmRoles(mockRealm, 'user-1');

      expect(result).toEqual(roles);
      expect(prisma.role.findMany).toHaveBeenCalledWith({
        where: {
          realmId: 'realm-1',
          clientId: null,
          userRoles: { some: { userId: 'user-1' } },
        },
        orderBy: { name: 'asc' },
      });
    });

    it('should return an empty array when user has no roles', async () => {
      prisma.role.findMany.mockResolvedValue([]);

      const result = await service.getUserRealmRoles(mockRealm, 'user-1');

      expect(result).toEqual([]);
    });
  });

  describe('removeUserRealmRoles', () => {
    const mockUser = { id: 'user-1', realmId: 'realm-1' };

    it('should remove roles from a user', async () => {
      prisma.user.findFirst.mockResolvedValue(mockUser);
      prisma.role.findMany.mockResolvedValue([{ id: 'role-1', name: 'admin' }]);
      prisma.userRole.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.removeUserRealmRoles(mockRealm, 'user-1', [
        'admin',
      ]);

      expect(result).toEqual({ removed: ['admin'] });
      expect(prisma.userRole.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          roleId: { in: ['role-1'] },
        },
      });
    });

    it('should throw NotFoundException when user does not exist', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.removeUserRealmRoles(mockRealm, 'nonexistent', ['admin']),
      ).rejects.toThrow(NotFoundException);
    });

    it('should handle removal of non-existent roles gracefully', async () => {
      prisma.user.findFirst.mockResolvedValue(mockUser);
      prisma.role.findMany.mockResolvedValue([]);
      prisma.userRole.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.removeUserRealmRoles(mockRealm, 'user-1', [
        'nonexistent',
      ]);

      expect(result).toEqual({ removed: ['nonexistent'] });
      expect(prisma.userRole.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          roleId: { in: [] },
        },
      });
    });
  });

  // ─── Client Role Assignment ─────────────────────────────

  describe('assignClientRoles', () => {
    it('should assign client roles to a user', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        realmId: 'realm-1',
      });
      prisma.client.findUnique.mockResolvedValue(mockClient);
      prisma.role.findMany.mockResolvedValue([
        { id: 'crole-1', name: 'editor' },
      ]);
      prisma.userRole.createMany.mockResolvedValue({ count: 1 });

      const result = await service.assignClientRoles(
        mockRealm,
        'user-1',
        'my-app',
        ['editor'],
      );

      expect(result).toEqual({ assigned: ['editor'] });
      expect(prisma.userRole.createMany).toHaveBeenCalledWith({
        data: [{ userId: 'user-1', roleId: 'crole-1' }],
        skipDuplicates: true,
      });
    });

    it('should throw NotFoundException when client does not exist', async () => {
      mockClientsService.findByClientId.mockRejectedValueOnce(new NotFoundException("Client not found"));

      await expect(
        service.assignClientRoles(mockRealm, 'user-1', 'nonexistent', [
          'editor',
        ]),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getUserClientRoles', () => {
    it('should return the user client roles', async () => {
      prisma.client.findUnique.mockResolvedValue(mockClient);
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        realmId: 'realm-1',
      });
      const roles = [{ id: 'crole-1', name: 'editor' }];
      prisma.role.findMany.mockResolvedValue(roles);

      const result = await service.getUserClientRoles(
        mockRealm,
        'user-1',
        'my-app',
      );

      expect(result).toEqual(roles);
      expect(prisma.role.findMany).toHaveBeenCalledWith({
        where: {
          realmId: 'realm-1',
          clientId: 'client-uuid-1',
          userRoles: { some: { userId: 'user-1' } },
        },
        orderBy: { name: 'asc' },
      });
    });

    it('should throw NotFoundException when client does not exist', async () => {
      mockClientsService.findByClientId.mockRejectedValueOnce(new NotFoundException("Client not found"));

      await expect(
        service.getUserClientRoles(mockRealm, 'user-1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeUserClientRoles', () => {
    const mockUser = { id: 'user-1', realmId: 'realm-1' };

    it('should remove client roles from a user', async () => {
      prisma.client.findUnique.mockResolvedValue(mockClient);
      prisma.user.findFirst.mockResolvedValue(mockUser);
      prisma.role.findMany.mockResolvedValue([
        { id: 'crole-1', name: 'editor' },
      ]);
      prisma.userRole.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.removeUserClientRoles(
        mockRealm,
        'user-1',
        'my-app',
        ['editor'],
      );

      expect(result).toEqual({ removed: ['editor'] });
      expect(prisma.userRole.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          roleId: { in: ['crole-1'] },
        },
      });
    });

    it('should throw NotFoundException when client does not exist', async () => {
      mockClientsService.findByClientId.mockRejectedValueOnce(new NotFoundException("Client not found"));

      await expect(
        service.removeUserClientRoles(mockRealm, 'user-1', 'nonexistent', [
          'editor',
        ]),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when user does not exist', async () => {
      prisma.client.findUnique.mockResolvedValue(mockClient);
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.removeUserClientRoles(mockRealm, 'nonexistent-user', 'my-app', [
          'editor',
        ]),
      ).rejects.toThrow(NotFoundException);
    });

    it('should handle removal of non-existent roles gracefully', async () => {
      prisma.client.findUnique.mockResolvedValue(mockClient);
      prisma.user.findFirst.mockResolvedValue(mockUser);
      prisma.role.findMany.mockResolvedValue([]);
      prisma.userRole.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.removeUserClientRoles(
        mockRealm,
        'user-1',
        'my-app',
        ['nonexistent'],
      );

      expect(result).toEqual({ removed: ['nonexistent'] });
    });
  });
});
