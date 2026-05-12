jest.mock('../crypto/jwk.service.js', () => ({ JwkService: jest.fn() }));

import { SessionsController } from './sessions.controller.js';
import type { Realm } from '@prisma/client';

describe('SessionsController', () => {
  let controller: SessionsController;
  let mockSessionsService: {
    getRealmSessions: jest.Mock;
    getUserSessions: jest.Mock;
    revokeSession: jest.Mock;
    revokeAllUserSessions: jest.Mock;
  };

  const realm = {
    id: 'realm-1',
    name: 'test-realm',
    enabled: true,
  } as Realm;

  beforeEach(() => {
    mockSessionsService = {
      getRealmSessions: jest.fn(),
      getUserSessions: jest.fn(),
      revokeSession: jest.fn(),
      revokeAllUserSessions: jest.fn(),
    };

    controller = new SessionsController(mockSessionsService as any);
  });

  describe('getRealmSessions', () => {
    it('should call sessionsService.getRealmSessions with realm', () => {
      const expected = [{ id: 'session-1', userId: 'user-1' }];
      mockSessionsService.getRealmSessions.mockReturnValue(expected);

      const result = controller.getRealmSessions(realm);

      expect(mockSessionsService.getRealmSessions).toHaveBeenCalledWith(realm);
      expect(result).toEqual(expected);
    });
  });

  describe('getUserSessions', () => {
    it('should call sessionsService.getUserSessions with realm and userId', () => {
      const expected = [{ id: 'session-2', userId: 'user-1' }];
      mockSessionsService.getUserSessions.mockReturnValue(expected);

      const result = controller.getUserSessions(realm, 'user-1');

      expect(mockSessionsService.getUserSessions).toHaveBeenCalledWith(
        realm,
        'user-1',
      );
      expect(result).toEqual(expected);
    });
  });

  describe('revokeSession', () => {
    it('should call sessionsService.revokeSession with sessionId and type', () => {
      mockSessionsService.revokeSession.mockReturnValue(undefined);

      const result = controller.revokeSession('session-1', 'sso');

      expect(mockSessionsService.revokeSession).toHaveBeenCalledWith(
        'session-1',
        'sso',
      );
      expect(result).toBeUndefined();
    });

    it('should default type to oauth when not provided', () => {
      mockSessionsService.revokeSession.mockReturnValue(undefined);

      controller.revokeSession('session-1', 'oauth');

      expect(mockSessionsService.revokeSession).toHaveBeenCalledWith(
        'session-1',
        'oauth',
      );
    });
  });

  describe('revokeAllUserSessions', () => {
    it('should call sessionsService.revokeAllUserSessions with realm and userId', () => {
      mockSessionsService.revokeAllUserSessions.mockReturnValue(undefined);

      const result = controller.revokeAllUserSessions(realm, 'user-1');

      expect(mockSessionsService.revokeAllUserSessions).toHaveBeenCalledWith(
        realm,
        'user-1',
      );
      expect(result).toBeUndefined();
    });
  });
});
