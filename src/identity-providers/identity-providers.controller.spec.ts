import { IdentityProvidersController } from './identity-providers.controller.js';
import type { Realm } from '@prisma/client';

describe('IdentityProvidersController', () => {
  let controller: IdentityProvidersController;
  let idpService: {
    create: jest.Mock;
    findAll: jest.Mock;
    findByAlias: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
  };

  const realm = { id: 'realm-1', name: 'test-realm' } as Realm;

  beforeEach(() => {
    idpService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findByAlias: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    controller = new IdentityProvidersController(idpService as any);
  });

  describe('create', () => {
    it('should call service.create with realm and dto', () => {
      const dto = { alias: 'google', providerType: 'oidc', clientId: 'gid' };
      idpService.create.mockResolvedValue({ id: 'idp-1' });

      const result = controller.create(realm, dto as any);

      expect(idpService.create).toHaveBeenCalledWith(realm, dto);
    });
  });

  describe('findAll', () => {
    it('should call service.findAll with realm', () => {
      idpService.findAll.mockResolvedValue([]);

      controller.findAll(realm);

      expect(idpService.findAll).toHaveBeenCalledWith(realm);
    });
  });

  describe('findByAlias', () => {
    it('should call service.findByAlias with realm and alias', () => {
      idpService.findByAlias.mockResolvedValue({ alias: 'google' });

      controller.findByAlias(realm, 'google');

      expect(idpService.findByAlias).toHaveBeenCalledWith(realm, 'google');
    });
  });

  describe('update', () => {
    it('should call service.update with realm, alias, and dto', () => {
      const dto = { displayName: 'Updated Google' };
      idpService.update.mockResolvedValue({});

      controller.update(realm, 'google', dto);

      expect(idpService.update).toHaveBeenCalledWith(realm, 'google', dto);
    });
  });

  describe('remove', () => {
    it('should call service.remove with realm and alias', () => {
      idpService.remove.mockResolvedValue({});

      controller.remove(realm, 'google');

      expect(idpService.remove).toHaveBeenCalledWith(realm, 'google');
    });
  });
});
