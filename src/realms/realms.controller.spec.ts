jest.mock('../crypto/jwk.service.js', () => ({ JwkService: jest.fn() }));

import { RealmsController } from './realms.controller.js';

describe('RealmsController', () => {
  let controller: RealmsController;
  let realmsService: {
    create: jest.Mock;
    findAll: jest.Mock;
    findByName: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
  };
  let exportService: { exportRealm: jest.Mock };
  let importService: { importRealm: jest.Mock };
  let emailService: { isConfigured: jest.Mock; sendEmail: jest.Mock };
  let themeService: { getAvailableThemes: jest.Mock };
  let themeEmail: { getSubject: jest.Mock; renderEmail: jest.Mock };

  beforeEach(() => {
    realmsService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findByName: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    exportService = { exportRealm: jest.fn() };
    importService = { importRealm: jest.fn() };
    emailService = { isConfigured: jest.fn(), sendEmail: jest.fn() };
    themeService = { getAvailableThemes: jest.fn() };
    themeEmail = { getSubject: jest.fn(), renderEmail: jest.fn() };

    controller = new RealmsController(
      realmsService as any,
      exportService as any,
      importService as any,
      emailService as any,
      themeService as any,
      themeEmail as any,
    );
  });

  describe('create', () => {
    it('should call realmsService.create with dto', () => {
      const dto = { name: 'new-realm' };
      const expected = { id: 'r1', ...dto };
      realmsService.create.mockReturnValue(expected);

      const result = controller.create(dto);

      expect(realmsService.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual(expected);
    });
  });

  describe('findAll', () => {
    it('should call realmsService.findAll', () => {
      const expected = [{ id: 'r1' }, { id: 'r2' }];
      realmsService.findAll.mockReturnValue(expected);

      const result = controller.findAll();

      expect(realmsService.findAll).toHaveBeenCalledWith();
      expect(result).toEqual(expected);
    });
  });

  describe('getThemes', () => {
    it('should call themeService.getAvailableThemes', () => {
      const expected = ['default', 'midnight'];
      themeService.getAvailableThemes.mockReturnValue(expected);

      const result = controller.getThemes();

      expect(themeService.getAvailableThemes).toHaveBeenCalledWith();
      expect(result).toEqual(expected);
    });
  });

  describe('findOne', () => {
    it('should call realmsService.findByName with realmName', () => {
      const expected = { id: 'r1', name: 'my-realm' };
      realmsService.findByName.mockReturnValue(expected);

      const result = controller.findOne('my-realm');

      expect(realmsService.findByName).toHaveBeenCalledWith('my-realm');
      expect(result).toEqual(expected);
    });
  });

  describe('update', () => {
    it('should call realmsService.update with realmName and dto', () => {
      const dto = { displayName: 'Updated Realm' };
      const expected = { id: 'r1', name: 'my-realm', ...dto };
      realmsService.update.mockReturnValue(expected);

      const result = controller.update('my-realm', dto);

      expect(realmsService.update).toHaveBeenCalledWith('my-realm', dto);
      expect(result).toEqual(expected);
    });
  });

  describe('remove', () => {
    it('should call realmsService.remove with realmName', () => {
      realmsService.remove.mockReturnValue(undefined);

      const result = controller.remove('my-realm');

      expect(realmsService.remove).toHaveBeenCalledWith('my-realm');
      expect(result).toBeUndefined();
    });
  });

  describe('exportRealm', () => {
    it('should call exportService.exportRealm with defaults when no query params', () => {
      const expected = { realm: 'my-realm', users: [] };
      exportService.exportRealm.mockReturnValue(expected);

      const result = controller.exportRealm('my-realm');

      expect(exportService.exportRealm).toHaveBeenCalledWith('my-realm', {
        includeUsers: false,
        includeSecrets: false,
      });
      expect(result).toEqual(expected);
    });

    it('should convert "true" string to boolean true for includeUsers', () => {
      exportService.exportRealm.mockReturnValue({});

      controller.exportRealm('my-realm', 'true', undefined);

      expect(exportService.exportRealm).toHaveBeenCalledWith('my-realm', {
        includeUsers: true,
        includeSecrets: false,
      });
    });

    it('should convert "true" string to boolean true for includeSecrets', () => {
      exportService.exportRealm.mockReturnValue({});

      controller.exportRealm('my-realm', undefined, 'true');

      expect(exportService.exportRealm).toHaveBeenCalledWith('my-realm', {
        includeUsers: false,
        includeSecrets: true,
      });
    });

    it('should convert both "true" strings to booleans', () => {
      exportService.exportRealm.mockReturnValue({});

      controller.exportRealm('my-realm', 'true', 'true');

      expect(exportService.exportRealm).toHaveBeenCalledWith('my-realm', {
        includeUsers: true,
        includeSecrets: true,
      });
    });
  });

  describe('importRealm', () => {
    it('should call importService.importRealm with body and overwrite false by default', () => {
      const body = { realm: 'imported' };
      const expected = { success: true };
      importService.importRealm.mockReturnValue(expected);

      const result = controller.importRealm(body);

      expect(importService.importRealm).toHaveBeenCalledWith(body, {
        overwrite: false,
      });
      expect(result).toEqual(expected);
    });

    it('should pass overwrite true when query param is "true"', () => {
      const body = { realm: 'imported' };
      importService.importRealm.mockReturnValue({});

      controller.importRealm(body, 'true');

      expect(importService.importRealm).toHaveBeenCalledWith(body, {
        overwrite: true,
      });
    });
  });

  describe('sendTestEmail', () => {
    it('should return error when "to" is missing', async () => {
      const result = await controller.sendTestEmail('my-realm', '');
      expect(result).toEqual({
        success: false,
        error: 'Missing "to" email address',
      });
    });

    it('should return error when SMTP is not configured', async () => {
      emailService.isConfigured.mockResolvedValue(false);

      const result = await controller.sendTestEmail(
        'my-realm',
        'user@example.com',
      );

      expect(result).toEqual({
        success: false,
        error: 'SMTP is not configured for this realm',
      });
      expect(emailService.isConfigured).toHaveBeenCalledWith('my-realm');
    });

    it('should send test email and return success message', async () => {
      const realm = { id: 'r1', name: 'my-realm', theme: 'default' };
      emailService.isConfigured.mockResolvedValue(true);
      realmsService.findByName.mockResolvedValue(realm);
      themeEmail.getSubject.mockReturnValue('Test Email Subject');
      themeEmail.renderEmail.mockReturnValue('<h1>Test</h1>');
      emailService.sendEmail.mockResolvedValue(undefined);

      const result = await controller.sendTestEmail(
        'my-realm',
        'user@example.com',
      );

      expect(emailService.isConfigured).toHaveBeenCalledWith('my-realm');
      expect(realmsService.findByName).toHaveBeenCalledWith('my-realm');
      expect(themeEmail.getSubject).toHaveBeenCalledWith(
        realm,
        'testEmailSubject',
      );
      expect(themeEmail.renderEmail).toHaveBeenCalledWith(
        realm,
        'test-email',
        {},
      );
      expect(emailService.sendEmail).toHaveBeenCalledWith(
        'my-realm',
        'user@example.com',
        'Test Email Subject',
        '<h1>Test</h1>',
      );
      expect(result).toEqual({
        success: true,
        message: 'Test email sent successfully',
      });
    });
  });
});
