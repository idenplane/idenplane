import { BruteForceController } from './brute-force.controller.js';
import type { Realm } from '@prisma/client';

describe('BruteForceController', () => {
  let controller: BruteForceController;
  let bruteForceService: {
    getLockedUsers: jest.Mock;
    unlockUser: jest.Mock;
  };

  const realm = { id: 'realm-1', name: 'test-realm' } as Realm;

  beforeEach(() => {
    bruteForceService = {
      getLockedUsers: jest.fn(),
      unlockUser: jest.fn(),
    };
    controller = new BruteForceController(bruteForceService as any);
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

      await controller.unlockUser(realm, 'user-1');

      expect(bruteForceService.unlockUser).toHaveBeenCalledWith(
        'realm-1',
        'user-1',
      );
    });
  });
});
