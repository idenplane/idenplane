import { NotFoundException } from '@nestjs/common';
import { SamlSpAdminController } from './saml-sp-admin.controller.js';
import type { Realm } from '@prisma/client';

describe('SamlSpAdminController', () => {
  let controller: SamlSpAdminController;
  let samlIdpService: {
    createSp: jest.Mock;
    findAllSps: jest.Mock;
    findSpById: jest.Mock;
    updateSp: jest.Mock;
    deleteSp: jest.Mock;
  };

  const realm = { id: 'realm-1', name: 'test-realm' } as Realm;

  beforeEach(() => {
    samlIdpService = {
      createSp: jest.fn(),
      findAllSps: jest.fn(),
      findSpById: jest.fn(),
      updateSp: jest.fn(),
      deleteSp: jest.fn(),
    };
    controller = new SamlSpAdminController(samlIdpService as any);
  });

  describe('create', () => {
    it('should call samlIdpService.createSp', () => {
      const dto = { entityId: 'https://sp.example.com/saml' };
      samlIdpService.createSp.mockResolvedValue({ id: 'sp-1' });
      controller.create(realm, dto as any);
      expect(samlIdpService.createSp).toHaveBeenCalledWith(realm, dto);
    });
  });

  describe('findAll', () => {
    it('should call samlIdpService.findAllSps', () => {
      samlIdpService.findAllSps.mockResolvedValue([]);
      controller.findAll(realm);
      expect(samlIdpService.findAllSps).toHaveBeenCalledWith(realm);
    });
  });

  describe('findOne', () => {
    it('should return SP when found', async () => {
      const sp = { id: 'sp-1', entityId: 'https://sp.example.com' };
      samlIdpService.findSpById.mockResolvedValue(sp);

      const result = await controller.findOne(realm, 'sp-1');

      expect(result).toEqual(sp);
      expect(samlIdpService.findSpById).toHaveBeenCalledWith(realm, 'sp-1');
    });

    it('should throw NotFoundException when SP not found', async () => {
      samlIdpService.findSpById.mockResolvedValue(null);

      await expect(controller.findOne(realm, 'missing')).rejects.toThrow(
        NotFoundException,
      );
      await expect(controller.findOne(realm, 'missing')).rejects.toThrow(
        'SAML service provider not found',
      );
    });
  });

  describe('update', () => {
    it('should call samlIdpService.updateSp', () => {
      const dto = { name: 'Updated SP' };
      samlIdpService.updateSp.mockResolvedValue({});
      controller.update(realm, 'sp-1', dto);
      expect(samlIdpService.updateSp).toHaveBeenCalledWith(realm, 'sp-1', dto);
    });
  });

  describe('remove', () => {
    it('should call samlIdpService.deleteSp', () => {
      samlIdpService.deleteSp.mockResolvedValue({});
      controller.remove(realm, 'sp-1');
      expect(samlIdpService.deleteSp).toHaveBeenCalledWith(realm, 'sp-1');
    });
  });
});
