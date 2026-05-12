import { UserFederationController } from './user-federation.controller.js';

describe('UserFederationController', () => {
  let controller: UserFederationController;
  let service: {
    create: jest.Mock;
    findAll: jest.Mock;
    findById: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    testConnection: jest.Mock;
    syncUsers: jest.Mock;
  };

  beforeEach(() => {
    service = {
      create: jest.fn(),
      findAll: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      testConnection: jest.fn(),
      syncUsers: jest.fn(),
    };
    controller = new UserFederationController(service as any);
  });

  describe('create', () => {
    it('should call service.create with realmName and dto', () => {
      const dto = { name: 'LDAP', type: 'ldap' };
      service.create.mockResolvedValue({ id: 'fed-1' });

      controller.create('test-realm', dto as any);

      expect(service.create).toHaveBeenCalledWith('test-realm', dto);
    });
  });

  describe('findAll', () => {
    it('should call service.findAll with realmName', () => {
      service.findAll.mockResolvedValue([]);
      controller.findAll('test-realm');
      expect(service.findAll).toHaveBeenCalledWith('test-realm');
    });
  });

  describe('findOne', () => {
    it('should call service.findById with realmName and id', () => {
      service.findById.mockResolvedValue({});
      controller.findOne('test-realm', 'fed-1');
      expect(service.findById).toHaveBeenCalledWith('test-realm', 'fed-1');
    });
  });

  describe('update', () => {
    it('should call service.update', () => {
      const dto = { name: 'Updated LDAP' };
      service.update.mockResolvedValue({});
      controller.update('test-realm', 'fed-1', dto);
      expect(service.update).toHaveBeenCalledWith('test-realm', 'fed-1', dto);
    });
  });

  describe('remove', () => {
    it('should call service.remove', () => {
      service.remove.mockResolvedValue({});
      controller.remove('test-realm', 'fed-1');
      expect(service.remove).toHaveBeenCalledWith('test-realm', 'fed-1');
    });
  });

  describe('testConnection', () => {
    it('should call service.testConnection', () => {
      service.testConnection.mockResolvedValue({ success: true });
      controller.testConnection('test-realm', 'fed-1');
      expect(service.testConnection).toHaveBeenCalledWith(
        'test-realm',
        'fed-1',
      );
    });
  });

  describe('sync', () => {
    it('should call service.syncUsers', () => {
      service.syncUsers.mockResolvedValue({ synced: 10 });
      controller.sync('test-realm', 'fed-1');
      expect(service.syncUsers).toHaveBeenCalledWith('test-realm', 'fed-1');
    });
  });
});
