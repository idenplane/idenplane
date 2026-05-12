jest.mock('../crypto/jwk.service.js', () => ({ JwkService: jest.fn() }));

import { ClientsController } from './clients.controller.js';
import type { Realm } from '@prisma/client';

describe('ClientsController', () => {
  let controller: ClientsController;
  let clientsService: {
    create: jest.Mock;
    findAll: jest.Mock;
    findByClientId: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    regenerateSecret: jest.Mock;
    getServiceAccount: jest.Mock;
  };

  const realm = { id: 'realm-1', name: 'test-realm' } as Realm;

  beforeEach(() => {
    clientsService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findByClientId: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      regenerateSecret: jest.fn(),
      getServiceAccount: jest.fn(),
    };

    controller = new ClientsController(clientsService as any);
  });

  describe('create', () => {
    it('should call clientsService.create with realm and dto', () => {
      const dto = { clientId: 'my-app', name: 'My App' };
      const expected = { id: 'c1', ...dto };
      clientsService.create.mockReturnValue(expected);

      const result = controller.create(realm, dto);

      expect(clientsService.create).toHaveBeenCalledWith(realm, dto);
      expect(result).toEqual(expected);
    });
  });

  describe('findAll', () => {
    it('should call clientsService.findAll with realm', () => {
      const expected = [{ id: 'c1' }, { id: 'c2' }];
      clientsService.findAll.mockReturnValue(expected);

      const result = controller.findAll(realm);

      expect(clientsService.findAll).toHaveBeenCalledWith(realm);
      expect(result).toEqual(expected);
    });
  });

  describe('findOne', () => {
    it('should call clientsService.findByClientId with realm and clientId', () => {
      const expected = { id: 'c1', clientId: 'my-app' };
      clientsService.findByClientId.mockReturnValue(expected);

      const result = controller.findOne(realm, 'my-app');

      expect(clientsService.findByClientId).toHaveBeenCalledWith(
        realm,
        'my-app',
      );
      expect(result).toEqual(expected);
    });
  });

  describe('update', () => {
    it('should call clientsService.update with realm, clientId, and dto', () => {
      const dto = { name: 'Updated App' };
      const expected = { id: 'c1', clientId: 'my-app', ...dto };
      clientsService.update.mockReturnValue(expected);

      const result = controller.update(realm, 'my-app', dto);

      expect(clientsService.update).toHaveBeenCalledWith(realm, 'my-app', dto);
      expect(result).toEqual(expected);
    });
  });

  describe('remove', () => {
    it('should call clientsService.remove with realm and clientId', () => {
      clientsService.remove.mockReturnValue(undefined);

      const result = controller.remove(realm, 'my-app');

      expect(clientsService.remove).toHaveBeenCalledWith(realm, 'my-app');
      expect(result).toBeUndefined();
    });
  });

  describe('regenerateSecret', () => {
    it('should call clientsService.regenerateSecret with realm and clientId', () => {
      const expected = { secret: 'new-secret-value' };
      clientsService.regenerateSecret.mockReturnValue(expected);

      const result = controller.regenerateSecret(realm, 'my-app');

      expect(clientsService.regenerateSecret).toHaveBeenCalledWith(
        realm,
        'my-app',
      );
      expect(result).toEqual(expected);
    });
  });

  describe('getServiceAccount', () => {
    it('should call clientsService.getServiceAccount with realm and clientId', () => {
      const expected = { id: 'sa-1', username: 'service-account-my-app' };
      clientsService.getServiceAccount.mockReturnValue(expected);

      const result = controller.getServiceAccount(realm, 'my-app');

      expect(clientsService.getServiceAccount).toHaveBeenCalledWith(
        realm,
        'my-app',
      );
      expect(result).toEqual(expected);
    });
  });
});
