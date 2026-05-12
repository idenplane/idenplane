import { ClientScopesController } from './client-scopes.controller.js';
import type { Realm } from '@prisma/client';

describe('ClientScopesController', () => {
  let controller: ClientScopesController;
  let service: {
    findAll: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    addMapper: jest.Mock;
    updateMapper: jest.Mock;
    removeMapper: jest.Mock;
    getDefaultScopes: jest.Mock;
    assignDefaultScope: jest.Mock;
    removeDefaultScope: jest.Mock;
    getOptionalScopes: jest.Mock;
    assignOptionalScope: jest.Mock;
    removeOptionalScope: jest.Mock;
  };

  const realm = { id: 'realm-1', name: 'test-realm' } as Realm;

  beforeEach(() => {
    service = {
      findAll: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      addMapper: jest.fn(),
      updateMapper: jest.fn(),
      removeMapper: jest.fn(),
      getDefaultScopes: jest.fn(),
      assignDefaultScope: jest.fn(),
      removeDefaultScope: jest.fn(),
      getOptionalScopes: jest.fn(),
      assignOptionalScope: jest.fn(),
      removeOptionalScope: jest.fn(),
    };
    controller = new ClientScopesController(service as any);
  });

  // ── Scope CRUD ────────────────────────────

  describe('findAll', () => {
    it('should call service.findAll', () => {
      service.findAll.mockResolvedValue([]);
      controller.findAll(realm);
      expect(service.findAll).toHaveBeenCalledWith(realm);
    });
  });

  describe('findOne', () => {
    it('should call service.findById', () => {
      service.findById.mockResolvedValue({});
      controller.findOne(realm, 'scope-1');
      expect(service.findById).toHaveBeenCalledWith(realm, 'scope-1');
    });
  });

  describe('create', () => {
    it('should call service.create', () => {
      const dto = { name: 'custom-scope' };
      service.create.mockResolvedValue({});
      controller.create(realm, dto);
      expect(service.create).toHaveBeenCalledWith(realm, dto);
    });
  });

  describe('update', () => {
    it('should call service.update', () => {
      const dto = { description: 'updated' };
      service.update.mockResolvedValue({});
      controller.update(realm, 'scope-1', dto);
      expect(service.update).toHaveBeenCalledWith(realm, 'scope-1', dto);
    });
  });

  describe('remove', () => {
    it('should call service.remove', () => {
      service.remove.mockResolvedValue({});
      controller.remove(realm, 'scope-1');
      expect(service.remove).toHaveBeenCalledWith(realm, 'scope-1');
    });
  });

  // ── Protocol Mappers ────────────────────────

  describe('addMapper', () => {
    it('should call service.addMapper', () => {
      const body = {
        name: 'sub',
        mapperType: 'oidc-usermodel-attribute-mapper',
      };
      service.addMapper.mockResolvedValue({});
      controller.addMapper(realm, 'scope-1', body);
      expect(service.addMapper).toHaveBeenCalledWith(realm, 'scope-1', body);
    });
  });

  describe('updateMapper', () => {
    it('should call service.updateMapper', () => {
      const body = { name: 'updated' };
      service.updateMapper.mockResolvedValue({});
      controller.updateMapper(realm, 'scope-1', 'mapper-1', body);
      expect(service.updateMapper).toHaveBeenCalledWith(
        realm,
        'scope-1',
        'mapper-1',
        body,
      );
    });
  });

  describe('removeMapper', () => {
    it('should call service.removeMapper', () => {
      service.removeMapper.mockResolvedValue({});
      controller.removeMapper(realm, 'scope-1', 'mapper-1');
      expect(service.removeMapper).toHaveBeenCalledWith(
        realm,
        'scope-1',
        'mapper-1',
      );
    });
  });

  // ── Client scope assignments ──────────────

  describe('getDefaultScopes', () => {
    it('should call service.getDefaultScopes', () => {
      service.getDefaultScopes.mockResolvedValue([]);
      controller.getDefaultScopes(realm, 'client-1');
      expect(service.getDefaultScopes).toHaveBeenCalledWith(realm, 'client-1');
    });
  });

  describe('assignDefaultScope', () => {
    it('should call service.assignDefaultScope', () => {
      service.assignDefaultScope.mockResolvedValue({});
      controller.assignDefaultScope(realm, 'client-1', {
        clientScopeId: 'scope-1',
      });
      expect(service.assignDefaultScope).toHaveBeenCalledWith(
        realm,
        'client-1',
        'scope-1',
      );
    });
  });

  describe('removeDefaultScope', () => {
    it('should call service.removeDefaultScope', () => {
      service.removeDefaultScope.mockResolvedValue({});
      controller.removeDefaultScope(realm, 'client-1', 'scope-1');
      expect(service.removeDefaultScope).toHaveBeenCalledWith(
        realm,
        'client-1',
        'scope-1',
      );
    });
  });

  describe('getOptionalScopes', () => {
    it('should call service.getOptionalScopes', () => {
      service.getOptionalScopes.mockResolvedValue([]);
      controller.getOptionalScopes(realm, 'client-1');
      expect(service.getOptionalScopes).toHaveBeenCalledWith(realm, 'client-1');
    });
  });

  describe('assignOptionalScope', () => {
    it('should call service.assignOptionalScope', () => {
      service.assignOptionalScope.mockResolvedValue({});
      controller.assignOptionalScope(realm, 'client-1', {
        clientScopeId: 'scope-1',
      });
      expect(service.assignOptionalScope).toHaveBeenCalledWith(
        realm,
        'client-1',
        'scope-1',
      );
    });
  });

  describe('removeOptionalScope', () => {
    it('should call service.removeOptionalScope', () => {
      service.removeOptionalScope.mockResolvedValue({});
      controller.removeOptionalScope(realm, 'client-1', 'scope-1');
      expect(service.removeOptionalScope).toHaveBeenCalledWith(
        realm,
        'client-1',
        'scope-1',
      );
    });
  });
});
