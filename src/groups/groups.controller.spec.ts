jest.mock('../crypto/jwk.service.js', () => ({ JwkService: jest.fn() }));

import { GroupsController } from './groups.controller.js';
import type { Realm } from '@prisma/client';

describe('GroupsController', () => {
  let controller: GroupsController;
  let mockGroupsService: {
    create: jest.Mock;
    findAll: jest.Mock;
    findById: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    getMembers: jest.Mock;
    addUserToGroup: jest.Mock;
    removeUserFromGroup: jest.Mock;
    getUserGroups: jest.Mock;
    getGroupRoles: jest.Mock;
    assignRolesToGroup: jest.Mock;
    removeRolesFromGroup: jest.Mock;
  };

  const realm = {
    id: 'realm-1',
    name: 'test-realm',
    enabled: true,
  } as Realm;

  beforeEach(() => {
    mockGroupsService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      getMembers: jest.fn(),
      addUserToGroup: jest.fn(),
      removeUserFromGroup: jest.fn(),
      getUserGroups: jest.fn(),
      getGroupRoles: jest.fn(),
      assignRolesToGroup: jest.fn(),
      removeRolesFromGroup: jest.fn(),
    };

    controller = new GroupsController(mockGroupsService as any);
  });

  describe('create', () => {
    it('should call groupsService.create with realm and dto', () => {
      const dto = { name: 'developers' };
      const expected = { id: 'group-1', name: 'developers' };
      mockGroupsService.create.mockReturnValue(expected);

      const result = controller.create(realm, dto);

      expect(mockGroupsService.create).toHaveBeenCalledWith(realm, dto);
      expect(result).toEqual(expected);
    });
  });

  describe('findAll', () => {
    it('should call groupsService.findAll with realm', () => {
      const expected = [{ id: 'group-1', name: 'developers' }];
      mockGroupsService.findAll.mockReturnValue(expected);

      const result = controller.findAll(realm);

      expect(mockGroupsService.findAll).toHaveBeenCalledWith(realm);
      expect(result).toEqual(expected);
    });
  });

  describe('findById', () => {
    it('should call groupsService.findById with realm and groupId', () => {
      const expected = { id: 'group-1', name: 'developers' };
      mockGroupsService.findById.mockReturnValue(expected);

      const result = controller.findById(realm, 'group-1');

      expect(mockGroupsService.findById).toHaveBeenCalledWith(realm, 'group-1');
      expect(result).toEqual(expected);
    });
  });

  describe('update', () => {
    it('should call groupsService.update with realm, groupId, and dto', () => {
      const dto = { name: 'senior-developers' };
      const expected = { id: 'group-1', name: 'senior-developers' };
      mockGroupsService.update.mockReturnValue(expected);

      const result = controller.update(realm, 'group-1', dto);

      expect(mockGroupsService.update).toHaveBeenCalledWith(
        realm,
        'group-1',
        dto,
      );
      expect(result).toEqual(expected);
    });
  });

  describe('delete', () => {
    it('should call groupsService.delete with realm and groupId', () => {
      mockGroupsService.delete.mockReturnValue(undefined);

      const result = controller.delete(realm, 'group-1');

      expect(mockGroupsService.delete).toHaveBeenCalledWith(realm, 'group-1');
      expect(result).toBeUndefined();
    });
  });

  describe('getMembers', () => {
    it('should call groupsService.getMembers with realm and groupId', () => {
      const expected = [{ id: 'user-1', username: 'john' }];
      mockGroupsService.getMembers.mockReturnValue(expected);

      const result = controller.getMembers(realm, 'group-1');

      expect(mockGroupsService.getMembers).toHaveBeenCalledWith(
        realm,
        'group-1',
      );
      expect(result).toEqual(expected);
    });
  });

  describe('addUserToGroup', () => {
    it('should call groupsService.addUserToGroup with realm, userId, and groupId', () => {
      mockGroupsService.addUserToGroup.mockReturnValue(undefined);

      const result = controller.addUserToGroupPut(realm, 'user-1', 'group-1');

      expect(mockGroupsService.addUserToGroup).toHaveBeenCalledWith(
        realm,
        'user-1',
        'group-1',
      );
      expect(result).toBeUndefined();
    });
  });

  describe('removeUserFromGroup', () => {
    it('should call groupsService.removeUserFromGroup with realm, userId, and groupId', () => {
      mockGroupsService.removeUserFromGroup.mockReturnValue(undefined);

      const result = controller.removeUserFromGroup(realm, 'user-1', 'group-1');

      expect(mockGroupsService.removeUserFromGroup).toHaveBeenCalledWith(
        realm,
        'user-1',
        'group-1',
      );
      expect(result).toBeUndefined();
    });
  });

  describe('getUserGroups', () => {
    it('should call groupsService.getUserGroups with realm and userId', () => {
      const expected = [{ id: 'group-1', name: 'developers' }];
      mockGroupsService.getUserGroups.mockReturnValue(expected);

      const result = controller.getUserGroups(realm, 'user-1');

      expect(mockGroupsService.getUserGroups).toHaveBeenCalledWith(
        realm,
        'user-1',
      );
      expect(result).toEqual(expected);
    });
  });

  describe('getGroupRoles', () => {
    it('should call groupsService.getGroupRoles with realm and groupId', () => {
      const expected = [{ id: 'role-1', name: 'admin' }];
      mockGroupsService.getGroupRoles.mockReturnValue(expected);

      const result = controller.getGroupRoles(realm, 'group-1');

      expect(mockGroupsService.getGroupRoles).toHaveBeenCalledWith(
        realm,
        'group-1',
      );
      expect(result).toEqual(expected);
    });
  });

  describe('assignRoles', () => {
    it('should call groupsService.assignRolesToGroup with realm, groupId, and roleNames', () => {
      const body = { roleNames: ['admin', 'editor'] };
      mockGroupsService.assignRolesToGroup.mockReturnValue(undefined);

      const result = controller.assignRoles(realm, 'group-1', body);

      expect(mockGroupsService.assignRolesToGroup).toHaveBeenCalledWith(
        realm,
        'group-1',
        ['admin', 'editor'],
      );
      expect(result).toBeUndefined();
    });
  });

  describe('removeRoles', () => {
    it('should call groupsService.removeRolesFromGroup with realm, groupId, and roleNames', () => {
      const body = { roleNames: ['editor'] };
      mockGroupsService.removeRolesFromGroup.mockReturnValue(undefined);

      const result = controller.removeRoles(realm, 'group-1', body);

      expect(mockGroupsService.removeRolesFromGroup).toHaveBeenCalledWith(
        realm,
        'group-1',
        ['editor'],
      );
      expect(result).toBeUndefined();
    });
  });
});
