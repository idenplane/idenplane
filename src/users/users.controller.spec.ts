jest.mock('../crypto/jwk.service.js', () => ({ JwkService: jest.fn() }));

import { UsersController } from './users.controller.js';
import type { Realm } from '@prisma/client';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: {
    create: jest.Mock;
    findAll: jest.Mock;
    findById: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    setPassword: jest.Mock;
    sendVerificationEmail: jest.Mock;
    getOfflineSessions: jest.Mock;
    revokeOfflineSession: jest.Mock;
  };

  const realm = { id: 'realm-1', name: 'test-realm' } as Realm;

  beforeEach(() => {
    usersService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      setPassword: jest.fn(),
      sendVerificationEmail: jest.fn(),
      getOfflineSessions: jest.fn(),
      revokeOfflineSession: jest.fn(),
    };

    controller = new UsersController(usersService as any);
  });

  describe('create', () => {
    it('should call usersService.create with realm and dto', () => {
      const dto = { username: 'alice', email: 'alice@example.com' };
      const expected = { id: 'u1', ...dto };
      usersService.create.mockReturnValue(expected);

      const result = controller.create(realm, dto);

      expect(usersService.create).toHaveBeenCalledWith(realm, dto);
      expect(result).toEqual(expected);
    });
  });

  describe('findAll', () => {
    it('should call usersService.findAll with realm, skip, limit, and filters', () => {
      const pagination = { skip: 0, limit: 10 };
      const searchParams = {} as any;
      const expected = [{ id: 'u1' }, { id: 'u2' }];
      usersService.findAll.mockReturnValue(expected);

      const result = controller.findAll(realm, pagination, searchParams);

      expect(usersService.findAll).toHaveBeenCalledWith(
        realm,
        0,
        10,
        expect.any(Object),
      );
      expect(result).toEqual(expected);
    });
  });

  describe('findOne', () => {
    it('should call usersService.findById with realm and userId', () => {
      const expected = { id: 'u1', username: 'alice' };
      usersService.findById.mockReturnValue(expected);

      const result = controller.findOne(realm, 'u1');

      expect(usersService.findById).toHaveBeenCalledWith(realm, 'u1');
      expect(result).toEqual(expected);
    });
  });

  describe('update', () => {
    it('should call usersService.update with realm, userId, and dto', () => {
      const dto = { email: 'newemail@example.com' };
      const expected = { id: 'u1', ...dto };
      usersService.update.mockReturnValue(expected);

      const result = controller.update(realm, 'u1', dto);

      expect(usersService.update).toHaveBeenCalledWith(realm, 'u1', dto);
      expect(result).toEqual(expected);
    });
  });

  describe('remove', () => {
    it('should call usersService.remove with realm and userId', () => {
      usersService.remove.mockReturnValue(undefined);

      const result = controller.remove(realm, 'u1');

      expect(usersService.remove).toHaveBeenCalledWith(realm, 'u1');
      expect(result).toBeUndefined();
    });
  });

  describe('resetPassword', () => {
    it('should call usersService.setPassword with realm, userId, and password', () => {
      const dto = { password: 'newP@ss123' };
      usersService.setPassword.mockReturnValue(undefined);

      const result = controller.resetPassword(realm, 'u1', dto);

      expect(usersService.setPassword).toHaveBeenCalledWith(
        realm,
        'u1',
        'newP@ss123',
      );
      expect(result).toBeUndefined();
    });
  });

  describe('sendVerificationEmail', () => {
    it('should send verification email when user has an email', async () => {
      const user = { id: 'u1', email: 'alice@example.com' };
      usersService.findById.mockResolvedValue(user);
      usersService.sendVerificationEmail.mockResolvedValue(undefined);

      const result = await controller.sendVerificationEmail(realm, 'u1');

      expect(usersService.findById).toHaveBeenCalledWith(realm, 'u1');
      expect(usersService.sendVerificationEmail).toHaveBeenCalledWith(
        realm,
        'u1',
        'alice@example.com',
      );
      expect(result).toEqual({ message: 'Verification email sent' });
    });

    it('should return success message even when user has no email (does not send)', async () => {
      const user = { id: 'u1', email: null };
      usersService.findById.mockResolvedValue(user);

      const result = await controller.sendVerificationEmail(realm, 'u1');

      expect(usersService.findById).toHaveBeenCalledWith(realm, 'u1');
      expect(usersService.sendVerificationEmail).not.toHaveBeenCalled();
      expect(result).toEqual({ message: 'Verification email sent' });
    });

    it('should return success message even when user email is empty string', async () => {
      const user = { id: 'u1', email: '' };
      usersService.findById.mockResolvedValue(user);

      const result = await controller.sendVerificationEmail(realm, 'u1');

      expect(usersService.sendVerificationEmail).not.toHaveBeenCalled();
      expect(result).toEqual({ message: 'Verification email sent' });
    });
  });

  describe('getOfflineSessions', () => {
    it('should call usersService.getOfflineSessions with realm and userId', () => {
      const expected = [{ id: 'session-1' }];
      usersService.getOfflineSessions.mockReturnValue(expected);

      const result = controller.getOfflineSessions(realm, 'u1');

      expect(usersService.getOfflineSessions).toHaveBeenCalledWith(realm, 'u1');
      expect(result).toEqual(expected);
    });
  });

  describe('revokeOfflineSession', () => {
    it('should call usersService.revokeOfflineSession with realm, userId, and tokenId', () => {
      usersService.revokeOfflineSession.mockReturnValue(undefined);

      const result = controller.revokeOfflineSession(realm, 'u1', 'token-1');

      expect(usersService.revokeOfflineSession).toHaveBeenCalledWith(
        realm,
        'u1',
        'token-1',
      );
      expect(result).toBeUndefined();
    });
  });
});
