jest.mock('../crypto/jwk.service.js', () => ({ JwkService: jest.fn() }));

import { MfaController } from './mfa.controller.js';
import type { Realm } from '@prisma/client';

describe('MfaController', () => {
  let controller: MfaController;
  let mockMfaService: {
    isMfaEnabled: jest.Mock;
    disableTotp: jest.Mock;
  };
  let mockPrisma: {
    user: { findUnique: jest.Mock };
    loginSession: { findUnique: jest.Mock };
  };
  let mockStepUpService: {
    getSessionAcr: jest.Mock;
    satisfiesAcr: jest.Mock;
  };
  let mockLoginService: {
    validateLoginSession: jest.Mock;
  };
  let mockCrypto: {
    sha256: jest.Mock;
  };

  const realm = { id: 'realm-1', name: 'test' } as Realm;
  const mockUser = { id: 'user-1', realmId: 'realm-1', email: 'test@test.com' };
  const mockSessionToken = 'valid-session-token';
  const mockTokenHash = 'hashed-token';
  const mockLoginSession = {
    id: 'session-1',
    userId: 'user-1',
    realmId: 'realm-1',
  };

  beforeEach(() => {
    mockMfaService = {
      isMfaEnabled: jest.fn(),
      disableTotp: jest.fn(),
    };

    mockPrisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(mockUser),
      },
      loginSession: {
        findUnique: jest.fn().mockResolvedValue(mockLoginSession),
      },
    };

    mockStepUpService = {
      getSessionAcr: jest.fn().mockResolvedValue('urn:idenplane:acr:mfa'),
      satisfiesAcr: jest.fn().mockReturnValue(true),
    };

    mockLoginService = {
      validateLoginSession: jest.fn().mockResolvedValue(mockUser),
    };

    mockCrypto = {
      sha256: jest.fn().mockReturnValue(mockTokenHash),
    };

    controller = new MfaController(
      mockMfaService as any,
      mockPrisma as any,
      mockStepUpService as any,
      mockLoginService as any,
      mockCrypto as any,
    );
  });

  describe('getMfaStatus', () => {
    it('should call mfaService.isMfaEnabled with the userId', async () => {
      mockMfaService.isMfaEnabled.mockResolvedValue(true);

      await controller.getMfaStatus(realm, 'user-1');

      expect(mockMfaService.isMfaEnabled).toHaveBeenCalledWith('user-1');
    });

    it('should return { enabled: true } when MFA is enabled', async () => {
      mockMfaService.isMfaEnabled.mockResolvedValue(true);

      const result = await controller.getMfaStatus(realm, 'user-1');

      expect(result).toEqual({ enabled: true });
    });

    it('should return { enabled: false } when MFA is disabled', async () => {
      mockMfaService.isMfaEnabled.mockResolvedValue(false);

      const result = await controller.getMfaStatus(realm, 'user-2');

      expect(result).toEqual({ enabled: false });
    });

    it('should throw NotFoundException for user in different realm', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        realmId: 'other-realm',
      });

      await expect(controller.getMfaStatus(realm, 'user-1')).rejects.toThrow(
        'not found in realm',
      );
    });
  });

  describe('resetMfa', () => {
    const mockReq = {
      cookies: { IDENPLANE_SESSION: mockSessionToken },
      adminUser: { userId: 'user-1' },
    } as any;

    it('should call mfaService.disableTotp with the userId', async () => {
      mockMfaService.disableTotp.mockResolvedValue(undefined);

      await controller.resetMfa(realm, 'user-1', mockReq);

      expect(mockMfaService.disableTotp).toHaveBeenCalledWith('user-1');
    });

    it('should throw UnauthorizedException when no adminUser is present', async () => {
      const reqWithoutAdmin = {
        cookies: { IDENPLANE_SESSION: mockSessionToken },
      } as any;

      await expect(
        controller.resetMfa(realm, 'user-1', reqWithoutAdmin),
      ).rejects.toThrow('Admin identity could not be determined');
    });

    it('should throw UnauthorizedException for API key authentication', async () => {
      const reqWithApiKey = {
        cookies: { IDENPLANE_SESSION: mockSessionToken },
        adminUser: { userId: 'api-key:abc123' },
      } as any;

      await expect(
        controller.resetMfa(realm, 'user-1', reqWithApiKey),
      ).rejects.toThrow('Static admin API keys cannot disable user MFA');
    });

    it('should throw UnauthorizedException when no session token is present', async () => {
      const reqWithoutSession = { adminUser: { userId: 'user-1' } } as any;

      await expect(
        controller.resetMfa(realm, 'user-1', reqWithoutSession),
      ).rejects.toThrow('No active session found');
    });

    it('should throw UnauthorizedException when session ACR does not satisfy MFA', async () => {
      mockStepUpService.satisfiesAcr.mockReturnValue(false);

      await expect(
        controller.resetMfa(realm, 'user-1', mockReq),
      ).rejects.toThrow('MFA step-up is required');
    });
  });
});
