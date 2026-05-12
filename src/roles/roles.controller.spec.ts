jest.mock('../crypto/jwk.service.js', () => ({ JwkService: jest.fn() }));

import { RolesController } from './roles.controller.js';
import type { Realm } from '@prisma/client';

describe('RolesController', () => {
  let controller: RolesController;
  let mockRolesService: {
    createRealmRole: jest.Mock;
    findRealmRoles: jest.Mock;
    deleteRealmRole: jest.Mock;
    createClientRole: jest.Mock;
    findClientRoles: jest.Mock;
    assignRealmRoles: jest.Mock;
    getUserRealmRoles: jest.Mock;
    removeUserRealmRoles: jest.Mock;
    assignClientRoles: jest.Mock;
    getUserClientRoles: jest.Mock;
    removeUserClientRoles: jest.Mock;
  };

  const realm = {
    id: 'realm-1',
    name: 'test-realm',
    enabled: true,
  } as Realm;

  beforeEach(() => {
    mockRolesService = {
      createRealmRole: jest.fn(),
      findRealmRoles: jest.fn(),
      deleteRealmRole: jest.fn(),
      createClientRole: jest.fn(),
      findClientRoles: jest.fn(),
      assignRealmRoles: jest.fn(),
      getUserRealmRoles: jest.fn(),
      removeUserRealmRoles: jest.fn(),
      assignClientRoles: jest.fn(),
      getUserClientRoles: jest.fn(),
      removeUserClientRoles: jest.fn(),
    };

    controller = new RolesController(mockRolesService as any);
  });

  describe('createRealmRole', () => {
    it('should call rolesService.createRealmRole with realm, name, and description', () => {
      const dto = { name: 'admin', description: 'Administrator role' };
      const expected = { id: 'role-1', name: 'admin' };
      mockRolesService.createRealmRole.mockReturnValue(expected);

      const result = controller.createRealmRole(realm, dto);

      expect(mockRolesService.createRealmRole).toHaveBeenCalledWith(
        realm,
        'admin',
        'Administrator role',
      );
      expect(result).toEqual(expected);
    });
  });

  describe('findRealmRoles', () => {
    it('should call rolesService.findRealmRoles with realm', () => {
      const expected = [{ id: 'role-1', name: 'admin' }];
      mockRolesService.findRealmRoles.mockReturnValue(expected);

      const result = controller.findRealmRoles(realm);

      expect(mockRolesService.findRealmRoles).toHaveBeenCalledWith(realm);
      expect(result).toEqual(expected);
    });
  });

  describe('deleteRealmRole', () => {
    it('should call rolesService.deleteRealmRole with realm and roleName', () => {
      mockRolesService.deleteRealmRole.mockReturnValue(undefined);

      const result = controller.deleteRealmRole(realm, 'admin');

      expect(mockRolesService.deleteRealmRole).toHaveBeenCalledWith(
        realm,
        'admin',
      );
      expect(result).toBeUndefined();
    });
  });

  describe('createClientRole', () => {
    it('should call rolesService.createClientRole with realm, clientId, name, and description', () => {
      const dto = { name: 'editor', description: 'Editor role' };
      const expected = { id: 'role-2', name: 'editor' };
      mockRolesService.createClientRole.mockReturnValue(expected);

      const result = controller.createClientRole(realm, 'client-1', dto);

      expect(mockRolesService.createClientRole).toHaveBeenCalledWith(
        realm,
        'client-1',
        'editor',
        'Editor role',
      );
      expect(result).toEqual(expected);
    });
  });

  describe('findClientRoles', () => {
    it('should call rolesService.findClientRoles with realm and clientId', () => {
      const expected = [{ id: 'role-2', name: 'editor' }];
      mockRolesService.findClientRoles.mockReturnValue(expected);

      const result = controller.findClientRoles(realm, 'client-1');

      expect(mockRolesService.findClientRoles).toHaveBeenCalledWith(
        realm,
        'client-1',
      );
      expect(result).toEqual(expected);
    });
  });

  describe('assignRealmRoles', () => {
    it('should call rolesService.assignRealmRoles with realm, userId, and roleNames', () => {
      const dto = { roleNames: ['admin', 'editor'] };
      mockRolesService.assignRealmRoles.mockReturnValue(undefined);

      const result = controller.assignRealmRoles(realm, 'user-1', dto);

      expect(mockRolesService.assignRealmRoles).toHaveBeenCalledWith(
        realm,
        'user-1',
        ['admin', 'editor'],
      );
      expect(result).toBeUndefined();
    });
  });

  describe('getUserRealmRoles', () => {
    it('should call rolesService.getUserRealmRoles with realm and userId', () => {
      const expected = [{ id: 'role-1', name: 'admin' }];
      mockRolesService.getUserRealmRoles.mockReturnValue(expected);

      const result = controller.getUserRealmRoles(realm, 'user-1');

      expect(mockRolesService.getUserRealmRoles).toHaveBeenCalledWith(
        realm,
        'user-1',
      );
      expect(result).toEqual(expected);
    });
  });

  describe('removeUserRealmRoles', () => {
    it('should call rolesService.removeUserRealmRoles with realm, userId, and roleNames', () => {
      const dto = { roleNames: ['admin'] };
      mockRolesService.removeUserRealmRoles.mockReturnValue(undefined);

      const result = controller.removeUserRealmRoles(realm, 'user-1', dto);

      expect(mockRolesService.removeUserRealmRoles).toHaveBeenCalledWith(
        realm,
        'user-1',
        ['admin'],
      );
      expect(result).toBeUndefined();
    });
  });

  describe('assignClientRoles', () => {
    it('should call rolesService.assignClientRoles with realm, userId, clientId, and roleNames', () => {
      const dto = { roleNames: ['editor', 'viewer'] };
      mockRolesService.assignClientRoles.mockReturnValue(undefined);

      const result = controller.assignClientRoles(
        realm,
        'user-1',
        'client-1',
        dto,
      );

      expect(mockRolesService.assignClientRoles).toHaveBeenCalledWith(
        realm,
        'user-1',
        'client-1',
        ['editor', 'viewer'],
      );
      expect(result).toBeUndefined();
    });
  });

  describe('getUserClientRoles', () => {
    it('should call rolesService.getUserClientRoles with realm, userId, and clientId', () => {
      const expected = [{ id: 'role-2', name: 'editor' }];
      mockRolesService.getUserClientRoles.mockReturnValue(expected);

      const result = controller.getUserClientRoles(realm, 'user-1', 'client-1');

      expect(mockRolesService.getUserClientRoles).toHaveBeenCalledWith(
        realm,
        'user-1',
        'client-1',
      );
      expect(result).toEqual(expected);
    });
  });

  describe('removeUserClientRoles', () => {
    it('should call rolesService.removeUserClientRoles with realm, userId, clientId, and roleNames', () => {
      const dto = { roleNames: ['editor'] };
      mockRolesService.removeUserClientRoles.mockReturnValue(undefined);

      const result = controller.removeUserClientRoles(
        realm,
        'user-1',
        'client-1',
        dto,
      );

      expect(mockRolesService.removeUserClientRoles).toHaveBeenCalledWith(
        realm,
        'user-1',
        'client-1',
        ['editor'],
      );
      expect(result).toBeUndefined();
    });
  });
});
