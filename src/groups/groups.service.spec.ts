import { ConflictException, NotFoundException } from '@nestjs/common';
import { GroupsService } from './groups.service.js';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../prisma/prisma.mock.js';
import type { Realm } from '@prisma/client';

describe('GroupsService', () => {
  let service: GroupsService;
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

  const mockGroup = {
    id: 'group-1',
    realmId: 'realm-1',
    name: 'developers',
    description: 'Dev team',
    parentId: null,
    createdAt: new Date(),
  };

  const mockUser = {
    id: 'user-1',
    realmId: 'realm-1',
    username: 'johndoe',
    email: 'john@example.com',
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new GroupsService(prisma as any);
  });

  // ─── create ─────────────────────────────────────────────

  describe('create', () => {
    it('should create a group successfully', async () => {
      prisma.group.findFirst.mockResolvedValue(null);
      prisma.group.create.mockResolvedValue(mockGroup);

      const result = await service.create(mockRealm, {
        name: 'developers',
        description: 'Dev team',
      });

      expect(result).toEqual(mockGroup);
      expect(prisma.group.create).toHaveBeenCalledWith({
        data: {
          realmId: 'realm-1',
          name: 'developers',
          description: 'Dev team',
          parentId: undefined,
        },
      });
    });

    it('should throw ConflictException when group name already exists', async () => {
      prisma.group.findFirst.mockResolvedValue(mockGroup);

      await expect(
        service.create(mockRealm, { name: 'developers' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should create a group with a valid parentId', async () => {
      const parentGroup = { ...mockGroup, id: 'parent-1', name: 'engineering' };
      prisma.group.findFirst
        .mockResolvedValueOnce(null) // duplicate check
        .mockResolvedValueOnce(parentGroup); // parent lookup
      prisma.group.create.mockResolvedValue({
        ...mockGroup,
        parentId: 'parent-1',
      });

      const result = await service.create(mockRealm, {
        name: 'developers',
        parentId: 'parent-1',
      });

      expect(result.parentId).toBe('parent-1');
    });

    it('should throw NotFoundException when parentId does not exist', async () => {
      prisma.group.findFirst
        .mockResolvedValueOnce(null) // no duplicate
        .mockResolvedValueOnce(null); // parent not found

      await expect(
        service.create(mockRealm, { name: 'developers', parentId: 'bad-id' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── findAll ────────────────────────────────────────────

  describe('findAll', () => {
    it('should return all groups with userGroups count', async () => {
      const groups = [
        { ...mockGroup, _count: { userGroups: 3 } },
        {
          ...mockGroup,
          id: 'group-2',
          name: 'admins',
          _count: { userGroups: 1 },
        },
      ];
      prisma.group.findMany.mockResolvedValue(groups);

      const result = await service.findAll(mockRealm);

      expect(result).toEqual(groups);
      expect(prisma.group.findMany).toHaveBeenCalledWith({
        where: { realmId: 'realm-1' },
        include: { _count: { select: { userGroups: true } } },
        orderBy: { name: 'asc' },
      });
    });

    it('should return an empty array when no groups exist', async () => {
      prisma.group.findMany.mockResolvedValue([]);

      const result = await service.findAll(mockRealm);

      expect(result).toEqual([]);
    });
  });

  // ─── findById ───────────────────────────────────────────

  describe('findById', () => {
    it('should return the group when found', async () => {
      const groupWithDetails = {
        ...mockGroup,
        children: [],
        _count: { userGroups: 2, groupRoles: 1 },
      };
      prisma.group.findFirst.mockResolvedValue(groupWithDetails);

      const result = await service.findById(mockRealm, 'group-1');

      expect(result).toEqual(groupWithDetails);
      expect(prisma.group.findFirst).toHaveBeenCalledWith({
        where: { id: 'group-1', realmId: 'realm-1' },
        include: {
          children: { orderBy: { name: 'asc' } },
          _count: { select: { userGroups: true, groupRoles: true } },
        },
      });
    });

    it('should throw NotFoundException when group does not exist', async () => {
      prisma.group.findFirst.mockResolvedValue(null);

      await expect(service.findById(mockRealm, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── update ─────────────────────────────────────────────

  describe('update', () => {
    it('should update the group successfully', async () => {
      prisma.group.findFirst.mockResolvedValue(mockGroup);
      const updated = { ...mockGroup, name: 'devops' };
      prisma.group.update.mockResolvedValue(updated);

      const result = await service.update(mockRealm, 'group-1', {
        name: 'devops',
      });

      expect(result).toEqual(updated);
      expect(prisma.group.update).toHaveBeenCalledWith({
        where: { id: 'group-1' },
        data: {
          name: 'devops',
          description: undefined,
          parentId: undefined,
        },
      });
    });

    it('should throw NotFoundException when group does not exist', async () => {
      prisma.group.findFirst.mockResolvedValue(null);

      await expect(
        service.update(mockRealm, 'nonexistent', { name: 'new-name' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException when parentId equals groupId (self-parent)', async () => {
      prisma.group.findFirst.mockResolvedValue(mockGroup);

      await expect(
        service.update(mockRealm, 'group-1', { parentId: 'group-1' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── delete ─────────────────────────────────────────────

  describe('delete', () => {
    it('should delete the group successfully', async () => {
      prisma.group.findFirst.mockResolvedValue(mockGroup);
      prisma.group.delete.mockResolvedValue(mockGroup);

      await service.delete(mockRealm, 'group-1');

      expect(prisma.group.delete).toHaveBeenCalledWith({
        where: { id: 'group-1' },
      });
    });

    it('should throw NotFoundException when group does not exist', async () => {
      prisma.group.findFirst.mockResolvedValue(null);

      await expect(service.delete(mockRealm, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── getMembers ─────────────────────────────────────────

  describe('getMembers', () => {
    it('should return members of a group', async () => {
      prisma.group.findFirst.mockResolvedValue(mockGroup);
      prisma.userGroup.findMany.mockResolvedValue([
        { userId: 'user-1', groupId: 'group-1', user: mockUser },
      ]);

      const result = await service.getMembers(mockRealm, 'group-1');

      expect(result).toEqual([mockUser]);
    });

    it('should throw NotFoundException when group does not exist', async () => {
      prisma.group.findFirst.mockResolvedValue(null);

      await expect(
        service.getMembers(mockRealm, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── addUserToGroup ─────────────────────────────────────

  describe('addUserToGroup', () => {
    it('should add a user to a group via upsert', async () => {
      prisma.user.findFirst.mockResolvedValue(mockUser);
      prisma.group.findFirst.mockResolvedValue(mockGroup);
      prisma.userGroup.upsert.mockResolvedValue({
        userId: 'user-1',
        groupId: 'group-1',
      });

      await service.addUserToGroup(mockRealm, 'user-1', 'group-1');

      expect(prisma.userGroup.upsert).toHaveBeenCalledWith({
        where: { userId_groupId: { userId: 'user-1', groupId: 'group-1' } },
        create: { userId: 'user-1', groupId: 'group-1' },
        update: {},
      });
    });

    it('should throw NotFoundException when user does not exist', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.group.findFirst.mockResolvedValue(mockGroup);

      await expect(
        service.addUserToGroup(mockRealm, 'bad-user', 'group-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when group does not exist', async () => {
      prisma.user.findFirst.mockResolvedValue(mockUser);
      prisma.group.findFirst.mockResolvedValue(null);

      await expect(
        service.addUserToGroup(mockRealm, 'user-1', 'bad-group'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── removeUserFromGroup ────────────────────────────────

  describe('removeUserFromGroup', () => {
    it('should remove a user from a group', async () => {
      prisma.userGroup.deleteMany.mockResolvedValue({ count: 1 });

      await service.removeUserFromGroup(mockRealm, 'user-1', 'group-1');

      expect(prisma.userGroup.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', groupId: 'group-1' },
      });
    });
  });

  // ─── getUserGroups ──────────────────────────────────────

  describe('getUserGroups', () => {
    it('should return groups for a user', async () => {
      prisma.user.findFirst.mockResolvedValue(mockUser);
      prisma.userGroup.findMany.mockResolvedValue([
        { userId: 'user-1', groupId: 'group-1', group: mockGroup },
      ]);

      const result = await service.getUserGroups(mockRealm, 'user-1');

      expect(result).toEqual([mockGroup]);
    });

    it('should throw NotFoundException when user does not exist', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.getUserGroups(mockRealm, 'bad-user'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getGroupRoles ──────────────────────────────────────

  describe('getGroupRoles', () => {
    it('should return roles mapped to a group', async () => {
      prisma.group.findFirst.mockResolvedValue(mockGroup);
      const mockRole = { id: 'role-1', name: 'admin' };
      prisma.groupRole.findMany.mockResolvedValue([
        { groupId: 'group-1', roleId: 'role-1', role: mockRole },
      ]);

      const result = await service.getGroupRoles(mockRealm, 'group-1');

      expect(result).toEqual([mockRole]);
    });

    it('should throw NotFoundException when group does not exist', async () => {
      prisma.group.findFirst.mockResolvedValue(null);

      await expect(
        service.getGroupRoles(mockRealm, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── assignRolesToGroup ─────────────────────────────────

  describe('assignRolesToGroup', () => {
    it('should assign roles to a group', async () => {
      prisma.group.findFirst.mockResolvedValue(mockGroup);
      prisma.role.findMany.mockResolvedValue([
        { id: 'role-1', name: 'admin' },
        { id: 'role-2', name: 'viewer' },
      ]);
      prisma.groupRole.createMany.mockResolvedValue({ count: 2 });

      const result = await service.assignRolesToGroup(mockRealm, 'group-1', [
        'admin',
        'viewer',
      ]);

      expect(result).toEqual({ assigned: ['admin', 'viewer'] });
      expect(prisma.groupRole.createMany).toHaveBeenCalledWith({
        data: [
          { groupId: 'group-1', roleId: 'role-1' },
          { groupId: 'group-1', roleId: 'role-2' },
        ],
        skipDuplicates: true,
      });
    });

    it('should throw NotFoundException when group does not exist', async () => {
      prisma.group.findFirst.mockResolvedValue(null);

      await expect(
        service.assignRolesToGroup(mockRealm, 'bad-group', ['admin']),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when some roles are missing', async () => {
      prisma.group.findFirst.mockResolvedValue(mockGroup);
      prisma.role.findMany.mockResolvedValue([{ id: 'role-1', name: 'admin' }]);

      await expect(
        service.assignRolesToGroup(mockRealm, 'group-1', ['admin', 'missing']),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── removeRolesFromGroup ───────────────────────────────

  describe('removeRolesFromGroup', () => {
    it('should remove roles from a group', async () => {
      prisma.role.findMany.mockResolvedValue([{ id: 'role-1', name: 'admin' }]);
      prisma.groupRole.deleteMany.mockResolvedValue({ count: 1 });

      await service.removeRolesFromGroup(mockRealm, 'group-1', ['admin']);

      expect(prisma.groupRole.deleteMany).toHaveBeenCalledWith({
        where: { groupId: 'group-1', roleId: { in: ['role-1'] } },
      });
    });

    it('should handle removal when roles do not exist gracefully', async () => {
      prisma.role.findMany.mockResolvedValue([]);
      prisma.groupRole.deleteMany.mockResolvedValue({ count: 0 });

      await service.removeRolesFromGroup(mockRealm, 'group-1', ['nonexistent']);

      expect(prisma.groupRole.deleteMany).toHaveBeenCalledWith({
        where: { groupId: 'group-1', roleId: { in: [] } },
      });
    });
  });
});
