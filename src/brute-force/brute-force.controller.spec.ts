import { BruteForceController } from './brute-force.controller.js';
import type { Realm } from '@prisma/client';

describe('BruteForceController', () => {
  let controller: BruteForceController;
  let bruteForceService: {
    getLockedUsers: jest.Mock;
    unlockUser: jest.Mock;
  };
  let stepUpService: {
    getSessionAcr: jest.Mock;
    satisfiesAcr: jest.Mock;
  };
  let loginService: {
    validateLoginSession: jest.Mock;
  };
  let crypto: {
    sha256: jest.Mock;
  };
  let prisma: {
    loginSession: {
      findUnique: jest.Mock;
    };
  };

  const realm = { id: 'realm-1', name: 'test-realm' } as Realm;

  beforeEach(() => {
    bruteForceService = {
      getLockedUsers: jest.fn(),
      unlockUser: jest.fn(),
    };
    stepUpService = {
      getSessionAcr: jest.fn().mockResolvedValue('urn:authme:acr:mfa'),
      satisfiesAcr: jest.fn().mockReturnValue(true),
    };
    loginService = {
      validateLoginSession: jest.fn().mockResolvedValue({ id: 'admin-1' }),
    };
    crypto = {
      sha256: jest.fn().mockReturnValue('hashed-session-token'),
    };
    prisma = {
      loginSession: {
        findUnique: jest.fn().mockResolvedValue({ id: 'session-1' }),
      },
    };
    controller = new BruteForceController(
      bruteForceService as any,
      stepUpService as any,
      loginService as any,
      crypto as any,
      prisma as any,
    );
  });

  describe('getLockedUsers', () => {
    it('should call service.getLockedUsers with realm id', () => {
      const lockedUsers = [
        { userId: 'user-1', username: 'locked-user', failures: 5 },
      ];
      bruteForceService.getLockedUsers.mockResolvedValue(lockedUsers);

      const result = controller.getLockedUsers(realm);

      expect(bruteForceService.getLockedUsers).toHaveBeenCalledWith('realm-1');
    });
  });

  describe('unlockUser', () => {
    it('should call service.unlockUser with realmId and userId', async () => {
      bruteForceService.unlockUser.mockResolvedValue(undefined);
      const realm = { id: 'realm-1', name: 'test' } as any;

      // Provide a request with adminUser (non-api-key) and AUTHME_SESSION cookie
      const req = {
        adminUser: { userId: 'admin-1' },
        cookies: { AUTHME_SESSION: 'valid-session-token' },
      } as any;

      await controller.unlockUser(realm, 'user-1', req);

      expect(bruteForceService.unlockUser).toHaveBeenCalledWith(
        'realm-1',
        'user-1',
      );
    });
  });
});
